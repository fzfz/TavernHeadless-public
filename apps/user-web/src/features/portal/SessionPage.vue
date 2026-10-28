<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref } from "vue";
import type { SessionRecord } from "@tavern/sdk";
import {
  portalKey,
  accountDraftKey,
  errorMessage,
  errorStatus,
} from "./context.js";
import ChatSession from "../chat/ChatSession.vue";
import PortalDialog from "../../components/PortalDialog.vue";
import SessionSettingsDialog from "../../components/SessionSettingsDialog.vue";
import text from "../../config/portal-ui.json";
const props = defineProps<{ sessionId: string }>(),
  portal = inject(portalKey)!;
const session = ref<SessionRecord | null>(null),
  loading = ref(true),
  failure = ref(""),
  unavailable = ref(false),
  runtimeFailure = ref(""),
  runtimeKey = ref(0),
  settings = ref(false);
const branchKey = accountDraftKey(
  portal.account.value!.id,
  `session-branch:${props.sessionId}`,
);
const branchId = ref(
    portal.route.value.query.get("branch") ||
      sessionStorage.getItem(branchKey) ||
      "main",
  ),
  chat = ref<InstanceType<typeof ChatSession>>();
const state = ref({ busy: false, pending: false, draft: false }),
  leaveTarget = ref("");
let active = true;
async function load() {
  loading.value = true;
  failure.value = "";
  unavailable.value = false;
  try {
    const result = await portal.client.sessions.getDetail({
      sessionId: props.sessionId,
    });
    if (active) {
      session.value = result;
    }
  } catch (error) {
    failure.value = errorMessage(error);
    unavailable.value = [403, 404].includes(errorStatus(error) || 0);
  } finally {
    if (active) loading.value = false;
  }
}
function guard(target: string) {
  if (chat.value?.dismissTransient()) return false;
  if (state.value.busy || state.value.pending || state.value.draft) {
    leaveTarget.value = target;
    return false;
  }
  return true;
}
function leave() {
  portal.beforeLeave.value = null;
  portal.go(leaveTarget.value);
}
function setBranch(payload: { branchId: string }) {
  branchId.value = payload.branchId;
  sessionStorage.setItem(branchKey, payload.branchId);
  window.history.replaceState(
    null,
    "",
    `#chat/${props.sessionId}?branch=${encodeURIComponent(payload.branchId)}`,
  );
  runtimeKey.value++;
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (state.value.busy || state.value.pending || state.value.draft) {
    event.preventDefault();
    event.returnValue = "";
  }
}
onMounted(() => {
  portal.beforeLeave.value = guard;
  window.addEventListener("beforeunload", beforeUnload);
  void load();
});
onBeforeUnmount(() => {
  active = false;
  if (portal.beforeLeave.value === guard) portal.beforeLeave.value = null;
  window.removeEventListener("beforeunload", beforeUnload);
});
</script>
<template>
  <section class="session-page">
    <header class="session-header">
      <a href="#history" @click.prevent="portal.go('history')">{{
        text.returnHistory
      }}</a>
      <h1>
        {{
          session?.title ||
          session?.characterBinding?.snapshotSummary?.name ||
          text.loading
        }}
      </h1>
      <button :disabled="!session" @click="settings = true">
        {{ text.sessionSettings }}
      </button>
    </header>
    <p v-if="loading" role="status">{{ text.loadingRuntime }}</p>
    <div v-if="failure && !settings" class="empty" role="alert">
      <h2 v-if="unavailable">{{ text.resourceMissing }}</h2>
      <p>{{ unavailable ? text.resourceMissingHelp : failure }}</p>
      <button v-if="!unavailable" @click="load">{{ text.retry }}</button
      ><a href="#history">{{ text.returnHistory }}</a>
    </div>
    <template v-else-if="session"
      ><div v-if="runtimeFailure" class="error-panel" role="alert">
        <p>{{ runtimeFailure }}</p>
        <button
          @click="
            runtimeFailure = '';
            runtimeKey++;
          "
        >
          {{ text.reloadRuntime }}
        </button>
      </div>
      <ChatSession
        v-else
        ref="chat"
        :key="`${sessionId}:${branchId}:${runtimeKey}`"
        :client="portal.client"
        :session-id="sessionId"
        :account-id="portal.account.value!.id"
        :branch-id="branchId"
        :history-selection="'latest'"
        :history-refresh-version="0"
        :history-more-version="0"
        :history-retry-cursor="null"
        :history-selection-retry-version="0"
        :history-retry-snapshot-id="''"
        :policy="portal.runtime.policy"
        :asset-base-url="portal.runtime.config.apiBaseUrl"
        @failure="runtimeFailure = errorMessage($event)"
        @state="state = $event"
        @branch="setBranch"
    /></template>
  </section>
  <SessionSettingsDialog
    v-if="settings && session"
    :session="session"
    identity
    @close="settings = false"
    @updated="session = $event"
  /><PortalDialog
    v-if="leaveTarget"
    :title="text.unsavedTitle"
    @close="leaveTarget = ''"
    ><p>{{ state.pending ? text.operationPending : text.leaveSessionHelp }}</p>
    <template #actions
      ><button autofocus @click="leaveTarget = ''">
        {{ text.keepEditing }}</button
      ><button @click="leave">{{ text.keepDraft }}</button></template
    ></PortalDialog
  >
</template>
