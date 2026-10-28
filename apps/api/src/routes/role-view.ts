import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  gte,
  lt,
  sql,
} from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  apiErrorMessages,
  statePromptDryRunRequestJsonSchema,
  statePromptPreviewResponseJsonSchema,
  statePromptDryRunRequestSchema,
  type StatePromptDryRunRequest,
  roleStateProposalInspectionInputJsonSchema,
  roleStateProposalInspectionResponseJsonSchema,
  roleStateProposalInspectionInputSchema,
  type RoleStateProposalInspectionInput,
  roleSessionParamsJsonSchema,
  roleViewResponseJsonSchema,
  roleViewQueryJsonSchema,
  roleSnapshotParamsJsonSchema,
  roleSnapshotResponseJsonSchema,
  roleSnapshotListQueryJsonSchema,
  roleSnapshotPageResponseJsonSchema,
  roleFloorListQueryJsonSchema,
  roleFloorPageResponseJsonSchema,
  roleStateUpdateRequestJsonSchema,
  roleMessagesSchema,
  stateContractParamsJsonSchema,
  stateContractResponseJsonSchema,
  roleMessagesQueryJsonSchema,
  roleMessagesResponseJsonSchema,
  roleRuntimeHistoryPagination,
  roleStateRecalculateRequestJsonSchema,
  roleStateRestoreMissingRequestJsonSchema,
  roleStateRepairResponseJsonSchema,
  roleStateOperationParamsJsonSchema,
  roleStateOperationResponseJsonSchema,
  roleStateRepairEventsQueryJsonSchema,
  type RoleStateRecalculateRequest,
  type RoleStateRestoreMissingRequest,
  decodeRoleHistoryCursor,
  encodeRoleHistoryCursor,
} from "@tavern/shared";
import {
  findModelCallPersistenceError,
  modelCallPersistenceDetails,
} from "@tavern/core";
import type { AppDb } from "../db/client.js";
import { floors, messagePages, messages } from "../db/schema.js";
import { authHasCapability, getRequestAuthContext } from "../plugins/auth.js";
import { sendError } from "../lib/http.js";
import { createPersistentSseLifecycle } from "../lib/persistent-sse-lifecycle.js";
import { loadSessionOutput } from "../services/preset-output.js";
import type { DisplaySnapshotService } from "../services/role-runtime/display-snapshot-service.js";
import type { StateUpdateService } from "../services/role-runtime/state-update-service.js";
import type { RoleViewService } from "../services/role-runtime/role-view-service.js";
import {
  RoleRuntimeError,
  RoleStateOperationReplayError,
} from "../services/role-runtime/runtime-error.js";
import { RoleAssetError } from "../services/role-runtime/role-asset-service.js";
import { roleBranchFloorFilter } from "../services/role-runtime/role-branch-history.js";

export async function registerRoleViewRoutes(
  app: FastifyInstance,
  db: AppDb,
  snapshots: DisplaySnapshotService,
  updates: StateUpdateService,
  views: RoleViewService,
  options: { enablePromptDryRun?: boolean } = {},
) {
  const sseLifecycle = createPersistentSseLifecycle(app);
  const fail = (error: unknown, reply: FastifyReply) => {
    if (
      error instanceof RoleRuntimeError ||
      error instanceof RoleStateOperationReplayError
    )
      return sendError(
        reply,
        error.statusCode,
        error.code,
        error.message,
        error.details,
      );
    if (error instanceof RoleAssetError)
      return sendError(
        reply,
        error.code === "ROLE_ASSET_FILE_MISSING" ? 503 : 409,
        error.code,
        error.message,
        error.details,
      );
    const persistence = findModelCallPersistenceError(error);
    if (persistence)
      return sendError(
        reply,
        503,
        persistence.code,
        apiErrorMessages.MODEL_CALL_SAVE_FAILED,
        modelCallPersistenceDetails(error),
      );
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string" &&
      error.code in apiErrorMessages
    ) {
      return sendError(
        reply,
        422,
        error.code,
        String(apiErrorMessages[error.code as keyof typeof apiErrorMessages]),
      );
    }
    throw error;
  };
  app.get<{ Params: { id: string; versionId: string } }>(
    "/characters/:id/versions/:versionId/state-contract",
    {
      schema: {
        tags: ["role-runtime"],
        operationId: "getRoleStateContract",
        params: stateContractParamsJsonSchema,
        response: { 200: stateContractResponseJsonSchema },
      },
    },
    async (request, reply) => {
      try {
        return {
          data: await updates.contract(
            getRequestAuthContext(request).accountId,
            request.params.id,
            request.params.versionId,
          ),
        };
      } catch (error) {
        return fail(error, reply);
      }
    },
  );
  app.addHook("preHandler", async (request, reply) => {
    if (
      request.method !== "POST" ||
      !["/sessions/:id/respond", "/sessions/:id/respond/stream"].includes(
        request.routeOptions.url ?? "",
      )
    )
      return;
    const id = (request.params as { id: string }).id;
    const accountId = getRequestAuthContext(request).accountId;
    try {
      if (!snapshots.first(accountId, id)) return;
      const branchId = (request.body as { branch_id?: string } | undefined)?.branch_id ?? "main";
      const pending = updates.pending(id, branchId);
      if (pending || updates.isRunning(id))
        return sendError(
          reply,
          409,
          "ROLE_STATE_PENDING",
          apiErrorMessages.ROLE_STATE_PENDING,
          { floor_id: pending?.id ?? null },
        );
    } catch (error) {
      if (
        !(
          error instanceof RoleRuntimeError &&
          error.code === "ROLE_SESSION_NOT_FOUND"
        )
      )
        throw error;
    }
  });
  app.get<{ Params: { id: string }; Querystring: { branch_id?: string } }>(
    "/sessions/:id/role-view",
    {
      schema: {
        tags: ["role-runtime"],
        operationId: "getRoleView",
        params: roleSessionParamsJsonSchema,
        querystring: roleViewQueryJsonSchema,
        response: { 200: roleViewResponseJsonSchema },
      },
    },
    async (request, reply) => {
      try {
        return {
          data: await views.get(
            getRequestAuthContext(request).accountId,
            request.params.id,
            request.query.branch_id,
          ),
        };
      } catch (error) {
        return fail(error, reply);
      }
    },
  );
  app.get<{
    Params: { id: string };
    Querystring: { branch_id: string; cursor?: string; limit?: number };
  }>(
    "/sessions/:id/role-view/snapshots",
    {
      schema: {
        tags: ["role-runtime"],
        operationId: "listRoleSnapshots",
        params: roleSessionParamsJsonSchema,
        querystring: roleSnapshotListQueryJsonSchema,
        response: { 200: roleSnapshotPageResponseJsonSchema },
      },
    },
    async (request, reply) => {
      try {
        return {
          data: snapshots.listPage(
            getRequestAuthContext(request).accountId,
            request.params.id,
            request.query.branch_id,
            { cursor: request.query.cursor, limit: request.query.limit },
          ),
        };
      } catch (error) {
        return fail(error, reply);
      }
    },
  );
  app.get<{ Params: { id: string; snapshotId: string } }>(
    "/sessions/:id/role-view/snapshots/:snapshotId",
    {
      schema: {
        tags: ["role-runtime"],
        operationId: "getRoleSnapshot",
        params: roleSnapshotParamsJsonSchema,
        response: { 200: roleSnapshotResponseJsonSchema },
      },
    },
    async (request, reply) => {
      try {
        return {
          data: snapshots.get(
            getRequestAuthContext(request).accountId,
            request.params.id,
            { snapshotId: request.params.snapshotId },
          ),
        };
      } catch (error) {
        return fail(error, reply);
      }
    },
  );
  app.get<{
    Params: { id: string };
    Querystring: { branch_id: string; cursor?: string; limit?: number };
  }>(
    "/sessions/:id/role-messages/floors",
    {
      schema: {
        tags: ["role-runtime"],
        operationId: "listRoleMessageFloors",
        params: roleSessionParamsJsonSchema,
        querystring: roleFloorListQueryJsonSchema,
        response: { 200: roleFloorPageResponseJsonSchema },
      },
    },
    async (request, reply) => {
      try {
        const accountId = getRequestAuthContext(request).accountId;
        const session = snapshots.session(accountId, request.params.id);
        const nativePackage = hasNativePackageSnapshot(
          session.characterSnapshotJson,
        );
        const limit =
          request.query.limit ?? roleRuntimeHistoryPagination.defaultLimit;
        if (
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > roleRuntimeHistoryPagination.maxLimit
        )
          throw new RoleRuntimeError("ROLE_HISTORY_LIMIT_INVALID", 400);
        let beforeFloorNo: number | undefined;
        if (request.query.cursor !== undefined) {
          beforeFloorNo =
            decodeRoleHistoryCursor(request.query.cursor, {
              resource: "floors",
              sessionId: request.params.id,
              branchId: request.query.branch_id,
            }) ?? undefined;
          if (beforeFloorNo === undefined)
            throw new RoleRuntimeError("ROLE_HISTORY_CURSOR_INVALID", 400);
        }
        const branchFloorFilter = roleBranchFloorFilter(db, request.params.id, request.query.branch_id);
        const readableMessage = db
          .select({ one: sql`1` })
          .from(messagePages)
          .innerJoin(messages, eq(messages.pageId, messagePages.id))
          .where(
            and(
              eq(messagePages.floorId, floors.id),
              eq(messagePages.isActive, true),
              eq(messages.isHidden, false),
            ),
          );
        const rows = db
          .select({
            floorId: floors.id,
            floorNo: floors.floorNo,
            state: floors.state,
          })
          .from(floors)
          .where(
            and(
              eq(floors.sessionId, request.params.id),
              branchFloorFilter,
              nativePackage ? gte(floors.floorNo, 0) : gt(floors.floorNo, 0),
              beforeFloorNo === undefined
                ? undefined
                : lt(floors.floorNo, beforeFloorNo),
              exists(readableMessage),
            ),
          )
          .orderBy(desc(floors.floorNo))
          .limit(limit + 1)
          .all();
        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        return {
          data: {
            items,
            nextCursor:
              hasMore && items.length > 0
                ? encodeRoleHistoryCursor({
                    resource: "floors",
                    sessionId: request.params.id,
                    branchId: request.query.branch_id,
                    beforeNo: items.at(-1)!.floorNo,
                  })
                : null,
          },
        };
      } catch (error) {
        return fail(error, reply);
      }
    },
  );
  app.post<{ Params: { id: string }; Body: RoleStateProposalInspectionInput }>(
    "/sessions/:id/role-state/inspect-proposal",
    {
      schema: {
        tags: ["role-runtime"],
        operationId: "inspectRoleStateProposal",
        params: roleSessionParamsJsonSchema,
        body: roleStateProposalInspectionInputJsonSchema,
        response: { 200: roleStateProposalInspectionResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const auth = getRequestAuthContext(request);
      if (
        auth.role !== "admin" ||
        !authHasCapability(auth, "project.config.write")
      ) {
        return sendError(
          reply,
          403,
          "NATIVE_CARD_ACCESS_DENIED",
          apiErrorMessages.NATIVE_CARD_ACCESS_DENIED,
        );
      }
      try {
        return {
          data: await updates.inspectProposal(
            auth.accountId,
            request.params.id,
            roleStateProposalInspectionInputSchema.parse(request.body),
          ),
        };
      } catch (error) {
        return fail(error, reply);
      }
    },
  );
  app.post<{ Params: { id: string }; Body: StatePromptDryRunRequest }>(
    "/sessions/:id/role-state/updates/dry-run",
    {
      schema: {
        tags: ["role-runtime"],
        operationId: "previewRoleStateUpdate",
        params: roleSessionParamsJsonSchema,
        body: statePromptDryRunRequestJsonSchema,
        response: { 200: statePromptPreviewResponseJsonSchema },
      },
    },
    async (request, reply) => {
      if (options.enablePromptDryRun !== true)
        return sendError(
          reply,
          404,
          "ROLE_STATE_DRY_RUN_DISABLED",
          apiErrorMessages.ROLE_STATE_DRY_RUN_DISABLED,
        );
      const auth = getRequestAuthContext(request);
      if (
        auth.role !== "admin" ||
        !authHasCapability(auth, "project.config.write")
      )
        return sendError(
          reply,
          403,
          "NATIVE_CARD_ACCESS_DENIED",
          apiErrorMessages.NATIVE_CARD_ACCESS_DENIED,
        );
      try {
        return {
          data: await updates.dryRun(
            auth.accountId,
            request.params.id,
            statePromptDryRunRequestSchema.parse(request.body),
          ),
        };
      } catch (error) {
        return fail(error, reply);
      }
    },
  );
  app.post<{ Params: { id: string }; Body: { floor_id: string } }>(
    "/sessions/:id/role-state/updates",
    {
      schema: {
        tags: ["role-runtime"],
        operationId: "updateRoleState",
        params: roleSessionParamsJsonSchema,
        body: roleStateUpdateRequestJsonSchema,
        response: { 200: roleSnapshotResponseJsonSchema },
      },
    },
    async (request, reply) => {
      try {
        return {
          data: await updates.update(
            getRequestAuthContext(request).accountId,
            request.params.id,
            request.body.floor_id,
          ),
        };
      } catch (error) {
        return fail(error, reply);
      }
    },
  );
  app.post<{ Params: { id: string }; Body: RoleStateRecalculateRequest }>(
    "/sessions/:id/role-state/recalculate",
    {
      schema: {
        tags: ["role-runtime"],
        operationId: "recalculateRoleState",
        params: roleSessionParamsJsonSchema,
        body: roleStateRecalculateRequestJsonSchema,
        response: { 200: roleStateRepairResponseJsonSchema },
      },
    },
    async (request, reply) => {
      try {
        return {
          data: await updates.recalculate(
            getRequestAuthContext(request).accountId,
            request.params.id,
            request.body,
          ),
        };
      } catch (error) {
        return fail(error, reply);
      }
    },
  );
  app.post<{ Params: { id: string }; Body: RoleStateRestoreMissingRequest }>(
    "/sessions/:id/role-state/restore-missing",
    {
      schema: {
        tags: ["role-runtime"],
        operationId: "restoreMissingRoleState",
        params: roleSessionParamsJsonSchema,
        body: roleStateRestoreMissingRequestJsonSchema,
        response: { 200: roleStateRepairResponseJsonSchema },
      },
    },
    async (request, reply) => {
      try {
        return {
          data: await updates.restoreMissing(
            getRequestAuthContext(request).accountId,
            request.params.id,
            request.body,
          ),
        };
      } catch (error) {
        return fail(error, reply);
      }
    },
  );
  app.get<{ Params: { id: string; operationId: string } }>(
    "/sessions/:id/role-state/operations/:operationId",
    {
      schema: {
        tags: ["role-runtime"],
        operationId: "getRoleStateOperation",
        params: roleStateOperationParamsJsonSchema,
        response: { 200: roleStateOperationResponseJsonSchema },
      },
    },
    async (request, reply) => {
      try {
        return {
          data: updates.getRepairOperation(
            getRequestAuthContext(request).accountId,
            request.params.id,
            request.params.operationId,
          ),
        };
      } catch (error) {
        return fail(error, reply);
      }
    },
  );
  app.get<{ Params: { id: string }; Querystring: { branch_id: string } }>(
    "/sessions/:id/role-state/events",
    {
      schema: {
        tags: ["role-runtime"],
        operationId: "streamRoleStateRepairEvents",
        params: roleSessionParamsJsonSchema,
        querystring: roleStateRepairEventsQueryJsonSchema,
        response: { 200: { type: "string", description: "text/event-stream" } },
      },
    },
    async (request, reply) => {
      const accountId = getRequestAuthContext(request).accountId;
      const { id } = request.params;
      const branchId = request.query.branch_id;
      let unsubscribe: (() => void) | undefined;
      try {
        let ready = false;
        unsubscribe = updates.subscribeRepair(
          accountId,
          id,
          branchId,
          (event) => {
            if (ready && !reply.raw.destroyed && !reply.raw.writableEnded)
              reply.raw.write(
                `event: state_repair\ndata: ${JSON.stringify(event)}\n\n`,
              );
          },
        );
        // Subscribe before reading: the current snapshot covers every earlier commit.
        const current = snapshots.latest(accountId, id, branchId);
        if (!current)
          throw new RoleRuntimeError("ROLE_STATE_UNINITIALIZED", 409);
        reply.hijack();
        for (const [name, value] of Object.entries(reply.getHeaders())) {
          if (value !== undefined) reply.raw.setHeader(name, value);
        }
        reply.raw.statusCode = 200;
        reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
        reply.raw.setHeader("Connection", "keep-alive");
        reply.raw.setHeader("X-Accel-Buffering", "no");
        reply.raw.flushHeaders?.();
        reply.raw.write(
          `event: state_current\ndata: ${JSON.stringify(current)}\n\n`,
        );
        ready = true;
        const heartbeat = setInterval(() => {
          if (!reply.raw.destroyed && !reply.raw.writableEnded)
            reply.raw.write(": heartbeat\n\n");
        }, 15_000);
        heartbeat.unref?.();
        sseLifecycle.track(reply.raw, () => {
          clearInterval(heartbeat);
          unsubscribe?.();
          unsubscribe = undefined;
        });
      } catch (error) {
        unsubscribe?.();
        return fail(error, reply);
      }
    },
  );
  app.get<{
    Params: { id: string };
    Querystring: { branch_id: string; floor_id: string };
  }>(
    "/sessions/:id/role-messages",
    {
      schema: {
        tags: ["role-runtime"],
        operationId: "getRoleMessages",
        params: roleSessionParamsJsonSchema,
        querystring: roleMessagesQueryJsonSchema,
        response: { 200: roleMessagesResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const accountId = getRequestAuthContext(request).accountId;
      try {
        snapshots.session(accountId, request.params.id);
        const branchFloorFilter = roleBranchFloorFilter(db, request.params.id, request.query.branch_id);
        const floor = db
          .select()
          .from(floors)
          .where(
            and(
              eq(floors.id, request.query.floor_id),
              eq(floors.sessionId, request.params.id),
              branchFloorFilter,
            ),
          )
          .get();
        if (!floor) throw new RoleRuntimeError("ROLE_FLOOR_NOT_FOUND", 404);
        const processor = loadSessionOutput(db, accountId, request.params.id);
        const rows = db
          .select({ message: messages })
          .from(messages)
          .innerJoin(messagePages, eq(messagePages.id, messages.pageId))
          .where(
            and(
              eq(messagePages.floorId, floor.id),
              eq(messagePages.isActive, true),
              eq(messages.isHidden, false),
            ),
          )
          .orderBy(asc(messagePages.pageNo), asc(messages.seq))
          .all();
        return {
          data: roleMessagesSchema.parse(
            rows.map(({ message }) => ({
              id: message.id,
              role: message.role,
              source: message.source,
              content:
                message.role === "assistant"
                  ? processor.project(message.content, "completed")
                  : message.content,
            })),
          ),
        };
      } catch (error) {
        return fail(error, reply);
      }
    },
  );
}

function hasNativePackageSnapshot(value: string | null): boolean {
  if (!value) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Character snapshot must be a JSON object.");
    const snapshot = parsed as {
      extensions?: {
        tavern_headless?: { nativePackage?: unknown };
      };
    };
    return Boolean(snapshot.extensions?.tavern_headless?.nativePackage);
  } catch (cause) {
    throw new RoleRuntimeError(
      "ROLE_VIEW_CONFIG_INVALID",
      409,
      undefined,
      cause,
    );
  }
}
