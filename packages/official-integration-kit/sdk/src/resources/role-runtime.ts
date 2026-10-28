import { readRoleStateStream } from "../stream/role-state-stream.js";
import {
  roleViewResponseSchema,
  statePromptDryRunRequestSchema,
  statePromptPreviewResponseSchema,
  type StatePromptPreview,
  roleStateRecalculateRequestSchema,
  roleStateRestoreMissingRequestSchema,
  roleStateRepairResultSchema,
  roleStateOperationResponseSchema,
  type RoleStateOperationRecord,
  type RoleStateRepairResult,
  type RoleStateRepairEvent,
  type RoleStateRecalculateOptions,
  type RoleStateRestoreOptions,
  roleStateProposalInspectionInputSchema,
  roleStateProposalInspectionResponseSchema,
  type RoleStateProposalInspectionInput,
  type RoleStateProposalInspectionResult,
  roleSnapshotResponseSchema,
  roleStateUpdateRequestSchema,
  roleMessagesSchema,
  roleSnapshotPageResponseSchema,
  roleFloorPageResponseSchema,
  stateContractResponseSchema,
  createRoleAssetsSchema,
  roleAssetUploadResultSchema,
  type RoleView,
  type RoleDisplaySnapshot,
  type CreateRoleAssets,
  type RoleSnapshotPage,
  type RoleSnapshotListQuery,
  type RoleFloorPage,
  type RoleFloorListQuery,
  roleRuntimeHistoryPagination,
  roleRuntimeValidators,
  apiErrorMessages,
} from "@tavern/shared";
import {
  buildAccountHeaders,
  type AccountIdHint,
  type TransportClient,
} from "../client/transport.js";

type Scope = { accountId?: AccountIdHint };
type Session = Scope & { sessionId: string };
export interface RoleRuntimeResource {
  getStateOperation(
    options: Session & { operationId: string },
  ): Promise<RoleStateOperationRecord>;
  recalculateLatest(
    options: Session &
      RoleStateRecalculateOptions & {
        operationId: string;
        signal?: AbortSignal;
      },
  ): Promise<RoleStateRepairResult>;
  restoreMissing(
    options: Session &
      RoleStateRestoreOptions & { operationId: string; signal?: AbortSignal },
  ): Promise<RoleStateRepairResult>;
  streamState(
    options: Session & {
      branchId: string;
      signal?: AbortSignal;
      onCurrent: (snapshot: RoleDisplaySnapshot) => void;
      onRepair: (event: RoleStateRepairEvent) => void;
    },
  ): Promise<void>;
  getView(options: Session & { branchId?: string }): Promise<RoleView>;
  getSnapshot(
    options: Session & { snapshotId: string },
  ): Promise<RoleDisplaySnapshot>;
  listSnapshots(
    options: Session & RoleSnapshotListQuery,
  ): Promise<RoleSnapshotPage>;
  listFloors(options: Session & RoleFloorListQuery): Promise<RoleFloorPage>;
  inspectProposal(
    options: Session & { input: RoleStateProposalInspectionInput },
  ): Promise<RoleStateProposalInspectionResult>;
  previewStateUpdate(
    options: Session & {
      floorId: string;
      expectedSnapshotId: string;
      signal?: AbortSignal;
    },
  ): Promise<StatePromptPreview>;
  updateState(
    options: Session & { floorId: string; signal?: AbortSignal },
  ): Promise<RoleDisplaySnapshot>;
  getMessages(
    options: Session & { branchId: string; floorId: string },
  ): Promise<
    Array<{ id: string; role: string; content: string; source: string | null }>
  >;
  getStateContract(
    options: Scope & { characterId: string; versionId: string },
  ): Promise<{ systemPrompt: string; outputSchema: Record<string, unknown> }>;
  importAssets(
    options: Scope & { versionId: string; input: CreateRoleAssets },
  ): Promise<{ version_id: string; count: number }>;
}
export function createRoleRuntimeResource(
  client: TransportClient,
): RoleRuntimeResource {
  const path = (sessionId: string) =>
    `/sessions/${encodeURIComponent(sessionId)}`;
  const invalidPage = (
    code:
      | "ROLE_RUNTIME_LIST_BRANCH_INVALID"
      | "ROLE_RUNTIME_LIST_PAGE_SIZE_INVALID"
      | "ROLE_HISTORY_CURSOR_INVALID",
  ) => Object.assign(new Error(apiErrorMessages[code]), { code });
  const historyQuery = (options: {
    branchId: string;
    cursor?: string;
    limit?: number;
  }) => {
    const limit = options.limit ?? roleRuntimeHistoryPagination.defaultLimit;
    if (!options.branchId)
      throw invalidPage("ROLE_RUNTIME_LIST_BRANCH_INVALID");
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > roleRuntimeHistoryPagination.maxLimit
    )
      throw invalidPage("ROLE_RUNTIME_LIST_PAGE_SIZE_INVALID");
    if (
      options.cursor !== undefined &&
      (!options.cursor ||
        options.cursor.length > roleRuntimeHistoryPagination.maxCursorLength)
    )
      throw invalidPage("ROLE_HISTORY_CURSOR_INVALID");
    const schemaQuery = {
      branchId: options.branchId,
      ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
      limit,
    };
    if (
      !roleRuntimeValidators.historyListSnapshotsParams(schemaQuery) ||
      !roleRuntimeValidators.messagesListFloorsParams(schemaQuery)
    )
      throw invalidPage("ROLE_HISTORY_CURSOR_INVALID");
    const query = new URLSearchParams({
      branch_id: options.branchId,
      limit: String(limit),
    });
    if (options.cursor !== undefined) query.set("cursor", options.cursor);
    return query.toString();
  };
  return {
    async previewStateUpdate({
      accountId,
      sessionId,
      floorId,
      expectedSnapshotId,
      signal,
    }) {
      const response = await client.fetchJson(
        `${path(sessionId)}/role-state/updates/dry-run`,
        {
          method: "POST",
          headers: buildAccountHeaders(accountId),
          signal,
          body: statePromptDryRunRequestSchema.parse({
            floor_id: floorId,
            expected_snapshot_id: expectedSnapshotId,
          }),
        },
      );
      return statePromptPreviewResponseSchema.parse(response.body).data;
    },
    async getStateOperation({ accountId, sessionId, operationId }) {
      const response = await client.fetchJson(
        `${path(sessionId)}/role-state/operations/${encodeURIComponent(operationId)}`,
        { headers: buildAccountHeaders(accountId) },
      );
      return roleStateOperationResponseSchema.parse(response.body).data;
    },
    async recalculateLatest({
      accountId,
      sessionId,
      branchId,
      floorId,
      expectedSnapshotId,
      operationId,
      signal,
    }) {
      const response = await client.fetchJson<{ data: unknown }>(
        `${path(sessionId)}/role-state/recalculate`,
        {
          method: "POST",
          headers: buildAccountHeaders(accountId),
          signal,
          body: roleStateRecalculateRequestSchema.parse({
            branch_id: branchId,
            floor_id: floorId,
            expected_snapshot_id: expectedSnapshotId,
            operation_id: operationId,
          }),
        },
      );
      return roleStateRepairResultSchema.parse(response.body?.data);
    },
    async restoreMissing({
      accountId,
      sessionId,
      branchId,
      expectedSnapshotId,
      operationId,
      signal,
    }) {
      const response = await client.fetchJson<{ data: unknown }>(
        `${path(sessionId)}/role-state/restore-missing`,
        {
          method: "POST",
          headers: buildAccountHeaders(accountId),
          signal,
          body: roleStateRestoreMissingRequestSchema.parse({
            branch_id: branchId,
            expected_snapshot_id: expectedSnapshotId,
            operation_id: operationId,
          }),
        },
      );
      return roleStateRepairResultSchema.parse(response.body?.data);
    },
    async streamState(options) {
      const response = await client.fetchRaw(
        `${path(options.sessionId)}/role-state/events?branch_id=${encodeURIComponent(options.branchId)}`,
        {
          accept: "text/event-stream",
          headers: buildAccountHeaders(options.accountId),
          signal: options.signal,
        },
      );
      await readRoleStateStream(response, options);
    },
    async getView({ accountId, sessionId, branchId }) {
      return roleViewResponseSchema.parse(
        (
          await client.fetchJson(`${path(sessionId)}/role-view${branchId ? `?branch_id=${encodeURIComponent(branchId)}` : ""}`, {
            headers: buildAccountHeaders(accountId),
          })
        ).body,
      ).data;
    },
    async getSnapshot({ accountId, sessionId, snapshotId }) {
      return roleSnapshotResponseSchema.parse(
        (
          await client.fetchJson(
            `${path(sessionId)}/role-view/snapshots/${encodeURIComponent(snapshotId)}`,
            { headers: buildAccountHeaders(accountId) },
          )
        ).body,
      ).data;
    },
    async listSnapshots({ accountId, sessionId, branchId, cursor, limit }) {
      return roleSnapshotPageResponseSchema.parse(
        (
          await client.fetchJson(
            `${path(sessionId)}/role-view/snapshots?${historyQuery({ branchId, cursor, limit })}`,
            { headers: buildAccountHeaders(accountId) },
          )
        ).body,
      ).data;
    },
    async listFloors({ accountId, sessionId, branchId, cursor, limit }) {
      return roleFloorPageResponseSchema.parse(
        (
          await client.fetchJson(
            `${path(sessionId)}/role-messages/floors?${historyQuery({ branchId, cursor, limit })}`,
            { headers: buildAccountHeaders(accountId) },
          )
        ).body,
      ).data;
    },
    async inspectProposal({ accountId, sessionId, input }) {
      return roleStateProposalInspectionResponseSchema.parse(
        (
          await client.fetchJson(
            `${path(sessionId)}/role-state/inspect-proposal`,
            {
              method: "POST",
              headers: buildAccountHeaders(accountId),
              body: roleStateProposalInspectionInputSchema.parse(input),
            },
          )
        ).body,
      ).data;
    },
    async updateState({ accountId, sessionId, floorId, signal }) {
      return roleSnapshotResponseSchema.parse(
        (
          await client.fetchJson(`${path(sessionId)}/role-state/updates`, {
            method: "POST",
            signal,
            headers: buildAccountHeaders(accountId),
            body: roleStateUpdateRequestSchema.parse({ floor_id: floorId }),
          })
        ).body,
      ).data;
    },
    async getMessages({ accountId, sessionId, branchId, floorId }) {
      const result = await client.fetchJson<{ data: unknown }>(
        `${path(sessionId)}/role-messages?branch_id=${encodeURIComponent(branchId)}&floor_id=${encodeURIComponent(floorId)}`,
        { headers: buildAccountHeaders(accountId) },
      );
      return roleMessagesSchema.parse(result.body?.data);
    },
    async getStateContract({ accountId, characterId, versionId }) {
      const result = await client.fetchJson<{ data: unknown }>(
        `/characters/${encodeURIComponent(characterId)}/versions/${encodeURIComponent(versionId)}/state-contract`,
        { headers: buildAccountHeaders(accountId) },
      );
      return stateContractResponseSchema.parse(result.body?.data);
    },
    async importAssets({ accountId, versionId, input }) {
      const result = await client.fetchJson(
        `/role-assets/${encodeURIComponent(versionId)}`,
        {
          method: "POST",
          headers: buildAccountHeaders(accountId),
          body: createRoleAssetsSchema.parse(input),
        },
      );
      return roleAssetUploadResultSchema.parse(result.body).data;
    },
  };
}
