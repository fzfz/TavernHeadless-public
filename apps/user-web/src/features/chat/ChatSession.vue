<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { TavernClient } from "@tavern/sdk";
import {
  apiErrorMessages,
  roleRuntimeValidators,
  type RoleRuntimePolicy,
  type RoleRuntimeSession,
  type RoleSnapshotPointer,
} from "@tavern/shared";
import { createRoleTransport } from "./transport.js";
import { createSessionHost } from "./session-controller.js";
import { createScriptRuntime } from "../../runtime/script-runtime.js";
import interaction from "../../config/role-interaction.json";

const props = defineProps<{
  client: TavernClient;
  sessionId: string;
  accountId?: string;
  branchId?: string;
  snapshotId?: string | null;
  historySelection: string;
  historyRefreshVersion: number;
  historyMoreVersion: number;
  historyRetryCursor: string | null;
  historySelectionRetryVersion: number;
  historyRetrySnapshotId: string;
  policy: RoleRuntimePolicy;
  assetBaseUrl?: string;
}>();
const emit = defineEmits<{
  ready: [name: string];
  state: [
    state: {
      busy: boolean;
      pending: boolean;
      draft: boolean;
      branchId: string;
    },
  ];
  branch: [branch: { branchId: string }];
  interactionFailure: [error: unknown];
  failure: [error: unknown];
  current: [snapshot: RoleRuntimeSession["current"]];
  history: [
    page: { items: RoleSnapshotPointer[]; append: boolean; hasMore: boolean },
  ];
  historyState: [
    state: {
      busy: boolean;
      following: boolean;
      view: RoleRuntimeSession["current"];
    },
  ];
  historyLoading: [loading: boolean];
  historyFailure: [
    failure: {
      error: unknown;
      action:
        | { kind: "list"; cursor: string | null }
        | { kind: "snapshot"; snapshotId: string }
        | { kind: "latest" };
    },
  ];
}>();
const root = ref<HTMLElement>();
let disposed = false;
const transport = createRoleTransport(props.client, props.sessionId, {
  assetBaseUrl: props.assetBaseUrl,
  branchId: props.branchId,
  operationStorageKey: props.accountId
    ? `tavern.user.chat:${props.accountId}:${props.sessionId}:${props.branchId ?? "main"}:operation`
    : undefined,
  onCurrent: (snapshot) => emit("current", snapshot),
});
let host: ReturnType<typeof createSessionHost> | undefined;
let runtime: ReturnType<typeof createScriptRuntime> | undefined;
let removeViewWatch: (() => void) | undefined;
let removeCommitWatch: (() => void) | undefined;
let historyListGeneration = 0;
let historyReady = false;
let historyPageLoading = false;
let historyCursor: string | null = null;
let runtimeBusy = false;
let historyFollowing = true;
let historySelectionRequest = 0;
let pendingHistorySelections = 0;

function publishHistoryState(view = host?.get("view")) {
  if (!view) return;
  emit("historyState", {
    busy: runtimeBusy,
    following: historyFollowing,
    view,
  });
}

function updateHostState(state: {
  busy: boolean;
  following: boolean;
  current: RoleRuntimeSession["current"];
  view: RoleRuntimeSession["current"];
}) {
  const beganSending = state.busy && !runtimeBusy;
  runtimeBusy = state.busy;
  historyFollowing = state.following;
  if (
    beganSending &&
    (!state.following || pendingHistorySelections > 0) &&
    host
  ) {
    // Invalidate a pending older snapshot read before the live reply starts moving state.
    historySelectionRequest += 1;
    historyFollowing = true;
    void host
      .latest()
      .catch((error: unknown) =>
        emit("historyFailure", { error, action: { kind: "latest" } }),
      );
  }
  publishHistoryState(host?.get("view") ?? state.view);
}

async function requestHistoryPage(
  cursor: string | null,
  append: boolean,
  generation: number,
) {
  if (!host) return;
  historyPageLoading = true;
  emit("historyLoading", true);
  try {
    const page = await host.listSnapshots({
      branchId: host.get("current").branchId,
      ...(cursor === null ? {} : { cursor }),
      limit: interaction.historyPageSize,
    });
    if (disposed || generation !== historyListGeneration) return;
    historyCursor = page.nextCursor;
    emit("history", {
      items: page.items,
      append,
      hasMore: page.nextCursor !== null,
    });
  } catch (error) {
    if (!disposed && generation === historyListGeneration)
      emit("historyFailure", { error, action: { kind: "list", cursor } });
  } finally {
    if (!disposed && generation === historyListGeneration) {
      historyPageLoading = false;
      emit("historyLoading", false);
    }
  }
}

async function refreshHistory() {
  if (!host) return;
  const generation = ++historyListGeneration;
  await requestHistoryPage(null, false, generation);
}

async function loadMoreHistory() {
  if (
    !host ||
    !historyReady ||
    runtimeBusy ||
    historyPageLoading ||
    historyCursor === null
  ) {
    return;
  }
  const cursor = historyCursor;
  await requestHistoryPage(cursor, true, historyListGeneration);
}

async function selectHistory(snapshotId: string) {
  if (!host || !historyReady || runtimeBusy) {
    publishHistoryState();
    return;
  }
  const request = ++historySelectionRequest;
  pendingHistorySelections += 1;
  try {
    if (snapshotId === "latest") {
      await host.latest();
      return;
    }
    await host.select(snapshotId);
  } catch (error) {
    if (disposed || request !== historySelectionRequest) return;
    emit("historyFailure", {
      error,
      action:
        snapshotId === "latest"
          ? { kind: "latest" }
          : { kind: "snapshot", snapshotId },
    });
    publishHistoryState();
  } finally {
    pendingHistorySelections = Math.max(0, pendingHistorySelections - 1);
  }
}

watch(
  () => props.historySelection,
  (snapshotId) => {
    if (historyReady) void selectHistory(snapshotId);
  },
);

watch(
  () => props.historyRefreshVersion,
  () => {
    if (!historyReady) return;
    if (props.historyRetryCursor === null) void refreshHistory();
    else
      void requestHistoryPage(
        props.historyRetryCursor,
        true,
        historyListGeneration,
      );
  },
);

watch(
  () => props.historyMoreVersion,
  () => {
    if (historyReady) void loadMoreHistory();
  },
);

watch(
  () => props.historySelectionRetryVersion,
  () => {
    if (historyReady && props.historyRetrySnapshotId)
      void selectHistory(props.historyRetrySnapshotId);
  },
);

const resume = () => {
  if (!disposed && host && historyReady && !runtimeBusy)
    void host.reconcile().catch((error) => emit("interactionFailure", error));
};
const onVisible = () => {
  if (document.visibilityState === "visible") resume();
};
defineExpose({
  stop: () => host?.stop(),
  reconcile: () => host?.reconcile(),
  hasDraft: () => host?.hasDraft() ?? false,
  dismissTransient: () => host?.dismissTransient() ?? false,
});
onMounted(async () => {
  if (typeof window !== "undefined") window.addEventListener("online", resume);
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", onVisible);
  try {
    const session = await transport.loadSession();
    if (disposed) return;
    host = createSessionHost({
      session,
      transport,
      policy: props.policy,
      errors: apiErrorMessages,
      onState: updateHostState,
      onReport: (error) => {
        if (!disposed) emit("interactionFailure", error);
      },
      onChatState: (state) => {
        if (!disposed)
          emit("state", {
            busy: state.busy,
            pending:
              state.unknown ||
              Boolean(state.pendingMain) ||
              state.pendingInput !== null,
            draft: Boolean(state.draft.trim()) || state.editing,
            branchId: session.branchId,
          });
      },
      onBranch: (branchId) => {
        if (!disposed) emit("branch", { branchId });
      },
      draftKey: props.accountId
        ? `tavern.user.chat:${props.accountId}:${props.sessionId}:${session.branchId}`
        : undefined,
    });
    removeViewWatch = host.watch(
      "view",
      (snapshot: RoleRuntimeSession["current"]) => emit("current", snapshot),
    );
    removeCommitWatch = host.onTurnCommitted(() => {
      void refreshHistory();
    });
    historyFollowing = true;
    publishHistoryState(host.get("view"));
    runtime = createScriptRuntime({
      root: root.value!,
      delivery: session.delivery,
      host,
      policy: props.policy,
      errors: apiErrorMessages,
      validate(name, value) {
        const validator =
          roleRuntimeValidators[name as keyof typeof roleRuntimeValidators];
        return typeof validator === "function" && validator(value);
      },
    });
    await runtime.mount();
    try {
      await host.reconcile();
    } catch (error) {
      if (!disposed) emit("interactionFailure", error);
    }
    if (props.snapshotId && !disposed) await host.select(props.snapshotId);
    if (!disposed) {
      historyReady = true;
      publishHistoryState(host.get("view"));
      await refreshHistory();
      if (!disposed) emit("ready", session.name);
    }
  } catch (error) {
    runtime?.destroy();
    host?.dispose();
    if (!disposed) emit("failure", error);
  }
});
onBeforeUnmount(() => {
  disposed = true;
  if (typeof window !== "undefined")
    window.removeEventListener("online", resume);
  if (typeof document !== "undefined")
    document.removeEventListener("visibilitychange", onVisible);
  historyReady = false;
  historyListGeneration += 1;
  historyPageLoading = false;
  historyCursor = null;
  removeViewWatch?.();
  removeCommitWatch?.();
  runtime?.destroy();
  host?.dispose();
  transport.dispose();
});
</script>

<template>
  <div ref="root" class="role-session" />
</template>

<style scoped>
.role-session {
  flex: 1;
  min-height: 0;
  height: 100%;
  width: 100%;
  overflow: auto;
}
</style>
