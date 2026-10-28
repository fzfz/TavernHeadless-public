import {
  apiErrorMessages,
  createBrowserUuid,
  roleStatePolicy,
  type RoleRuntimeTransport,
  type RoleRuntimeSession,
  type RoleTextEvent,
  type RoleMessage,
  type RoleEnvelope,
} from "@tavern/shared";
import type { TavernClient, TavernRespondStreamEvent } from "@tavern/sdk";
import type {
  ChatTransport,
  ChatFloorContext,
  ChatAction,
} from "./chat-types.js";
import chatLabels from "../../config/chat-ui.json";
import interactionPolicy from "../../config/role-interaction.json";
import { isUncertainWrite } from "../../lib/request-outcome.js";

function failure(
  code: keyof typeof apiErrorMessages,
): Error & { code: string } {
  return Object.assign(new Error(String(apiErrorMessages[code])), { code });
}

export function createRoleTransport(
  client: TavernClient,
  sessionId: string,
  options: {
    assetBaseUrl?: string;
    branchId?: string;
    operationStorageKey?: string;
    onCurrent?: (snapshot: RoleRuntimeSession["current"]) => void;
  } = {},
): ChatTransport {
  const stateSubscriptions = new Set<() => void>();
  let pendingStateFloorId: string | null = null;
  let activeRequest: AbortController | undefined;
  let pendingOperation: {
    id: string;
    input: string;
    action?: ChatAction;
  } | null = null;
  type PendingMutation = {
    action: ChatAction;
    operationId: string;
    expectedSnapshotId: string;
    expectedRevisionNo?: number;
    branchId: string;
    createdBranchId?: string;
  };
  let pendingMutation: PendingMutation | null = null;
  const mutationKey = options.operationStorageKey
    ? `${options.operationStorageKey}:mutation`
    : undefined;
  if (mutationKey && typeof sessionStorage !== "undefined") {
    try {
      const saved = JSON.parse(sessionStorage.getItem(mutationKey) ?? "null");
      if (
        saved &&
        typeof saved.operationId === "string" &&
        typeof saved.action?.kind === "string"
      )
        pendingMutation = saved;
    } catch {
      /* Keep the active page usable if browser storage is unavailable. */
    }
  }
  const saveMutation = () => {
    if (mutationKey && typeof sessionStorage !== "undefined") {
      try {
        if (pendingMutation)
          sessionStorage.setItem(mutationKey, JSON.stringify(pendingMutation));
        else sessionStorage.removeItem(mutationKey);
      } catch {
        /* Keep the active in-memory mutation. */
      }
    }
  };
  if (options.operationStorageKey && typeof sessionStorage !== "undefined") {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(options.operationStorageKey) ?? "null",
      );
      if (
        saved &&
        typeof saved.id === "string" &&
        typeof saved.input === "string"
      )
        pendingOperation = saved;
    } catch {
      /* Storage is optional; the active page retains its operation. */
    }
  }
  const saveOperation = () => {
    if (options.operationStorageKey && typeof sessionStorage !== "undefined") {
      try {
        if (pendingOperation)
          sessionStorage.setItem(
            options.operationStorageKey,
            JSON.stringify(pendingOperation),
          );
        else sessionStorage.removeItem(options.operationStorageKey);
      } catch {
        /* Keep the active in-memory operation. */
      }
    }
  };
  const beginOperation = (input: string, action?: ChatAction) => {
    pendingOperation ??= { id: createBrowserUuid(), input, action };
    saveOperation();
    return pendingOperation.id;
  };
  const getMessages = async ({
    floorId,
    branchId,
  }: {
    floorId: string;
    branchId: string;
  }): Promise<RoleMessage[]> => {
    const messages = await client.roleRuntime.getMessages({
      sessionId,
      branchId,
      floorId,
    });
    return messages.map((message) => ({
      id: message.id,
      role:
        message.role === "user"
          ? "user"
          : message.role === "assistant"
            ? "assistant"
            : "agent",
      text: message.content,
      floorId,
      streamId: message.source ?? message.id,
      status: "completed",
    }));
  };
  const loadSession = async (): Promise<RoleRuntimeSession> => {
    const view = await client.roleRuntime.getView({
      sessionId,
      ...(options.branchId ? { branchId: options.branchId } : {}),
    });
    if (options.assetBaseUrl) {
      const resolveAsset = (path: string) => {
        const base = new URL(
          `${options.assetBaseUrl!.replace(/\/$/, "")}/`,
          globalThis.location?.href,
        );
        return new URL(path.replace(/^\//, ""), base).href;
      };
      if (view.delivery.scriptUrl)
        view.delivery.scriptUrl = resolveAsset(view.delivery.scriptUrl);
      if (view.delivery.htmlUrl)
        view.delivery.htmlUrl = resolveAsset(view.delivery.htmlUrl);
      if (view.delivery.cssUrl)
        view.delivery.cssUrl = resolveAsset(view.delivery.cssUrl);
      if (view.delivery.floorHtmlUrl)
        view.delivery.floorHtmlUrl = resolveAsset(view.delivery.floorHtmlUrl);
      for (const [key, path] of Object.entries(view.delivery.dataUrls ?? {}))
        view.delivery.dataUrls![key] = resolveAsset(path);
      for (const asset of Object.values(view.delivery.assets))
        asset.url = resolveAsset(asset.url);
    }
    options.onCurrent?.(view.current);
    pendingStateFloorId = view.processing.pendingStateFloorId;
    let pendingMain: RoleRuntimeSession["processing"]["pendingMain"] = null;
    if (pendingStateFloorId) {
      const messages = await getMessages({
        floorId: pendingStateFloorId,
        branchId: view.current.branchId,
      });
      pendingMain = {
        floorId: pendingStateFloorId,
        input:
          messages.filter((item) => item.role === "user").at(-1)?.text ?? "",
        text:
          messages.filter((item) => item.role === "assistant").at(-1)?.text ??
          "",
      };
    }
    if (!view.character_id || !view.name)
      throw failure("ROLE_VIEW_CONFIG_INVALID");
    return {
      sessionId,
      branchId: view.current.branchId,
      characterId: view.character_id,
      versionId: view.character_version_id,
      name: view.name,
      current: view.current,
      initial: view.initial,
      messages: [],
      delivery: view.delivery,
      capabilities: view.capabilities,
      processing: {
        pendingMain,
        pendingFollowups: view.processing.pendingFollowups,
      },
    };
  };
  const getFloorContext = async (
    floorId: string,
  ): Promise<ChatFloorContext> => {
    const floor = await client.floors.getDetail({ floorId });
    if (floor.sessionId !== sessionId) throw failure("IDENTITY_MISMATCH");
    const pages: ChatFloorContext["pages"] = [];
    for (let offset = 0; ; offset += interactionPolicy.historyPageSize) {
      const page = await client.pages.list({
        floorId,
        limit: interactionPolicy.historyPageSize,
        offset,
        sortBy: "page_no",
        sortOrder: "asc",
      });
      pages.push(...page);
      if (page.length < interactionPolicy.historyPageSize) break;
    }
    const candidates = await client.replyCandidates.list({ floorId });
    const latest = await client.roleRuntime.getView({
      sessionId,
      branchId: options.branchId ?? floor.branchId,
    });
    const messagePages: Record<string, string> = {};
    for (const page of pages) {
      for (let offset = 0; ; offset += interactionPolicy.historyPageSize) {
        const messages = await client.messages.list({
          pageId: page.id,
          limit: interactionPolicy.historyPageSize,
          offset,
          sortBy: "seq",
          sortOrder: "asc",
        });
        for (const message of messages) messagePages[message.id] = page.id;
        if (messages.length < interactionPolicy.historyPageSize) break;
      }
    }
    const inherited = floor.branchId !== (options.branchId ?? "main");
    const locked =
      inherited || floor.state === "generating" || floor.supersededAt !== null;
    return {
      floor,
      pages,
      messagePages,
      candidates: {
        ...candidates,
        canActivate: !inherited && candidates.canActivate,
      },
      canEdit: !locked,
      canDelete: !locked,
      canGenerate:
        !locked &&
        floor.state === "committed" &&
        floor.floorNo > 0 &&
        latest.current.floorId === floorId,
      reason: inherited
        ? chatLabels.inherited
        : floor.state === "generating"
          ? chatLabels.generatingLocked
          : floor.supersededAt !== null
            ? chatLabels.supersededLocked
            : "",
    };
  };
  const replayMutation = async (pending: PendingMutation) => {
    const action = pending.action;
    let branchId: string | undefined;
    if (action.kind === "edit" || action.kind === "delete") {
      if (pending.expectedRevisionNo !== undefined) {
        const receipt = await client.messages.createManualRevision({
          messageId: action.messageId,
          action: action.kind,
          ...(action.kind === "edit" ? { content: action.text } : {}),
          expectedLatestRevisionNo: pending.expectedRevisionNo,
          operationId: pending.operationId,
        });
        if (
          receipt.operationId !== pending.operationId ||
          receipt.appliedRevisionNo !== pending.expectedRevisionNo + 1
        )
          throw failure("RESULT_UNKNOWN");
      } else if (action.kind === "edit")
        await client.messages.update({
          messageId: action.messageId,
          content: action.text,
        });
      else {
        try {
          await client.messages.remove({ messageId: action.messageId });
        } catch (cause: any) {
          if (cause.status !== 404) throw cause;
        }
      }
    } else if (action.kind === "candidate") {
      await client.replyCandidates.activate({
        sessionId,
        branchId: pending.branchId,
        floorId: action.candidateFloorId,
        expectedSnapshotId: pending.expectedSnapshotId,
        operationId: pending.operationId,
      });
    } else if (action.kind === "branch") {
      branchId = (
        await client.floors.branch({
          floorId: action.floorId,
          branchId: pending.createdBranchId,
        })
      ).branchId;
    }
    pendingMutation = null;
    saveMutation();
    return { branchId };
  };
  return {
    loadSession,
    getFloorContext,
    async getMessageRevision(messageId, floorId) {
      const saved = await client.messages.getManualRevisions({ messageId });
      const projected = (
        await getMessages({ floorId, branchId: options.branchId ?? "main" })
      ).find((message) => message.id === messageId);
      return {
        revisionNo: saved.latestRevisionNo,
        content: projected?.text ?? "",
        hidden: saved.currentHidden || !projected,
      };
    },
    async stop() {
      activeRequest?.abort();
      if (pendingOperation)
        await client.sessions.stopResponseOperation({
          sessionId,
          operationId: pendingOperation.id,
        });
    },
    async reconcile() {
      let branchId: string | undefined;
      const resolvedEditMessageId =
        pendingMutation?.action.kind === "edit"
          ? pendingMutation.action.messageId
          : undefined;
      if (pendingMutation) {
        try {
          branchId = (await replayMutation(pendingMutation)).branchId;
        } catch (cause: any) {
          if (
            cause.status >= 400 &&
            cause.status < 500 &&
            !isUncertainWrite(cause)
          ) {
            pendingMutation = null;
            saveMutation();
          }
          throw cause;
        }
      }
      let response: "saved" | "failed" | "unaccepted" | undefined;
      const input = pendingOperation?.input;
      if (pendingOperation) {
        try {
          const operation = await client.sessions.getResponseOperation({
            sessionId,
            operationId: pendingOperation.id,
          });
          if (options.branchId && operation.branchId !== options.branchId)
            throw failure("IDENTITY_MISMATCH");
          if (operation.floorState === "committed") {
            await client.roleRuntime.updateState({
              sessionId,
              floorId: operation.floorId,
            });
            pendingOperation = null;
            saveOperation();
            response = "saved";
          } else if (
            operation.floorState === "failed" ||
            operation.runStatus === "failed" ||
            operation.runStatus === "cancelled"
          ) {
            pendingOperation = null;
            saveOperation();
            response = "failed";
          }
        } catch (cause: any) {
          if (cause.status === 404) response = "unaccepted";
          else throw cause;
        }
      }
      const [view, run] = await Promise.all([
        client.roleRuntime.getView({
          sessionId,
          ...(options.branchId ? { branchId: options.branchId } : {}),
        }),
        client.sessions.getActiveRun({ sessionId }),
      ]);
      return {
        current: view.current,
        busy:
          Boolean(run.activeRun?.busy) ||
          Boolean(pendingOperation && !response),
        response,
        input,
        retryAction:
          response === "unaccepted" ? pendingOperation?.action : undefined,
        resolvedEditMessageId,
        branchId,
      };
    },
    listBranches: () => client.sessions.listBranches({ sessionId }),
    async performAction(action, current) {
      if (activeRequest || pendingMutation) throw failure("SEND_BUSY");
      const context = await getFloorContext(action.floorId);
      if (
        action.kind !== "branch" &&
        context.floor.branchId !== current.branchId
      )
        throw failure("IDENTITY_MISMATCH");
      if ("messageId" in action && !context.messagePages[action.messageId])
        throw failure("INVALID_REQUEST");
      if (action.kind === "continue" || action.kind === "regenerate") {
        if (!context.canGenerate || current.floorId !== action.floorId)
          throw Object.assign(new Error(chatLabels.latestOnly), {
            code: "invalid_state",
          });
        const result = await (
          action.kind === "continue"
            ? client.sessions.respond({
                sessionId,
                branchId: current.branchId,
                clientOperationId: beginOperation("", action),
                promptIntent: "continue",
                message: "",
              })
            : client.sessions.regenerate({
                sessionId,
                branchId: current.branchId,
                clientOperationId: beginOperation("", action),
              })
        ).catch((cause) => {
          if (!isUncertainWrite(cause) && cause.status !== 409) {
            pendingOperation = null;
            saveOperation();
          }
          throw cause;
        });
        await client.roleRuntime.updateState({
          sessionId,
          floorId: result.floorId,
        });
        pendingOperation = null;
        saveOperation();
      } else {
        if (action.kind === "edit" && (!action.text.trim() || !context.canEdit))
          throw Object.assign(
            new Error(context.reason || chatLabels.required),
            { code: "content_target_locked" },
          );
        if (action.kind === "delete" && !context.canDelete)
          throw Object.assign(new Error(context.reason), {
            code: "content_target_locked",
          });
        if (
          action.kind === "candidate" &&
          (!context.candidates.canActivate ||
            !context.candidates.items.some(
              (candidate) => candidate.floorId === action.candidateFloorId,
            ))
        )
          throw failure("INVALID_REQUEST");
        if (
          (action.kind === "edit" || action.kind === "delete") &&
          context.floor.state === "committed" &&
          action.expectedRevisionNo === undefined
        )
          throw failure("INVALID_REQUEST");
        pendingMutation = {
          action,
          operationId: createBrowserUuid(),
          expectedSnapshotId: current.snapshotId,
          branchId: current.branchId,
          ...(action.kind === "branch"
            ? { createdBranchId: `branch-${createBrowserUuid()}` }
            : {}),
        };
        if (
          (action.kind === "edit" || action.kind === "delete") &&
          context.floor.state === "committed"
        )
          pendingMutation.expectedRevisionNo = action.expectedRevisionNo;
        saveMutation();
        try {
          const result = await replayMutation(pendingMutation);
          if (result.branchId) return { current, branchId: result.branchId };
        } catch (cause: any) {
          if (
            cause.status >= 400 &&
            cause.status < 500 &&
            !isUncertainWrite(cause)
          ) {
            pendingMutation = null;
            saveMutation();
          }
          throw cause;
        }
      }
      return {
        current: (
          await client.roleRuntime.getView({
            sessionId,
            branchId: current.branchId,
          })
        ).current,
      };
    },
    getCurrentSnapshot: async () =>
      (
        await client.roleRuntime.getView({
          sessionId,
          ...(options.branchId ? { branchId: options.branchId } : {}),
        })
      ).current,
    recalculateLatest: (params) =>
      client.roleRuntime.recalculateLatest({ sessionId, ...params }),
    restoreMissing: (params) =>
      client.roleRuntime.restoreMissing({ sessionId, ...params }),
    subscribeState({ branchId, onCurrent, onError }) {
      let stopped = false;
      let controller: AbortController | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        stopped = true;
        controller?.abort();
        if (timer) clearTimeout(timer);
        stateSubscriptions.delete(stop);
      };
      const connect = async () => {
        controller = new AbortController();
        try {
          await client.roleRuntime.streamState({
            sessionId,
            branchId,
            signal: controller.signal,
            onCurrent: (snapshot) => {
              if (!stopped) onCurrent(snapshot);
            },
            onRepair: (event) => {
              if (!stopped) onCurrent(event.after);
            },
          });
          if (!stopped) onError(failure("RESULT_UNKNOWN"));
        } catch (cause) {
          if (!stopped)
            onError(cause instanceof Error ? cause : new Error(String(cause)));
        } finally {
          if (!stopped)
            timer = setTimeout(() => {
              void connect();
            }, roleStatePolicy.eventReconnectDelayMs);
        }
      };
      stateSubscriptions.add(stop);
      void connect();
      return stop;
    },
    getMessages,
    getSnapshot: (snapshotId) =>
      client.roleRuntime.getSnapshot({ sessionId, snapshotId }),
    listSnapshots: (query) =>
      client.roleRuntime.listSnapshots({ sessionId, ...query }),
    listFloors: (query) =>
      client.roleRuntime.listFloors({ sessionId, ...query }),
    async send({ text, current, route, testHeaders, emit }) {
      if (activeRequest) throw failure("SEND_BUSY");
      const retryState = testHeaders[roleStatePolicy.retryHeader] === "true";
      if (
        route !== "/send" ||
        Object.keys(testHeaders).some(
          (key) => key !== roleStatePolicy.retryHeader,
        )
      )
        throw failure("INVALID_REQUEST");
      const controller = new AbortController();
      activeRequest = controller;
      try {
        let floorId = pendingStateFloorId;
        if (!retryState) {
          let stream: RoleTextEvent | undefined;
          let revision = 0;
          let chain = Promise.resolve();
          let eventFailure: unknown;
          const consume = async (event: TavernRespondStreamEvent) => {
            if (event.type === "start") {
              if (!event.payload.floorId || !event.payload.branchId)
                throw failure("RESULT_UNKNOWN");
              const { run } = await client.floors.getRun({
                floorId: event.payload.floorId,
              });
              if (!run) throw failure("RESULT_UNKNOWN");
              stream = {
                sessionId,
                branchId: event.payload.branchId,
                floorId: event.payload.floorId,
                attemptId: `${run.runId}:${run.attemptNo}`,
                streamId: `response:${event.payload.floorId}`,
                runId: run.runId,
                jobId: null,
                messageId: null,
                revision: revision++,
                type: "start",
                status: "streaming",
                text: "",
                error: null,
              };
              emit({ type: "text", data: stream });
            } else if (event.type === "role_text") {
              if (!stream) throw failure("RESULT_UNKNOWN");
              stream = {
                ...stream,
                type: "update",
                revision: revision++,
                text: event.payload.text,
              };
              emit({ type: "text", data: stream });
            }
          };
          let response;
          try {
            response = await client.sessions.respondStream({
              sessionId,
              branchId: current.branchId,
              clientOperationId: beginOperation(text),
              message: text,
              signal: controller.signal,
              onEvent(event) {
                chain = chain
                  .then(() => consume(event))
                  .catch((error: unknown) => {
                    eventFailure ??= error;
                    controller.abort(error);
                  });
              },
            });
          } catch (error) {
            await chain;
            throw eventFailure ?? error;
          }
          await chain;
          if (eventFailure) throw eventFailure;
          if (!stream || stream.floorId !== response.floorId)
            throw failure("RESULT_UNKNOWN");
          floorId = response.floorId;
          const messages = await getMessages({
            floorId,
            branchId: stream.branchId,
          });
          const assistant = messages
            .filter((message) => message.role === "assistant")
            .at(-1);
          emit({
            type: "text",
            data: {
              ...stream,
              revision: revision++,
              type: "end",
              status: "completed",
              messageId: assistant?.id ?? null,
              text: assistant?.text ?? "",
            },
          });
          pendingStateFloorId = floorId;
        }
        if (!floorId) throw failure("STATE_RETRY_INVALID");
        const after = await client.roleRuntime
          .updateState({
            sessionId,
            floorId,
            signal: controller.signal,
          })
          .catch((cause: unknown) => {
            throw Object.assign(failure("ROLE_STATE_UPDATE_FAILED"), { cause });
          });
        pendingStateFloorId = null;
        pendingOperation = null;
        saveOperation();
        options.onCurrent?.(after);
        const commit: RoleEnvelope = {
          type: "commit",
          data: {
            eventId: `commit:${after.snapshotId}`,
            sessionId,
            branchId: after.branchId,
            kind: "generated",
            previousCurrentSnapshotId: current.snapshotId,
            before: current,
            after,
          },
        };
        emit(commit);
        emit({ type: "completed", data: { snapshotId: after.snapshotId } });
      } catch (cause: any) {
        if (
          cause.status >= 400 &&
          cause.status < 500 &&
          cause.status !== 409 &&
          !isUncertainWrite(cause)
        ) {
          pendingOperation = null;
          saveOperation();
        }
        throw cause;
      } finally {
        activeRequest = undefined;
      }
    },
    dispose() {
      for (const stop of stateSubscriptions) stop();
      activeRequest?.abort();
    },
  };
}
