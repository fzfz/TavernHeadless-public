import {
  apiErrorMessages,
  createBrowserUuid,
  roleStatePolicy,
  type RoleSessionControllerOptions,
  type RoleRuntimeHost,
  type RoleStateRecalculateOptions,
  type RoleStateRestoreOptions,
} from "@tavern/shared";
import { BoundedCache } from "../../runtime/script-runtime.js";
import { roleRuntimeValidators as schemas } from "@tavern/shared";
import { mountChatWidget } from "./chat-widget.js";
import type { ChatAction, ChatState, ChatTransport } from "./chat-types.js";
import chatLabels from "../../config/chat-ui.json";
import { isUncertainWrite } from "../../lib/request-outcome.js";
const immutable = (value: any) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
};
export function createSessionHost({
  session,
  transport,
  policy,
  errors,
  onState = () => {},
  onReport = () => {},
  onChatState = () => {},
  onBranch = () => {},
  draftKey,
}: RoleSessionControllerOptions & {
  onChatState?: (state: ChatState) => void;
  onBranch?: (branchId: string) => void;
  draftKey?: string;
}) {
  if (!transport)
    throw new TypeError(apiErrorMessages.ROLE_SESSION_TRANSPORT_MISSING);
  const cache = new BoundedCache(policy.historyCache),
    settled = new BoundedCache(policy.settledStreamCache),
    diagnostics = new BoundedCache(policy.diagnosticsCache);
  const callbacks: Record<string, Set<(value: any) => void>> = {
    current: new Set(),
    view: new Set(),
    commit: new Set(),
    text: new Set(),
  };
  const active = new Map(),
    lists = new Set<{
      refresh(): Promise<void>;
      destroy(): void;
      diagnostics(): unknown;
      dismissTransient?(): boolean;
    }>(),
    widgets = new Set<() => void>();
  let current = immutable(session.current),
    view = current,
    following = true,
    busy = false,
    pendingMain = session.processing?.pendingMain || null,
    draft = "",
    pendingInput: string | null = null,
    serial = 0,
    selection = 0,
    stateVersion = 0,
    recoveryVersion = 0;
  const chatTransport = transport as RoleSessionControllerOptions["transport"] &
    Partial<ChatTransport>;
  let pendingAction: ChatAction | undefined;
  let stopRequested = false;
  let stopping = false,
    unknown = false,
    editing = false,
    notice = "";
  if (draftKey && typeof sessionStorage !== "undefined") {
    try {
      draft = sessionStorage.getItem(draftKey) ?? "";
      if (draft) notice = chatLabels.restored;
    } catch {
      /* Storage may be unavailable in private browser sessions. */
    }
  }
  const chatState = (): ChatState => ({
    busy,
    stopping,
    unknown,
    draft,
    pendingInput,
    pendingMain,
    editing,
    notice,
  });
  let stateSyncRequested = false,
    stateSyncRunning = false,
    stateSyncSequence = 0,
    disposed = false;
  let stateSyncTimer: ReturnType<typeof setTimeout> | undefined;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  const error = (code: any) =>
    Object.assign(new Error(String(errors[code] || errors.SCRIPT_FAILED)), {
      code,
    });
  const report = (e: any) => {
    diagnostics.set(String(++serial), {
      code: e.code || "SCRIPT_FAILED",
      message: e.message,
      snapshotId: current.snapshotId,
      versionId: session.versionId,
    });
    onReport(e);
  };
  const safe = (fn: any, ...args: any[]) => {
    try {
      fn(...args);
    } catch (e: any) {
      report(e);
    }
  };
  const notify = (key: any, value: any) =>
    callbacks[key]!.forEach((cb: any) => safe(cb, value));
  const validate = (name: any, value: any) => {
    if (!schemas[name as keyof typeof schemas](value))
      throw error("INVALID_REQUEST");
    return value;
  };
  async function snapshot(id: any) {
    const key = "snapshot:" + id;
    let value = cache.get(key);
    if (!value) {
      value = immutable(validate("record", await transport.getSnapshot(id)));
      if (
        value.sessionId !== session.sessionId ||
        value.branchId !== session.branchId
      )
        throw error("IDENTITY_MISMATCH");
      cache.set(key, value);
    }
    return value;
  }
  function apply(record: any) {
    validate("record", record);
    if (
      record.sessionId !== session.sessionId ||
      record.branchId !== session.branchId
    )
      throw error("IDENTITY_MISMATCH");
    const next = immutable(record);
    if (next.snapshotId !== current.snapshotId) {
      current = next;
      stateVersion++;
      notify("current", current);
    }
    if (following && view.snapshotId !== current.snapshotId) {
      view = current;
      notify("view", view);
    }
    onState({ busy, current, view, following });
    if (!busy) void flushStateSync();
  }
  function watch(scope: any, cb: any) {
    if (!["current", "view"].includes(scope)) throw error("INVALID_REQUEST");
    callbacks[scope]!.add(cb);
    safe(cb, scope === "current" ? current : view);
    return () => callbacks[scope]!.delete(cb);
  }
  function onTextStream(cb: any, filter: any = {}) {
    validate("textStreamFilter", filter);
    const match = (e: any) =>
      (!filter.floorId || e.floorId === filter.floorId) &&
      (!filter.streamId || e.streamId === filter.streamId);
    const listener = (e: any) => {
      if (match(e)) cb(e);
    };
    callbacks.text!.add(listener);
    for (const e of active.values()) safe(listener, { ...e, type: "snapshot" });
    return () => callbacks.text!.delete(listener);
  }
  function text(event: any, versions: any) {
    validate("textStreamEvent", event);
    if (
      event.sessionId !== session.sessionId ||
      event.branchId !== session.branchId
    )
      throw error("IDENTITY_MISMATCH");
    if (
      versions.has(event.streamId) &&
      versions.get(event.streamId) >= event.revision
    )
      return;
    versions.set(event.streamId, event.revision);
    const e = immutable(event);
    if (e.status === "streaming") active.set(e.streamId, e);
    else {
      active.delete(e.streamId);
      if (!e.messageId) settled.set(e.streamId, e);
    }
    notify("text", e);
    if (e.status !== "streaming" && e.messageId) {
      cache.delete("messages:" + e.floorId);
      for (const list of lists) list.refresh().catch(report);
    }
  }
  async function select(id: any) {
    validate("historySelectParams", { snapshotId: id });
    const requestId = ++selection;
    const next = await snapshot(id);
    if (requestId !== selection) return { snapshotId: view.snapshotId };
    following = false;
    if (view.snapshotId !== next.snapshotId) {
      view = next;
      notify("view", view);
    }
    onState({ busy, current, view, following });
    if (!busy) void flushStateSync();
    return { snapshotId: view.snapshotId };
  }
  async function latest() {
    selection++;
    following = true;
    if (view.snapshotId !== current.snapshotId) {
      view = current;
      notify("view", view);
    }
    onState({ busy, current, view, following });
    if (!busy) void flushStateSync();
    return { snapshotId: view.snapshotId };
  }
  function updateWidgets() {
    if (draftKey && typeof sessionStorage !== "undefined") {
      try {
        sessionStorage.setItem(draftKey, draft);
      } catch {
        /* Keep in-memory input when browser storage is unavailable. */
      }
    }
    widgets.forEach((w: any) => w());
    if (!disposed) onChatState(chatState());
  }
  async function reconcile() {
    if (!chatTransport.reconcile || disposed) return;
    if (recoveryTimer !== undefined) {
      clearTimeout(recoveryTimer);
      recoveryTimer = undefined;
    }
    try {
      const result = await chatTransport.reconcile();
      if (disposed) return;
      const restored = await transport.loadSession();
      if (disposed) return;
      pendingMain = restored.processing?.pendingMain ?? null;
      pendingAction = result.retryAction;
      if (result.resolvedEditMessageId) editing = false;
      if (result.response === "saved") {
        if (draft === result.input) draft = "";
        pendingInput = null;
      } else if (result.response === "failed") {
        const failedInput = result.input ?? pendingInput ?? "";
        if (stopRequested) {
          if (!draft.trim()) draft = failedInput;
          pendingInput = null;
        } else pendingInput = failedInput || null;
      } else if (result.response === "unaccepted")
        pendingInput = result.input ?? pendingInput;
      apply(result.current);
      if (result.branchId) onBranch(result.branchId);
      busy = result.busy;
      stopping = false;
      unknown = result.busy;
      if (!result.busy && !pendingMain && pendingInput === null) {
        notice =
          stopRequested && result.response === "failed"
            ? chatLabels.stopped
            : chatLabels.saved;
        stopRequested = false;
      }
      for (const list of lists) await list.refresh();
      if (result.busy)
        recoveryTimer = setTimeout(() => {
          void reconcile().catch(report);
        }, roleStatePolicy.eventReconnectDelayMs);
    } catch (cause: any) {
      if (!disposed) {
        unknown = isUncertainWrite(cause);
        busy = false;
        stopping = false;
      }
      throw cause;
    } finally {
      if (!disposed) {
        updateWidgets();
        onState({ busy, current, view, following });
      }
    }
  }
  async function performAction(action: ChatAction, resuming = false) {
    if (!chatTransport.performAction) throw error("INVALID_REQUEST");
    if (
      busy ||
      unknown ||
      pendingMain ||
      (editing && action.kind !== "edit") ||
      (pendingInput !== null && !resuming)
    )
      throw error("SEND_BUSY");
    busy = true;
    notice = "";
    updateWidgets();
    onState({ busy, current, view, following });
    try {
      const result = await chatTransport.performAction(action, current);
      if (disposed) return;
      apply(result.current);
      pendingAction = undefined;
      pendingInput = null;
      cache.clear();
      if (result.branchId) onBranch(result.branchId);
      notice = action.kind === "delete" ? chatLabels.removed : chatLabels.saved;
      for (const list of lists) await list.refresh();
      return result;
    } catch (cause: any) {
      try {
        const restored = await transport.loadSession();
        if (!disposed) {
          pendingMain = restored.processing?.pendingMain ?? null;
          apply(restored.current);
        }
      } catch (readError) {
        report(readError);
      }
      if (!disposed) for (const list of lists) await list.refresh();
      unknown =
        !pendingMain &&
        isUncertainWrite(cause) &&
        ![
          "INVALID_REQUEST",
          "invalid_state",
          "content_target_locked",
          "IDENTITY_MISMATCH",
        ].includes(cause.code);
      throw cause;
    } finally {
      busy = false;
      updateWidgets();
      onState({ busy, current, view, following });
    }
  }
  const send = (
    { text: input }: any,
    testHeaders: any = {},
    route: any = "/send",
  ) => {
    validate("chatSendParams", { text: input });
    if (busy || unknown || editing) return Promise.reject(error("SEND_BUSY"));
    busy = true;
    notice = "";
    if (route === "/send" && !testHeaders[roleStatePolicy.retryHeader])
      pendingInput = input;
    updateWidgets();
    onState({ busy, current, view, following });
    if (!busy) void flushStateSync();
    return new Promise<{ snapshotId: string }>((resolve: any, reject: any) => {
      let resolved = false;
      let accepted = false;
      const versions = new Map(),
        commits = new Set();
      (async () => {
        const process = (envelope: any) => {
          if (!accepted) {
            accepted = true;
            if (
              route === "/send" &&
              !testHeaders[roleStatePolicy.retryHeader] &&
              draft === input
            )
              draft = "";
            updateWidgets();
          }
          const data = envelope.data;
          if (envelope.type === "text") {
            if (!data.jobId && data.status === "completed" && data.text)
              pendingMain = { input, text: data.text, floorId: data.floorId };
            text(data, versions);
            updateWidgets();
          } else if (envelope.type === "commit") {
            validate("turnCommit", data);
            if (!commits.has(data.eventId)) {
              commits.add(data.eventId);
              pendingMain = null;
              pendingInput = null;
              updateWidgets();
              apply(data.after);
              notify("commit", immutable(data));
              for (const list of lists) list.refresh().catch(report);
            }
          } else if (envelope.type === "current") apply(data);
          else if (envelope.type === "completed") {
            validate("chatSendResult", data);
            resolved = true;
            busy = false;
            stopping = false;
            unknown = false;
            notice = chatLabels.saved;
            updateWidgets();
            onState({ busy, current, view, following });
            if (!busy) void flushStateSync();
            resolve(data);
          } else if (envelope.type === "error") throw error(data.code);
          else throw error("INVALID_REQUEST");
        };
        await transport.send({
          text: input,
          current,
          route,
          testHeaders,
          emit: process,
        });
        if (!resolved || [...active.keys()].some((id: any) => versions.has(id)))
          throw error("RESULT_UNKNOWN");
      })()
        .catch(async (e: any) => {
          const failure = e.code ? e : error("RESULT_UNKNOWN");
          const preservePendingMain = Boolean(pendingMain);
          let resultReconciled = false;
          for (const [id, event] of active) {
            if (versions.has(id)) {
              const interrupted = immutable({
                ...event,
                type: "snapshot",
                status: "failed",
                error: {
                  code: failure.code,
                  message: failure.message,
                },
              });
              active.delete(id);
              settled.set(id, interrupted);
              notify("text", interrupted);
            }
          }
          {
            try {
              const recoveryId = ++recoveryVersion;
              const stateVersionAtRequest = stateVersion;
              const restored = await transport.loadSession();
              if (
                recoveryId === recoveryVersion &&
                stateVersion === stateVersionAtRequest
              ) {
                const restoredPendingMain =
                  restored.processing?.pendingMain || null;
                if (preservePendingMain) {
                  if (
                    !restoredPendingMain &&
                    restored.current.snapshotId !== current.snapshotId
                  ) {
                    pendingMain = null;
                    pendingInput = null;
                  } else {
                    pendingMain = restoredPendingMain || pendingMain;
                  }
                } else {
                  pendingMain = restoredPendingMain;
                }
                apply(restored.current);
                for (const list of lists) list.refresh().catch(report);
              }
            } catch (syncError) {
              report(syncError);
            }
          }
          if (!resolved && chatTransport.reconcile && !pendingMain) {
            try {
              await reconcile();
              resultReconciled = true;
            } catch (readError) {
              report(readError);
            }
          }
          if (!resolved) {
            if (chatTransport.reconcile && !resultReconciled) {
              unknown =
                !pendingMain &&
                (failure.code === "RESULT_UNKNOWN" ||
                  failure.name === "AbortError" ||
                  isUncertainWrite(failure) ||
                  failure.status === 409);
              if (
                failure.status >= 400 &&
                failure.status < 500 &&
                failure.status !== 409 &&
                !isUncertainWrite(failure) &&
                !pendingMain
              ) {
                if (!draft.trim()) draft = pendingInput ?? input;
                pendingInput = null;
              }
            }
            stopping = false;
            if (!resultReconciled) busy = false;
            updateWidgets();
            onState({ busy, current, view, following });
            if (!busy) void flushStateSync();
            reject(failure);
          } else report(failure);
        })
        .finally(() => {
          versions.clear();
          commits.clear();
        });
    });
  };
  async function listFloors(params: any) {
    validate("messagesListFloorsParams", params);
    return validate(
      "messagesListFloorsResult",
      await transport.listFloors(params),
    );
  }
  function retryPendingResponse() {
    if (pendingAction) return performAction(pendingAction, true);
    if (busy || pendingInput === null || pendingMain)
      return Promise.reject(error("INVALID_REQUEST"));
    return send({ text: pendingInput });
  }
  function retryPendingStateUpdate() {
    if (busy || !pendingMain)
      return Promise.reject(error("STATE_RETRY_INVALID"));
    return send(
      { text: pendingMain.input },
      { [roleStatePolicy.retryHeader]: "true" },
    );
  }
  async function repairState(
    kind: "recalculate" | "restore",
    params: RoleStateRestoreOptions | RoleStateRecalculateOptions,
  ) {
    validate(
      kind === "recalculate"
        ? "variablesRecalculateLatestParams"
        : "variablesRestoreMissingParams",
      params,
    );
    if (busy || pendingMain) throw error("SEND_BUSY");
    if (
      params.branchId !== session.branchId ||
      params.expectedSnapshotId !== current.snapshotId
    )
      throw error("IDENTITY_MISMATCH");
    busy = true;
    updateWidgets();
    onState({ busy, current, view, following });
    if (!busy) void flushStateSync();
    try {
      const operationId = createBrowserUuid();
      const result = validate(
        "variablesStateOperationResult",
        kind === "recalculate"
          ? await transport.recalculateLatest({
              ...(params as RoleStateRecalculateOptions),
              operationId,
            })
          : await transport.restoreMissing({ ...params, operationId }),
      );
      if (
        result.operationId !== operationId ||
        result.before.snapshotId !== params.expectedSnapshotId ||
        result.after.sessionId !== session.sessionId ||
        result.after.branchId !== session.branchId
      )
        throw error("IDENTITY_MISMATCH");
      if (
        current.snapshotId === result.before.snapshotId ||
        current.snapshotId === result.after.snapshotId
      )
        apply(result.after);
      for (const list of lists) list.refresh().catch(report);
      return immutable(result);
    } finally {
      busy = false;
      updateWidgets();
      onState({ busy, current, view, following });
      if (!busy) void flushStateSync();
    }
  }
  async function flushStateSync() {
    if (disposed || busy || stateSyncRunning || !stateSyncRequested) return;
    if (stateSyncTimer !== undefined) {
      clearTimeout(stateSyncTimer);
      stateSyncTimer = undefined;
    }
    stateSyncRequested = false;
    stateSyncRunning = true;
    const sequence = stateSyncSequence,
      version = stateVersion;
    try {
      const latest = await transport.getCurrentSnapshot();
      if (
        !disposed &&
        !busy &&
        sequence === stateSyncSequence &&
        version === stateVersion
      ) {
        const changed = latest.snapshotId !== current.snapshotId;
        apply(latest);
        updateWidgets();
        if (changed) for (const list of lists) list.refresh().catch(report);
      } else if (!disposed) stateSyncRequested = true;
    } catch (cause) {
      if (!disposed) {
        report(cause);
        stateSyncRequested = true;
        stateSyncTimer = setTimeout(() => {
          stateSyncTimer = undefined;
          void flushStateSync();
        }, roleStatePolicy.eventReconnectDelayMs);
      }
    } finally {
      stateSyncRunning = false;
      if (
        !disposed &&
        !busy &&
        stateSyncRequested &&
        stateSyncTimer === undefined
      )
        void flushStateSync();
    }
  }
  const unsubscribeState = transport.subscribeState({
    branchId: session.branchId,
    onCurrent(record) {
      if (disposed) return;
      if (
        record.sessionId !== session.sessionId ||
        record.branchId !== session.branchId
      ) {
        report(error("IDENTITY_MISMATCH"));
        return;
      }
      stateSyncSequence++;
      stateSyncRequested = true;
      void flushStateSync();
    },
    onError: report,
  });
  const host = {
    chatState,
    reconcile,
    performAction,
    dismissTransient() {
      return [...lists].reverse().some((list) => list.dismissTransient?.());
    },
    async stop() {
      if (!busy) return;
      stopping = true;
      stopRequested = true;
      updateWidgets();
      try {
        await chatTransport.stop?.();
        await reconcile();
      } catch (cause) {
        unknown = true;
        stopping = false;
        updateWidgets();
        report(cause);
      }
    },
    hasDraft() {
      return Boolean(draft.trim() || editing);
    },
    recalculateLatest: (params: RoleStateRecalculateOptions) =>
      repairState("recalculate", params),
    restoreMissing: (params: RoleStateRestoreOptions) =>
      repairState("restore", params),
    dispose() {
      disposed = true;
      if (stateSyncTimer !== undefined) clearTimeout(stateSyncTimer);
      if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
      unsubscribeState();
      transport.dispose();
      for (const list of lists) list.destroy();
      lists.clear();
      widgets.clear();
      active.clear();
      Object.values(callbacks).forEach((listeners) => listeners.clear());
      cache.clear();
      settled.clear();
      diagnostics.clear();
    },
    get: (scope: any) => (scope === "view" ? view : current),
    watch,
    onTurnCommitted(cb: any) {
      callbacks.commit!.add(cb);
      return () => callbacks.commit!.delete(cb);
    },
    onTextStream,
    getSnapshot: snapshot,
    async getMessages(params: any) {
      validate("messagesGetFloorParams", params);
      return immutable(
        validate("messagesGetFloorResult", await transport.getMessages(params)),
      );
    },
    listFloors,
    async listSnapshots(params: any) {
      validate("historyListSnapshotsParams", params);
      return immutable(
        validate(
          "historyListSnapshotsResult",
          await transport.listSnapshots(params),
        ),
      );
    },
    retryPendingResponse,
    retryPendingStateUpdate,
    select,
    latest,
    async setDraft(text: any) {
      validate("chatSetDraftParams", { text });
      draft = text;
      updateWidgets();
      return null;
    },
    send,
    report,
    diagnostics() {
      return {
        busy,
        chatWidgets: widgets.size,
        activeStreams: active.size,
        listeners: Object.fromEntries(
          Object.entries(callbacks).map(([k, v]: any) => [k, v.size]),
        ),
        history: { entries: cache.size, bytes: cache.bytes },
        settled: { entries: settled.size, bytes: settled.bytes },
        diagnostics: { entries: diagnostics.size, bytes: diagnostics.bytes },
        lists: [...lists].map((l: any) => l.diagnostics()),
      };
    },
    mountChat(element: HTMLElement) {
      const mounted = mountChatWidget(element, {
        editorStorageKey: draftKey ? `${draftKey}:editor` : undefined,
        readingStorageKey: draftKey ? `${draftKey}:reading` : undefined,
        session,
        state: chatState,
        subscribe(update) {
          widgets.add(update);
          update();
          return () => widgets.delete(update);
        },
        onText: onTextStream,
        listFloors,
        getMessages: (floorId) =>
          transport.getMessages({ branchId: session.branchId, floorId }),
        getContext: chatTransport.getFloorContext?.bind(chatTransport),
        getRevision: chatTransport.getMessageRevision?.bind(chatTransport),
        listBranches: chatTransport.listBranches?.bind(chatTransport),
        selectBranch: onBranch,
        setDraft(text) {
          draft = text;
          notice = "";
          updateWidgets();
        },
        setEditing(value) {
          editing = value;
          updateWidgets();
        },
        send: () => send({ text: draft }),
        stop: () => host.stop(),
        reconcile,
        retryResponse: retryPendingResponse,
        retryState: retryPendingStateUpdate,
        perform: chatTransport.performAction ? performAction : undefined,
        report,
      });
      lists.add(mounted);
      const destroy = mounted.destroy;
      return {
        destroy() {
          destroy();
          lists.delete(mounted);
        },
      };
    },
  };
  return host satisfies RoleRuntimeHost;
}
