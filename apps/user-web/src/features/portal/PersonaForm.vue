<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { UserDetail } from "@tavern/sdk";
import { createBrowserUuid, userResourcePolicy } from "@tavern/shared";
import {
  portalKey,
  accountDraftKey,
  errorMessage,
  errorStatus,
  isUncertainWrite,
} from "./context.js";
import PortalDialog from "../../components/PortalDialog.vue";
import text from "../../config/portal-ui.json";
const props = defineProps<{ personaId?: string }>(),
  portal = inject(portalKey)!;
const returnTo = portal.route.value.query.get("return") || "personas";
const key = accountDraftKey(
  portal.account.value!.id,
  `persona:${props.personaId || "new"}:${returnTo}`,
);
const name = ref(""),
  description = ref(""),
  revision = ref<number>(),
  snapshot = ref<Record<string, unknown>>({});
const conflict = ref<UserDetail | null>(null),loadedPersona=ref<UserDetail|null>(null);
const loadFailure=ref(''),unavailable=ref(false);
const baseline = ref(""),
  busy = ref(false),
  loading = ref(true),
  failure = ref(""),
  pending = ref(false),
  leaveTarget = ref(""),
  operationId = ref(createBrowserUuid());
const value = computed(() =>
  JSON.stringify({ name: name.value, description: description.value }),
);
const dirty = computed(() => value.value !== baseline.value);
let active = true,
  preserveDraft = true;
function saveDraft() {
  if (preserveDraft && !loading.value && !loadFailure.value && dirty.value)
    sessionStorage.setItem(
      key,
      JSON.stringify({
        name: name.value,
        description: description.value,
        operationId: operationId.value,
        pending: pending.value,
        revision: revision.value,
      }),
    );
}
async function load() {
  loading.value = true;
  loadFailure.value = "";
  unavailable.value = false;
  failure.value = "";
  try {
    if (props.personaId) {
      const user = await portal.client.users.getDetail({
        userId: props.personaId,
      });
      if (!active) return;
      loadedPersona.value=user;
      name.value = user.name;
      description.value = String(user.snapshot?.description || "");
      snapshot.value = user.snapshot || {};
      revision.value = user.revision;
    }
    baseline.value = value.value;
    const raw = sessionStorage.getItem(key);
    if (raw) {
      try {
        const draft = JSON.parse(raw);
        name.value = String(draft.name || "");
        description.value = String(draft.description || "");
        if (typeof draft.operationId === "string")
          operationId.value = draft.operationId;
        pending.value = draft.pending === true;
        if (
          props.personaId &&
          typeof draft.revision === "number" &&
          draft.revision !== revision.value
        ) {
          conflict.value = loadedPersona.value;
          revision.value = draft.revision;
        }
        portal.notice.value = text.draftRestored;
      } catch {
        sessionStorage.removeItem(key);
      }
    }
  } catch (error) {
    loadFailure.value = errorMessage(error);
    unavailable.value=[403,404].includes(errorStatus(error)||0);
  } finally {
    if (active) loading.value = false;
  }
}
function guard(target: string) {
  if(loadFailure.value)return true;
  if (busy.value || pending.value || dirty.value) {
    leaveTarget.value = target;
    return false;
  }
  return true;
}
function leave(keep: boolean) {
  preserveDraft = keep;
  if (keep) saveDraft();
  else sessionStorage.removeItem(key);
  portal.beforeLeave.value = null;
  portal.go(leaveTarget.value || returnTo);
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || pending.value) {
    saveDraft();
    event.preventDefault();
    event.returnValue = "";
  }
}
async function save() {
  if (
    busy.value ||
    conflict.value ||
    (!!props.personaId&&!dirty.value) ||
    !portal.online.value ||
    !name.value.trim() ||
    !description.value.trim()
  )
    return;
  busy.value = true;
  failure.value = "";
  try {
    const next = {
      ...snapshot.value,
      name: name.value.trim(),
      description: description.value.trim(),
    };
    const user = props.personaId
      ? await portal.client.users.update({
          userId: props.personaId,
          expectedRevision: revision.value,
          snapshot: next,
        })
      : await portal.client.users.create({
          snapshot: next,
          operationId: operationId.value,
        });
    if (!active) return;
    sessionStorage.removeItem(key);
    pending.value = false;
    baseline.value = value.value;
    portal.beforeLeave.value = null;
    await portal.refreshIdentity();
    portal.notice.value = text.saved;
    if (returnTo === "personas") {
      const viewKey = accountDraftKey(
        portal.account.value!.id,
        "personas-view",
      );
      let count = userResourcePolicy.personaPageSize;
      try {
        count =
          JSON.parse(sessionStorage.getItem(viewKey) || "null")?.count || count;
      } catch {
        sessionStorage.removeItem(viewKey);
      }
      sessionStorage.setItem(
        viewKey,
        JSON.stringify({ anchor: user.id, count }),
      );
    }
    const target = returnTo.startsWith("start/")
      ? `${returnTo}${returnTo.includes("?") ? "&" : "?"}persona=${encodeURIComponent(user.id)}`
      : returnTo;
    portal.go(target);
  } catch (error) {
    if (active) {
      failure.value = errorMessage(error);
      pending.value = isUncertainWrite(error);
      if (props.personaId && errorStatus(error) === 409) {
        try {
          conflict.value = await portal.client.users.getDetail({
            userId: props.personaId,
          });
        } catch (readError) {
          failure.value = errorMessage(readError);
          pending.value = true;
        }
      }
      saveDraft();
    }
  } finally {
    if (active) busy.value = false;
  }
}
async function verify() {
  if (!props.personaId) {
    await save();
    return;
  }
  busy.value = true;
  failure.value = "";
  try {
    const user = await portal.client.users.getDetail({
      userId: props.personaId,
    });
    if (
      user.snapshot?.name === name.value.trim() &&
      user.snapshot?.description === description.value.trim()
    ) {
      pending.value = false;
      sessionStorage.removeItem(key);
      baseline.value = value.value;
      portal.beforeLeave.value = null;
      portal.go(returnTo);
    } else {
      pending.value = false;
      if (user.revision !== revision.value) conflict.value = user;
      saveDraft();
    }
  } catch (error) {
    failure.value = errorMessage(error);
  } finally {
    busy.value = false;
  }
}
function resolveConflict(useSaved: boolean) {
  const user = conflict.value;
  if (!user) return;
  revision.value = user.revision;
  snapshot.value = user.snapshot || {};
  baseline.value = JSON.stringify({
    name: user.name,
    description: String(user.snapshot?.description || ""),
  });
  if (useSaved) {
    name.value = user.name;
    description.value = String(user.snapshot?.description || "");
    sessionStorage.removeItem(key);
  }
  conflict.value = null;
  failure.value = "";
  saveDraft();
}
watch([name, description], saveDraft);
onMounted(() => {
  portal.beforeLeave.value = guard;
  window.addEventListener("beforeunload", beforeUnload);
  void load();
});
onBeforeUnmount(() => {
  active = false;
  saveDraft();
  if (portal.beforeLeave.value === guard) portal.beforeLeave.value = null;
  window.removeEventListener("beforeunload", beforeUnload);
});
</script>
<template>
  <section class="form-page">
    <h1>{{ personaId ? text.editPersona : text.createPersona }}</h1>
    <p v-if="loading" role="status">{{ text.loading }}</p>
    <div v-else-if="loadFailure" role="alert" class="empty"><h2 v-if="unavailable">{{text.resourceMissing}}</h2><p>{{loadFailure}}</p><button v-if="!unavailable" @click="load">{{text.retry}}</button><a href="#personas">{{text.personas}}</a></div>
    <form
      v-else
      class="surface"
      @submit.prevent="save"
      @keydown="
        ($event.ctrlKey || $event.metaKey) &&
        $event.key === 'Enter' &&
        !$event.isComposing &&
        ($event.preventDefault(), !pending && save())
      "
    >
      <fieldset :disabled="busy || pending">
        <div class="field">
          <label for="persona-name">{{ text.personaName }}</label
          ><input
            id="persona-name"
            v-model="name"
            :maxlength="userResourcePolicy.personaNameMaxLength"
            required
            autocomplete="off"
          />
        </div>
        <div class="field">
          <label for="persona-description">{{ text.personaDescription }}</label
          ><textarea
            id="persona-description"
            v-model="description"
            :maxlength="userResourcePolicy.personaDescriptionMaxLength"
            required
            rows="9"
            aria-describedby="persona-help"
          ></textarea
          ><small id="persona-help">{{ text.personaHelp }}</small>
        </div>
      </fieldset>
      <section v-if="conflict" class="error-panel" role="alert">
        <p>{{ text.personaChanged }}</p>
        <h2>{{ conflict.name }}</h2>
        <p class="preserve-lines">{{ conflict.snapshot?.description }}</p>
        <div class="actions">
          <button type="button" @click="resolveConflict(true)">
            {{ text.useSavedPersona }}</button
          ><button type="button" @click="resolveConflict(false)">
            {{ text.keepPersonaDraft }}
          </button>
        </div>
      </section>
      <p v-if="personaId&&!dirty" role="status">{{text.personaUnchanged}}</p>
      <p v-if="failure" role="alert" class="error">{{ failure }}</p>
      <p v-if="pending" role="status">{{ text.unknownSave }}</p>
      <div class="actions">
        <button
          v-if="pending"
          type="button"
          :disabled="busy || !portal.online.value"
          @click="verify"
        >
          {{ text.verifySave }}</button
        ><button
          v-else
          class="primary"
          :disabled="
            busy ||
            !!conflict ||
            (!!personaId&&!dirty) ||
            !portal.online.value ||
            !name.trim() ||
            !description.trim()
          "
        >
          {{ busy ? text.saving : text.personaSave }}</button
        ><button type="button" :disabled="busy" @click="portal.go(returnTo)">
          {{ text.cancel }}
        </button>
      </div>
    </form>
  </section>
  <PortalDialog
    v-if="leaveTarget"
    :title="text.unsavedTitle"
    :busy="busy"
    @close="leaveTarget = ''"
    ><p>{{ pending ? text.unknownSave : text.personaName + "：" + name }}</p>
    <template #actions
      ><button autofocus @click="leaveTarget = ''">
        {{ text.keepEditing }}</button
      ><button :disabled="busy" @click="leave(true)">
        {{ text.keepDraft }}</button
      ><button :disabled="busy || pending" @click="leave(false)">
        {{ text.discardDraft }}
      </button></template
    ></PortalDialog
  >
</template>
