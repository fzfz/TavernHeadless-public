<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { userIdentityPolicy } from "@tavern/shared";
import {
  portalKey,
  accountDraftKey,
  errorMessage,
  errorStatus,
  isUncertainWrite,
} from "./context.js";
import PortalDialog from "../../components/PortalDialog.vue";
import text from "../../config/portal-ui.json";
const portal = inject(portalKey)!,
  name = ref(portal.account.value?.name || ""),
  saved = ref(name.value),
  draftSource = ref(saved.value),
  editing = ref(false),
  busy = ref(false),
  failure = ref(""),
  pending = ref(false),
  leaveTarget = ref(""),
  conflict = ref(false);
const counts = ref<{ personas: number | null; sessions: number | null }>({
    personas: null,
    sessions: null,
  }),
  countLoading = ref(true),
  countFailure = ref(false);
const key = accountDraftKey(portal.account.value!.id, "profile");
let active = true,
  preserve = true;
const dirty = computed(() => name.value !== saved.value);
try {
  const draft = JSON.parse(sessionStorage.getItem(key) || "null");
  if (draft) {
    name.value = String(draft.name || "");
    editing.value = true;
    pending.value = !!draft.pending;
    draftSource.value = String(draft.saved ?? saved.value);
    conflict.value = draftSource.value !== saved.value;
  }
} catch {
  sessionStorage.removeItem(key);
}
function remember() {
  if (preserve && (dirty.value || pending.value))
    sessionStorage.setItem(
      key,
      JSON.stringify({
        name: name.value,
        saved: draftSource.value,
        pending: pending.value,
      }),
    );
  else sessionStorage.removeItem(key);
}
async function loadCounts() {
  countLoading.value = true;
  countFailure.value = false;
  const results = await Promise.allSettled([
    portal.client.users.listPage({ limit: 1, status: "active" }),
    portal.client.sessions.listPage({ limit: 1 }),
  ]);
  if (!active) return;
  results.forEach((result, index) => {
    if (result.status === "fulfilled")
      counts.value[index ? "sessions" : "personas"] = result.value.total;
    else countFailure.value = true;
  });
  countLoading.value = false;
}
function cancel() {
  name.value = saved.value;
  draftSource.value = saved.value;
  editing.value = false;
  conflict.value = false;
  pending.value = false;
  sessionStorage.removeItem(key);
}
function applyCurrentProfile(current: string) {
  if (!dirty.value && !pending.value) {
    name.value = current;
    saved.value = current;
    draftSource.value = current;
    conflict.value = false;
    sessionStorage.removeItem(key);
  } else if (pending.value && current === name.value.trim()) {
    saved.value = current;
    cancel();
    portal.notice.value = text.profileSaved;
  } else {
    conflict.value = current !== draftSource.value;
    saved.value = current;
    pending.value = false;
    remember();
  }
}
async function verify() {
  if (busy.value) return;
  busy.value = true;
  failure.value = "";
  try {
    await portal.refreshIdentity();
    if (!active || !portal.account.value) return;
    applyCurrentProfile(portal.account.value.name);
  } catch (error) {
    failure.value = errorMessage(error);
  } finally {
    busy.value = false;
  }
}
function keepDraft() {
  draftSource.value = saved.value;
  conflict.value = false;
  remember();
}
async function save() {
  if (
    busy.value ||
    pending.value ||
    !name.value.trim() ||
    !dirty.value ||
    conflict.value
  )
    return;
  busy.value = true;
  failure.value = "";
  pending.value = true;
  remember();
  try {
    await portal.client.auth.updateMe({ name: name.value.trim() });
    if (!active) return;
    await portal.refreshIdentity();
    if (!active || !portal.account.value) return;
    applyCurrentProfile(portal.account.value.name);
  } catch (error) {
    if (!active) return;
    failure.value = errorMessage(error);
    pending.value = isUncertainWrite(error);
    remember();
  } finally {
    busy.value = false;
  }
}
function guard(target: string) {
  if (dirty.value || pending.value) {
    leaveTarget.value = target;
    return false;
  }
  return true;
}
function leave(keep: boolean) {
  preserve = keep;
  remember();
  portal.beforeLeave.value = null;
  portal.go(leaveTarget.value);
}
function visibility() {
  if (document.visibilityState === "visible") {
    void loadCounts();
    if (!busy.value) void verify();
  }
}
watch(name, remember);
watch(
  () => [portal.account.value?.name, busy.value, pending.value] as const,
  ([current, isBusy, isPending]) => {
    if (active && !isBusy && !isPending && current !== undefined)
      applyCurrentProfile(current);
  },
);
onMounted(() => {
  portal.beforeLeave.value = guard;
  void loadCounts();
  document.addEventListener("visibilitychange", visibility);
});
onBeforeUnmount(() => {
  active = false;
  remember();
  if (portal.beforeLeave.value === guard) portal.beforeLeave.value = null;
  document.removeEventListener("visibilitychange", visibility);
});
</script>
<template>
  <section>
    <h1>{{ text.account }}</h1>
    <form
      class="surface account-form"
      @submit.prevent="save"
      @keydown.enter="
        ($event.isComposing || $event.keyCode === 229) &&
        $event.preventDefault()
      "
      @keydown.esc.prevent="!pending && !busy && cancel()"
    >
      <div class="field">
        <label for="account-name">{{ text.nickname }}</label
        ><template v-if="editing"
          ><input
            id="account-name"
            v-model="name"
            required
            :maxlength="userIdentityPolicy.nameMaxLength"
            :disabled="busy || pending"
            autocomplete="nickname"
        /></template>
        <p v-else>{{ saved }}</p>
      </div>
      <div class="field">
        <span>{{ text.email }}</span>
        <p>{{ portal.account.value?.email }}</p>
      </div>
      <div v-if="conflict" class="notice">
        <p>{{ text.profileChanged }}：{{ saved }}</p>
        <button type="button" @click="cancel">{{ text.useSavedProfile }}</button
        ><button type="button" @click="keepDraft">
          {{ text.keepTitleDraft }}
        </button>
      </div>
      <p v-if="failure" role="alert" class="error">{{ failure }}</p>
      <p v-if="pending" role="status">{{ text.unknownSave }}</p>
      <div class="actions">
        <button v-if="!editing" type="button" @click="editing = true">
          {{ text.edit }}</button
        ><template v-else
          ><button
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
              busy || !portal.online.value || !name.trim() || !dirty || conflict
            "
          >
            {{ busy ? text.saving : text.save }}</button
          ><button type="button" :disabled="busy || pending" @click="cancel">
            {{ text.cancel }}
          </button></template
        >
      </div>
    </form>
    <div class="account-links">
      <a class="surface" href="#personas" @click.prevent="portal.go('personas')"
        >{{ text.personas }} →
        <p>
          {{
            countLoading
              ? text.loading
              : counts.personas === null
                ? text.countUnavailable
                : counts.personas + " " + text.personaCount
          }}
        </p></a
      ><a class="surface" href="#history" @click.prevent="portal.go('history')"
        >{{ text.history }} →
        <p>
          {{
            countLoading
              ? text.loading
              : counts.sessions === null
                ? text.countUnavailable
                : counts.sessions + " " + text.sessionCount
          }}
        </p></a
      >
    </div>
    <button v-if="countFailure" @click="loadCounts">
      {{ text.retryCounts }}</button
    ><button
      :disabled="busy"
      @click="
        preserve = false;
        portal.signOut();
      "
    >
      {{ text.signout }}
    </button>
  </section>
  <PortalDialog
    v-if="leaveTarget"
    :title="text.unsavedTitle"
    @close="leaveTarget = ''"
    ><p>{{ pending ? text.unknownSave : text.profileDraftHelp }}</p>
    <template #actions
      ><button autofocus @click="leaveTarget = ''">
        {{ text.keepEditing }}</button
      ><button @click="leave(true)">{{ text.keepDraft }}</button
      ><button :disabled="pending" @click="leave(false)">
        {{ text.discardDraft }}
      </button></template
    ></PortalDialog
  >
</template>
