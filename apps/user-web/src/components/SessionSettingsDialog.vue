<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import type { SessionRecord } from "@tavern/sdk";
import { userResourcePolicy } from "@tavern/shared";
import {
  portalKey,
  accountDraftKey,
  errorMessage,
  errorStatus,
  isUncertainWrite,
} from "../features/portal/context.js";
import PortalDialog from "./PortalDialog.vue";
import text from "../config/portal-ui.json";
const props = defineProps<{ session: SessionRecord; identity?: boolean }>(),
  emit = defineEmits<{ close: []; updated: [session: SessionRecord] }>(),
  portal = inject(portalKey)!;
const key = accountDraftKey(
    portal.account.value!.id,
    `title:${props.session.id}`,
  ),
  title = ref(props.session.title || ""),
  saved = ref(props.session.title || ""),
  busy = ref(false),
  failure = ref(""),
  pending = ref(false),
  showSnapshot = ref(false),
  confirmClose = ref(false),
  conflict = ref(false),
  draftSource = ref(props.session.title || "");
const dirty = computed(() => title.value !== saved.value);
let active = true,
  preserveDraft = true;
try {
  const draft = JSON.parse(sessionStorage.getItem(key) || "null");
  if (draft) {
    title.value = String(draft.title || "");
    draftSource.value = String(draft.saved || "");
    pending.value = !!draft.pending;
    conflict.value = draftSource.value !== saved.value;
  }
} catch {
  sessionStorage.removeItem(key);
}
function remember() {
  if (!preserveDraft) return;
  if (dirty.value || pending.value)
    sessionStorage.setItem(
      key,
      JSON.stringify({
        title: title.value,
        saved: draftSource.value,
        pending: pending.value,
      }),
    );
  else sessionStorage.removeItem(key);
}
function close() {
  if (showSnapshot.value) {
    showSnapshot.value = false;
    nextTick(() => document.getElementById("view-session-persona")?.focus());
  } else if (dirty.value || pending.value) {
    confirmClose.value = true;
  } else emit("close");
}
function finishClose(keep: boolean) {
  preserveDraft = keep;
  if (keep) remember();
  else sessionStorage.removeItem(key);
  emit("close");
}
async function verify() {
  if (busy.value) return;
  busy.value = true;
  failure.value = "";
  const hadDraft=dirty.value||pending.value;
  try {
    const latest = await portal.client.sessions.getDetail({
      sessionId: props.session.id,
    });
    if (!active) return;
    saved.value = latest.title || "";
    emit("updated", latest);
    if (pending.value && title.value.trim() === saved.value) {
      pending.value = false;
      preserveDraft = false;
      sessionStorage.removeItem(key);
      portal.notice.value = text.saved;
      emit("close");
    } else {
      pending.value = false;
      if(!hadDraft){title.value=saved.value;draftSource.value=saved.value;conflict.value=false;}else conflict.value = saved.value !== draftSource.value;
      remember();
    }
  } catch (error) {
    if (active) failure.value = errorMessage(error);
  } finally {
    if (active) busy.value = false;
  }
}
async function save() {
  if (
    busy.value ||
    pending.value ||
    conflict.value ||
    !dirty.value ||
    !title.value.trim() ||
    !portal.online.value
  )
    return;
  busy.value = true;
  failure.value = "";
  pending.value = true;
  remember();
  try {
    const latest = await portal.client.sessions.update({
      sessionId: props.session.id,
      title: title.value.trim(),
    });
    pending.value = false;
    saved.value = latest.title || "";
    preserveDraft = false;
    sessionStorage.removeItem(key);
    emit("updated", latest);
    portal.notice.value = text.saved;
    emit("close");
  } catch (error) {
    if (active) {
      failure.value = errorMessage(error);
      pending.value = isUncertainWrite(error);
      remember();
    }
  } finally {
    if (active) busy.value = false;
  }
}
function currentValue() {
  title.value = saved.value;
  draftSource.value = saved.value;
  conflict.value = false;
  remember();
}
function keepValue() {
  draftSource.value = saved.value;
  conflict.value = false;
  remember();
}
watch(title, remember);
function refreshVisible(){if(document.visibilityState==='visible'&&portal.online.value&&!busy.value)void verify();}
onMounted(() => {
  void verify();
  document.addEventListener('visibilitychange',refreshVisible);
  window.addEventListener('online',refreshVisible);
});
onBeforeUnmount(() => {
  active = false;
  document.removeEventListener('visibilitychange',refreshVisible);
  window.removeEventListener('online',refreshVisible);
  remember();
});
</script>
<template>
  <PortalDialog
    :title="
      confirmClose
        ? text.unsavedTitle
        : showSnapshot
          ? text.snapshotLabel
          : identity
            ? text.sessionSettings
            : text.rename
    "
    :busy="busy"
    @close="confirmClose ? (confirmClose = false) : close()"
    ><template v-if="confirmClose"
      ><p>{{ pending ? text.unknownSave : text.titleDraftHelp }}</p></template
    ><template v-else-if="showSnapshot"
      ><h3>
        {{
          session.userBinding?.snapshotSummary?.name || text.missingPersonaName
        }}
      </h3>
      <p class="prose">
        {{
          session.userBinding?.snapshot?.description ||
          text.missingPersonaDescription
        }}
      </p>
      <p>{{ text.snapshotHelp }}</p></template
    ><template v-else
      ><div v-if="identity">
        <p>{{ session.characterBinding?.snapshotSummary?.name }}</p>
        <h3>{{ text.snapshotLabel }}</h3>
        <p>
          {{
            session.userBinding?.snapshotSummary?.name ||
            text.missingPersonaName
          }}
        </p>
        <button id="view-session-persona" @click="showSnapshot = true">
          {{ text.viewPersona }}
        </button>
      </div>
      <form
        id="session-title-form"
        @submit.prevent="save"
        @keydown.enter="
          ($event.isComposing || $event.keyCode === 229) &&
          $event.preventDefault()
        "
      >
        <div class="field">
          <label for="session-title-input">{{ text.sessionTitle }}</label
          ><input
            id="session-title-input"
            v-model="title"
            autofocus
            required
            :disabled="busy || pending"
            :maxlength="userResourcePolicy.sessionTitleMaxLength"
          />
        </div>
      </form>
      <div v-if="conflict" class="notice">
        <p>{{ text.titleChanged }}</p>
        <p>{{ text.savedTitle }}：{{ saved }}</p>
        <div class="actions">
          <button @click="currentValue">{{ text.useSavedTitle }}</button
          ><button @click="keepValue">{{ text.keepTitleDraft }}</button>
        </div>
      </div>
      <p v-if="pending" role="status">{{ text.unknownSave }}</p>
      <p v-if="failure" role="alert" class="error">{{ failure }}</p></template
    ><template #actions
      ><template v-if="confirmClose"
        ><button autofocus @click="confirmClose = false">
          {{ text.keepEditing }}</button
        ><button :disabled="busy" @click="finishClose(true)">
          {{ text.keepDraft }}</button
        ><button :disabled="busy || pending" @click="finishClose(false)">
          {{ text.discardDraft }}
        </button></template
      ><button v-else-if="showSnapshot" @click="close">
        {{ text.backSettings }}</button
      ><template v-else
        ><button :disabled="busy" @click="close">{{ text.cancel }}</button
        ><button
          v-if="pending"
          :disabled="busy || !portal.online.value"
          @click="verify"
        >
          {{ text.verifySave }}</button
        ><button
          v-else
          form="session-title-form"
          class="primary"
          :disabled="
            busy || conflict || !dirty || !title.trim() || !portal.online.value
          "
        >
          {{ busy ? text.saving : text.saveName }}
        </button></template
      ></template
    ></PortalDialog
  >
</template>
