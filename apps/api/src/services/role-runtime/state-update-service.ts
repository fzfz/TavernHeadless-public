import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema, ValidateFunction } from "ajv";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  LLMService,
  ProviderRegistry,
  findModelCallPersistenceError,
  modelCallPersistenceDetails,
  type ModelCallRecording,
} from "@tavern/core";
import {
  apiErrorMessages,
  roleStateBundleSchema,
  modelCallRecordSchema,
  roleStateProposalInspectionInputSchema,
  roleStateProposalInspectionResultSchema,
  roleStatePolicy,
  roleRuntimeValidators,
  type StatePromptDryRunRequest,
  type StatePromptPreview,
  type RoleState,
  type RoleToolEvidence,
  type RoleStateOutput,
  type RoleStateProposalInspectionInput,
  type RoleStateProposalInspectionResult,
  type RoleStateProfile,
  type RoleDisplaySnapshot,
  type RoleStateSourceMessage,
  type RoleStateRecalculateRequest,
  type RoleStateRestoreMissingRequest,
  type RoleStateRepairResult,
  type RoleStateRepairEvent,
  type RoleStateOperationRecord,
} from "@tavern/shared";
import { stripNullGenerationParams } from "../../lib/llm-params.js";
import type { AppDb } from "../../db/client.js";
import {
  floors,
  floorRunStates,
  messagePages,
  messages,
  roleDisplaySnapshots,
  characters,
  characterVersions,
  roleStateOperations,
  modelCallRecords,
} from "../../db/schema.js";
import { LlmProfileService } from "../llm-profile-service.js";
import { VariableService } from "../variables/variable-service.js";
import { loadSessionOutput } from "../preset-output.js";
import {
  StatePromptService,
  type StatePromptServiceOptions,
} from "./state-prompt-service.js";
import type { ModelCallRecordService } from "../model-call-record-service.js";
import type { DisplaySnapshotService } from "./display-snapshot-service.js";
import type { RoleAssetService } from "./role-asset-service.js";
import { RoleModuleLoader } from "./role-module-loader.js";
import {
  buildRestrictedOutputSchema,
  mergeControllerState,
} from "./state-contract.js";
import { applyProposal } from "./state-proposal.js";
import { loadAcceptedRoleToolEvidence } from "./role-tool-evidence.js";
import {
  evaluateRoleProposal,
  type RuntimeRoleStateProposalProfile,
} from "./role-proposal-inspection.js";
import {
  RoleRuntimeError,
  RoleStateOperationReplayError,
} from "./runtime-error.js";

type LoadedProfile = RoleStateProfile &
  RuntimeRoleStateProposalProfile & { stateSchema: Record<string, unknown> };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fillMissingState(current: RoleState, initial: RoleState): RoleState {
  const result = structuredClone(current);
  const visit = (
    target: Record<string, unknown>,
    source: Record<string, unknown>,
  ) => {
    for (const [key, value] of Object.entries(source)) {
      if (!Object.hasOwn(target, key)) target[key] = structuredClone(value);
      else if (isPlainObject(target[key]) && isPlainObject(value))
        visit(target[key], value);
    }
  };
  visit(result, initial);
  return result;
}

function refreshDescriptionPath(
  target: RoleState,
  initial: RoleState,
  pointer: string,
): void {
  const parts = pointer
    .slice(1)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  let output: unknown = target;
  let source: unknown = initial;
  for (const part of parts.slice(0, -1)) {
    if (
      (!isPlainObject(output) && !Array.isArray(output)) ||
      (!isPlainObject(source) && !Array.isArray(source))
    )
      return;
    output = (output as Record<string, unknown>)[part];
    source = (source as Record<string, unknown>)[part];
  }
  const key = parts.at(-1)!;
  if (
    (!isPlainObject(output) && !Array.isArray(output)) ||
    (!isPlainObject(source) && !Array.isArray(source))
  )
    return;
  if (!Object.hasOwn(source, key)) return;
  (output as Record<string, unknown>)[key] = structuredClone(
    (source as Record<string, unknown>)[key],
  );
}

function isNativeSession(characterSnapshotJson: string | null): boolean {
  if (!characterSnapshotJson) return false;
  try {
    const snapshot = JSON.parse(characterSnapshotJson) as {
      extensions?: { tavern_headless?: { nativePackage?: unknown } };
    };
    return !!snapshot.extensions?.tavern_headless?.nativePackage;
  } catch {
    return false;
  }
}

export class StateUpdateService {
  private readonly ajvDraft7 = new Ajv({ allErrors: true, strict: false });
  private readonly ajvDraft2020 = new Ajv2020({
    allErrors: true,
    strict: false,
  });
  private readonly running = new Set<string>();
  private readonly modules: RoleModuleLoader;
  private readonly statePrompts: StatePromptService;
  private readonly repairListeners = new Map<
    string,
    Set<(event: RoleStateRepairEvent) => void>
  >();

  constructor(
    private readonly db: AppDb,
    private readonly snapshots: DisplaySnapshotService,
    private readonly assets: RoleAssetService,
    private readonly calls: ModelCallRecordService,
    promptOptions: StatePromptServiceOptions = {},
  ) {
    this.modules = new RoleModuleLoader(assets);
    this.statePrompts = new StatePromptService(
      db,
      snapshots,
      assets,
      promptOptions,
    );
  }

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId);
  }

  subscribeRepair(
    accountId: string,
    sessionId: string,
    branchId: string,
    listener: (event: RoleStateRepairEvent) => void,
  ): () => void {
    const key = `${accountId}\0${sessionId}\0${branchId}`;
    const listeners = this.repairListeners.get(key) ?? new Set();
    listeners.add(listener);
    this.repairListeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.repairListeners.delete(key);
    };
  }

  private publishRepair(
    accountId: string,
    result: RoleStateRepairResult,
  ): void {
    const key = `${accountId}\0${result.after.sessionId}\0${result.after.branchId}`;
    for (const listener of this.repairListeners.get(key) ?? []) {
      try {
        listener({ operationId: result.operationId, after: result.after });
      } catch {
        /* a closed listener cannot roll back a commit */
      }
    }
  }

  getRepairOperation(
    accountId: string,
    sessionId: string,
    operationId: string,
  ): RoleStateOperationRecord {
    this.snapshots.session(accountId, sessionId);
    const row = this.db
      .select()
      .from(roleStateOperations)
      .where(
        and(
          eq(roleStateOperations.id, operationId),
          eq(roleStateOperations.accountId, accountId),
          eq(roleStateOperations.sessionId, sessionId),
        ),
      )
      .get();
    if (!row)
      throw new RoleRuntimeError("ROLE_STATE_REPAIR_OPERATION_NOT_FOUND", 404);
    const failure = row.errorJson ? JSON.parse(row.errorJson) : null;
    return {
      operationId: row.id,
      sessionId: row.sessionId,
      branchId: row.branchId,
      kind: row.kind,
      floorId: row.floorId,
      beforeSnapshotId: row.beforeSnapshotId,
      sourceSnapshotId: row.sourceSnapshotId,
      afterSnapshotId: row.afterSnapshotId,
      status: row.status,
      error: failure
        ? {
            code: failure.code,
            message: failure.message,
            ...(failure.details ? { details: failure.details } : {}),
          }
        : null,
    };
  }

  private reserveRepair(
    accountId: string,
    sessionId: string,
    kind: "recalculate" | "restore_missing",
    input: RoleStateRecalculateRequest | RoleStateRestoreMissingRequest,
  ): RoleStateRepairResult | null {
    this.snapshots.session(accountId, sessionId);
    const existing = this.db.transaction((tx) => {
      const row = tx
        .select()
        .from(roleStateOperations)
        .where(eq(roleStateOperations.id, input.operation_id))
        .get();
      if (row) return row;
      tx.insert(roleStateOperations)
        .values({
          id: input.operation_id,
          accountId,
          sessionId,
          branchId: input.branch_id,
          kind,
          floorId: "floor_id" in input ? input.floor_id : null,
          inputJson: JSON.stringify(input),
          status: "running",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .run();
      return null;
    });
    if (!existing) return null;
    if (
      existing.accountId !== accountId ||
      existing.sessionId !== sessionId ||
      existing.kind !== kind ||
      !isDeepStrictEqual(JSON.parse(existing.inputJson), input)
    )
      throw new RoleRuntimeError("ROLE_STATE_REPAIR_OPERATION_CONFLICT", 409);
    if (existing.status === "running")
      throw new RoleRuntimeError("ROLE_STATE_REPAIR_BUSY", 409);
    if (existing.status === "failed") {
      const saved = JSON.parse(existing.errorJson ?? "{}") as {
        code?: string;
        message?: string;
        statusCode?: number;
        details?: Record<string, unknown>;
        runtimeError?: boolean;
        originalCode?: string;
        persistenceFailure?: boolean;
      };
      if (saved.persistenceFailure)
        throw new RoleStateOperationReplayError(
          saved.code!,
          saved.statusCode!,
          apiErrorMessages.MODEL_CALL_SAVE_FAILED,
          saved.details,
        );
      if (
        saved.runtimeError &&
        saved.code?.startsWith("ROLE_") &&
        saved.code in apiErrorMessages
      )
        throw new RoleRuntimeError(
          saved.code as Extract<
            keyof typeof apiErrorMessages,
            `ROLE_${string}`
          >,
          saved.statusCode ?? 409,
          saved.details,
        );
      throw Object.assign(
        new Error(saved.message ?? apiErrorMessages.ROLE_STATE_REPAIR_FAILED),
        saved.originalCode ? { code: saved.originalCode } : {},
      );
    }
    if (!existing.beforeSnapshotId || !existing.afterSnapshotId)
      throw new RoleRuntimeError("ROLE_STATE_REPAIR_FAILED", 500);
    return {
      operationId: input.operation_id,
      before: this.snapshots.get(accountId, sessionId, {
        snapshotId: existing.beforeSnapshotId,
      }),
      after: this.snapshots.get(accountId, sessionId, {
        snapshotId: existing.afterSnapshotId,
      }),
    };
  }

  private failRepair(operationId: string, error: unknown): void {
    const code =
      error instanceof RoleRuntimeError
        ? error.code
        : error instanceof Error &&
            "code" in error &&
            typeof error.code === "string"
          ? error.code
          : "ROLE_STATE_REPAIR_FAILED";
    const persistence = findModelCallPersistenceError(error);
    const data = {
      code: persistence?.code ?? code,
      persistenceFailure: !!persistence,
      runtimeError: error instanceof RoleRuntimeError,
      originalCode:
        error instanceof Error &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : undefined,
      message: error instanceof Error ? error.message : String(error),
      statusCode: persistence
        ? 503
        : error instanceof RoleRuntimeError
          ? error.statusCode
          : 500,
      ...(persistence
        ? { details: modelCallPersistenceDetails(error) }
        : error instanceof RoleRuntimeError && error.details
          ? { details: error.details }
          : {}),
    };
    this.db
      .update(roleStateOperations)
      .set({
        status: "failed",
        errorJson: JSON.stringify(data),
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(roleStateOperations.id, operationId),
          eq(roleStateOperations.status, "running"),
        ),
      )
      .run();
  }

  private assertRepairReady(
    accountId: string,
    sessionId: string,
    branchId: string,
    expectedSnapshotId: string,
  ): RoleDisplaySnapshot {
    const current = this.snapshots.latest(accountId, sessionId, branchId);
    if (!current || current.snapshotId !== expectedSnapshotId)
      throw new RoleRuntimeError("ROLE_STATE_REPAIR_STALE", 409, {
        expected_snapshot_id: expectedSnapshotId,
        current_snapshot_id: current?.snapshotId ?? null,
      });
    const active = this.db
      .select({ id: floors.id })
      .from(floors)
      .leftJoin(floorRunStates, eq(floorRunStates.floorId, floors.id))
      .where(
        and(
          eq(floors.sessionId, sessionId),
          eq(floors.branchId, branchId),
          isNull(floors.supersededAt),
          // A running generation can change both the effective floor and current state.
          eq(floorRunStates.status, "running"),
        ),
      )
      .limit(1)
      .get();
    if (this.running.has(sessionId) || active)
      throw new RoleRuntimeError("ROLE_STATE_REPAIR_BUSY", 409);
    return current;
  }

  private assertLatestStateFloor(
    sessionId: string,
    branchId: string,
    floorId: string,
    current: RoleDisplaySnapshot,
  ): void {
    const latestFloor = this.db
      .select()
      .from(floors)
      .where(
        and(
          eq(floors.sessionId, sessionId),
          eq(floors.branchId, branchId),
          eq(floors.state, "committed"),
          isNull(floors.supersededAt),
        ),
      )
      .orderBy(desc(floors.floorNo))
      .limit(1)
      .get();
    if (
      !latestFloor ||
      latestFloor.id !== floorId ||
      current.floorId !== floorId
    )
      throw new RoleRuntimeError("ROLE_STATE_REPAIR_FLOOR_CHANGED", 409, {
        floor_id: floorId,
        current_floor_id: latestFloor?.id ?? null,
      });
  }

  async recalculate(
    accountId: string,
    sessionId: string,
    input: RoleStateRecalculateRequest,
  ): Promise<RoleStateRepairResult> {
    const replay = this.reserveRepair(
      accountId,
      sessionId,
      "recalculate",
      input,
    );
    if (replay) return replay;
    const callIds = new Set<string>();
    let runId: string | null = null;
    let committed = false;
    let ownsLock = false;
    try {
      const current = this.assertRepairReady(
        accountId,
        sessionId,
        input.branch_id,
        input.expected_snapshot_id,
      );
      this.assertLatestStateFloor(
        sessionId,
        input.branch_id,
        input.floor_id,
        current,
      );
      const first = this.snapshots.firstByFloor(
        accountId,
        sessionId,
        input.floor_id,
        input.branch_id,
      );
      if (!first?.parentSnapshotId)
        throw new RoleRuntimeError("ROLE_STATE_REPAIR_SOURCE_MISSING", 409);
      const source = this.snapshots.get(accountId, sessionId, {
        snapshotId: first.parentSnapshotId,
      });
      const run = this.db
        .select()
        .from(floorRunStates)
        .where(eq(floorRunStates.floorId, input.floor_id))
        .get();
      if (!run || run.status !== "completed")
        throw new RoleRuntimeError("ROLE_FLOOR_RUN_INCOMPLETE");
      runId = run.runId;
      this.running.add(sessionId);
      ownsLock = true;
      const loaded = await this.load(accountId, sessionId);
      if (!loaded) throw new RoleRuntimeError("ROLE_STATE_CONFIG_MISSING", 404);
      const { rows, sources, toolEvidence } = this.loadSources(
        accountId,
        sessionId,
        input.floor_id,
      );
      const beforeState = this.originalCalculationBefore(
        accountId,
        first,
        source,
        loaded.profile,
      );
      const outputSchema = buildRestrictedOutputSchema(
        loaded.profile,
        sources.map((item) => item.messageId),
        toolEvidence.map((item) => item.executionId),
      );
      const recording = this.calls.start({
        accountId,
        floorId: input.floor_id,
        slot: loaded.profile.modelSlot ?? roleStatePolicy.defaultModelSlot,
        purpose: "state_update",
        inputPageId: rows.at(-1)?.page.id ?? null,
        inputMessageId: rows.at(-1)?.message.id ?? null,
      });
      const tracked: ModelCallRecording = {
        ...recording,
        recorder: {
          save: async (record) => {
            await this.calls.save(record);
            callIds.add(record.callId);
          },
        },
      };
      const output = await this.generate(
        loaded,
        beforeState,
        sources,
        outputSchema,
        tracked,
        toolEvidence,
        { floorId: input.floor_id, previousSnapshotId: source.snapshotId },
      );
      const variables = await applyProposal(
        beforeState,
        output,
        loaded.profile,
        roleRuntimeValidators.stateUpdateAgentOutput,
        this.compileSchema(
          loaded.profile.stateSchema,
          isNativeSession(loaded.session.characterSnapshotJson),
        ),
        sources.map((item) => item.messageId),
        sources,
        [],
        beforeState,
        toolEvidence,
      );
      const record: RoleDisplaySnapshot = {
        ...current,
        snapshotId: randomUUID(),
        parentSnapshotId: current.snapshotId,
        variables,
        source: { kind: "manual", runId: null, jobId: null },
      };
      // The snapshot, branch variables, and operation result are one SQLite transaction.
      this.snapshots.save(accountId, record, {
        operationId: input.operation_id,
        expectedSnapshotId: input.expected_snapshot_id,
        sourceSnapshotId: source.snapshotId,
        latestFloorId: input.floor_id,
        commitModelCalls: callIds.size
          ? (tx) =>
              this.calls.finishTurnInTransaction(
                {
                  accountId,
                  floorId: input.floor_id,
                  runId: run.runId,
                  purpose: "state_update",
                  callIds: [...callIds],
                  status: "committed",
                  outputPageId: null,
                  outputMessageId: null,
                },
                tx,
              )
          : undefined,
      });
      committed = true;
      const result = {
        operationId: input.operation_id,
        before: current,
        after: record,
      };
      this.publishRepair(accountId, result);
      return result;
    } catch (error) {
      let failure = error;
      if (!committed && runId && callIds.size) {
        try {
          await this.calls.finishTurn({
            accountId,
            floorId: input.floor_id,
            runId,
            purpose: "state_update",
            callIds: [...callIds],
            status: "failed",
            outputPageId: null,
            outputMessageId: null,
          });
        } catch (saveError) {
          failure = new AggregateError(
            [error, saveError],
            "State repair and model call persistence both failed.",
            { cause: error },
          );
        }
      }
      this.failRepair(input.operation_id, failure);
      throw failure;
    } finally {
      if (ownsLock) this.running.delete(sessionId);
    }
  }

  private originalCalculationBefore(
    accountId: string,
    first: RoleDisplaySnapshot,
    source: RoleDisplaySnapshot,
    profile: RoleStateProfile,
    persist = true,
  ): RoleState {
    const row = this.db
      .select()
      .from(roleDisplaySnapshots)
      .where(
        and(
          eq(roleDisplaySnapshots.accountId, accountId),
          eq(roleDisplaySnapshots.id, first.snapshotId),
        ),
      )
      .get();
    if (row?.calculationBeforeJson)
      return JSON.parse(row.calculationBeforeJson) as RoleState;
    let before: RoleState;
    if (!profile.controllerOwnedPaths?.length) before = source.variables;
    else {
      const records = this.db
        .select()
        .from(modelCallRecords)
        .where(
          and(
            eq(modelCallRecords.accountId, accountId),
            eq(modelCallRecords.sessionId, first.sessionId),
            eq(modelCallRecords.floorId, first.floorId!),
            eq(modelCallRecords.runId, first.source.runId ?? ""),
            eq(modelCallRecords.turnCommitStatus, "committed"),
          ),
        )
        .all()
        .map((record) =>
          modelCallRecordSchema.parse(JSON.parse(record.recordJson)),
        )
        .filter(
          (record) =>
            record.purpose === "state_update" &&
            record.status === "succeeded" &&
            `${record.runId}:${record.attemptNo}` === first.attemptId,
        );
      const candidates: RoleState[] = [];
      for (const record of records) {
        try {
          const request = JSON.parse(record.requestBody);
          const messages = Array.isArray(request.messages)
            ? request.messages
            : [];
          const inputs = messages.flatMap((message: { content?: unknown }) => {
            if (typeof message.content !== "string") return [];
            try {
              const data: unknown = JSON.parse(message.content);
              return isPlainObject(data) && isPlainObject(data.before)
                ? [data]
                : [];
            } catch {
              return [];
            }
          });
          if (
            inputs.length !== 1 ||
            !isDeepStrictEqual(inputs[0]!.before, inputs[0]!.floorBefore)
          )
            throw new Error();
          candidates.push(inputs[0]!.before as RoleState);
        } catch {
          throw new RoleRuntimeError("ROLE_STATE_REPAIR_SOURCE_MISSING", 409);
        }
      }
      if (
        !candidates.length ||
        candidates.some(
          (candidate) => !isDeepStrictEqual(candidate, candidates[0]),
        )
      )
        throw new RoleRuntimeError("ROLE_STATE_REPAIR_SOURCE_MISSING", 409);
      before = candidates[0]!;
    }
    if (persist)
      this.db
        .update(roleDisplaySnapshots)
        .set({ calculationBeforeJson: JSON.stringify(before) })
        .where(
          and(
            eq(roleDisplaySnapshots.id, first.snapshotId),
            isNull(roleDisplaySnapshots.calculationBeforeJson),
          ),
        )
        .run();
    return structuredClone(before);
  }

  async restoreMissing(
    accountId: string,
    sessionId: string,
    input: RoleStateRestoreMissingRequest,
  ): Promise<RoleStateRepairResult> {
    const replay = this.reserveRepair(
      accountId,
      sessionId,
      "restore_missing",
      input,
    );
    if (replay) return replay;
    let ownsLock = false;
    try {
      const current = this.assertRepairReady(
        accountId,
        sessionId,
        input.branch_id,
        input.expected_snapshot_id,
      );
      const initial = this.snapshots.first(
        accountId,
        sessionId,
        input.branch_id,
      );
      if (!initial) throw new RoleRuntimeError("ROLE_STATE_UNINITIALIZED");
      this.running.add(sessionId);
      ownsLock = true;
      const loaded = await this.load(accountId, sessionId);
      if (!loaded) throw new RoleRuntimeError("ROLE_STATE_CONFIG_MISSING", 404);
      const candidate = fillMissingState(current.variables, initial.variables);
      for (const path of loaded.profile.initialDescriptionPaths ?? [])
        refreshDescriptionPath(candidate, initial.variables, path);
      const context = {
        before: structuredClone(current.variables),
        candidate: structuredClone(candidate),
        sourceMessages: [],
        toolEvidence: [],
        priorFacts: [],
        floorBefore: structuredClone(current.variables),
        facts: {},
      };
      const derived = loaded.profile.derive
        ? await loaded.profile.derive(structuredClone(context))
        : candidate;
      const validate = this.compileSchema(
        loaded.profile.stateSchema,
        isNativeSession(loaded.session.characterSnapshotJson),
      );
      if (!validate(derived)) {
        const issue = validate.errors?.[0];
        throw new RoleRuntimeError("ROLE_STATE_REPAIR_VALIDATION_FAILED", 422, {
          path: issue?.instancePath ?? "",
          constraint: issue?.message ?? "state schema",
        });
      }
      if (loaded.profile.validate) {
        const result = await loaded.profile.validate({
          ...context,
          candidate: structuredClone(derived as RoleState),
        });
        if (!result || !Array.isArray(result.issues) || result.issues.length)
          throw new RoleRuntimeError(
            "ROLE_STATE_REPAIR_VALIDATION_FAILED",
            422,
            {
              path: "",
              constraint: JSON.stringify(
                result?.issues?.[0] ?? "role validator",
              ),
            },
          );
      }
      if (isDeepStrictEqual(current.variables, derived)) {
        this.snapshots.completeNoop(
          accountId,
          current,
          input.operation_id,
          initial.snapshotId,
        );
        return {
          operationId: input.operation_id,
          before: current,
          after: current,
        };
      }
      const record: RoleDisplaySnapshot = {
        ...current,
        snapshotId: randomUUID(),
        parentSnapshotId: current.snapshotId,
        variables: derived as RoleState,
        source: { kind: "manual", runId: null, jobId: null },
      };
      this.snapshots.save(accountId, record, {
        operationId: input.operation_id,
        expectedSnapshotId: input.expected_snapshot_id,
        sourceSnapshotId: initial.snapshotId,
      });
      const result = {
        operationId: input.operation_id,
        before: current,
        after: record,
      };
      this.publishRepair(accountId, result);
      return result;
    } catch (error) {
      this.failRepair(input.operation_id, error);
      throw error;
    } finally {
      if (ownsLock) this.running.delete(sessionId);
    }
  }

  pending(sessionId: string, branchId = "main") {
    return this.db
      .select({ floor: floors })
      .from(floors)
      .leftJoin(
        roleDisplaySnapshots,
        eq(roleDisplaySnapshots.floorId, floors.id),
      )
      .where(
        and(
          eq(floors.sessionId, sessionId),
          eq(floors.branchId, branchId),
          eq(floors.state, "committed"),
          isNull(floors.supersededAt),
          isNull(roleDisplaySnapshots.id),
        ),
      )
      .orderBy(asc(floors.floorNo))
      .all()
      .find(({ floor }) => floor.floorNo > 0)?.floor;
  }

  async load(accountId: string, sessionId: string) {
    const session = this.snapshots.session(accountId, sessionId);
    const snapshot = JSON.parse(session.characterSnapshotJson ?? "{}");
    if (!snapshot.extensions?.tavern_headless?.stateUpdate) return null;
    if (!session.characterVersionId)
      throw new RoleRuntimeError("ROLE_SESSION_VERSION_MISSING");
    return {
      session,
      ...(await this.hydrate(
        accountId,
        session.characterVersionId,
        snapshot.extensions.tavern_headless.stateUpdate,
        !!snapshot.extensions.tavern_headless.nativePackage,
      )),
    };
  }

  async contract(accountId: string, characterId: string, versionId: string) {
    const row = this.db
      .select({ json: characterVersions.dataJson })
      .from(characterVersions)
      .innerJoin(characters, eq(characters.id, characterVersions.characterId))
      .where(
        and(
          eq(characters.accountId, accountId),
          eq(characters.id, characterId),
          eq(characterVersions.id, versionId),
        ),
      )
      .get();
    if (!row)
      throw new RoleRuntimeError(
        "ROLE_RELEASE_CHARACTER_VERSION_NOT_FOUND",
        404,
      );
    const snapshot = JSON.parse(row.json);
    const bundle = snapshot.extensions?.tavern_headless?.stateUpdate;
    if (!bundle) throw new RoleRuntimeError("ROLE_STATE_CONFIG_MISSING", 404);
    const isNativePackage =
      !!snapshot.extensions?.tavern_headless?.nativePackage;
    const { profile, files } = await this.hydrate(
      accountId,
      versionId,
      bundle,
      isNativePackage,
    );
    return {
      systemPrompt: this.prompt(profile, files),
      outputSchema: buildRestrictedOutputSchema(profile),
    };
  }

  private async hydrate(
    accountId: string,
    versionId: string,
    value: unknown,
    nativePackage = false,
  ) {
    const bundle = roleStateBundleSchema.parse(value);
    const files: Record<string, string> = {};
    for (const path of bundle.profile.ruleFiles ?? [])
      files[path] = await this.assets.readData(accountId, versionId, path);
    const schema: unknown = bundle.profile.stateSchemaFile
      ? JSON.parse(
          await this.assets.readData(
            accountId,
            versionId,
            bundle.profile.stateSchemaFile,
          ),
        )
      : bundle.profile.stateSchema;
    if (!schema || typeof schema !== "object" || Array.isArray(schema))
      throw new RoleRuntimeError("ROLE_STATE_CONFIG_MISSING");
    const profile: LoadedProfile = {
      ...bundle.profile,
      stateSchema: schema as Record<string, unknown>,
    };
    if (profile.deriveScript)
      profile.derive = await this.modules.load(
        accountId,
        versionId,
        profile.deriveScript,
        "derive",
      );
    if (profile.validateScript)
      profile.validate = await this.modules.load(
        accountId,
        versionId,
        profile.validateScript,
        "validate",
      );
    if (profile.factsSchema)
      profile.validateFacts = this.compileSchema(
        profile.factsSchema,
        nativePackage,
      );
    return { profile, files };
  }

  async initialize(accountId: string, sessionId: string, variables: RoleState) {
    const loaded = await this.load(accountId, sessionId);
    return this.snapshots.initialize(
      accountId,
      sessionId,
      variables,
      loaded
        ? this.compileSchema(
            loaded.profile.stateSchema,
            !!loaded.session.characterSnapshotJson &&
              isNativeSession(loaded.session.characterSnapshotJson),
          )
        : undefined,
    );
  }

  async inspectProposal(
    accountId: string,
    sessionId: string,
    input: RoleStateProposalInspectionInput,
  ): Promise<RoleStateProposalInspectionResult> {
    const parsed = roleStateProposalInspectionInputSchema.parse(input);
    const session = this.snapshots.session(accountId, sessionId);
    if (!session.characterVersionId)
      throw new RoleRuntimeError("ROLE_SESSION_VERSION_MISSING");
    const beforeSnapshot = this.snapshots.latest(accountId, sessionId);
    if (!beforeSnapshot) throw new RoleRuntimeError("ROLE_STATE_UNINITIALIZED");
    const loaded = await this.load(accountId, sessionId);
    if (!loaded) throw new RoleRuntimeError("ROLE_STATE_CONFIG_MISSING", 404);
    const before = await this.assembleProposalBefore(
      accountId,
      sessionId,
      beforeSnapshot.branchId,
      beforeSnapshot.variables,
      loaded.profile,
    );
    const sourcePageIds = this.db
      .select({ pageId: messages.pageId })
      .from(messages)
      .where(
        and(
          inArray(
            messages.id,
            parsed.sourceMessages.map((item) => item.messageId),
          ),
          eq(messages.role, "assistant"),
        ),
      )
      .all()
      .map((item) => item.pageId);
    const toolEvidence = loadAcceptedRoleToolEvidence(
      this.db,
      accountId,
      sessionId,
      sourcePageIds,
    );
    const nativePackage = isNativeSession(loaded.session.characterSnapshotJson);
    const evaluation = await evaluateRoleProposal(
      before,
      parsed.proposal,
      loaded.profile,
      roleRuntimeValidators.stateUpdateAgentOutput,
      this.compileSchema(loaded.profile.stateSchema, nativePackage),
      parsed.sourceMessages.map(({ messageId }) => messageId),
      parsed.sourceMessages,
      [],
      before,
      toolEvidence,
    );
    return roleStateProposalInspectionResultSchema.parse({
      before: structuredClone(before),
      candidate: evaluation.candidate,
      derived: evaluation.derived,
      issues: evaluation.issues.map(({ code, details }) => ({
        code,
        message: apiErrorMessages[code],
        ...(details === undefined ? {} : { details }),
      })),
      valid: evaluation.valid,
    });
  }

  private compileSchema(
    schema: Record<string, unknown>,
    nativePackage = false,
  ): ValidateFunction {
    if (
      schema.$schema === "https://json-schema.org/draft/2020-12/schema" ||
      (schema.$schema === undefined && nativePackage)
    )
      return this.ajvDraft2020.compile(schema as AnySchema);
    return this.ajvDraft7.compile(schema as AnySchema);
  }

  private async assembleProposalBefore(
    accountId: string,
    sessionId: string,
    branchId: string,
    snapshotVariables: RoleState,
    profile: RoleStateProfile,
  ): Promise<RoleState> {
    if (!profile.controllerOwnedPaths?.length) return snapshotVariables;
    const resolved = await new VariableService(this.db).resolveSnapshot({
      accountId,
      sessionId,
      branchId,
    });
    const state = resolved.resolved.find(
      (item) => item.key === "stat_data",
    )?.value;
    if (!state || typeof state !== "object" || Array.isArray(state))
      throw new RoleRuntimeError("ROLE_CONTROLLER_STATE_INVALID", 422);
    return mergeControllerState(
      snapshotVariables,
      state as RoleState,
      profile.controllerOwnedPaths,
    );
  }

  private loadSources(accountId: string, sessionId: string, floorId: string) {
    const rows = this.db
      .select({ message: messages, page: messagePages })
      .from(messages)
      .innerJoin(messagePages, eq(messagePages.id, messages.pageId))
      .where(
        and(
          eq(messagePages.floorId, floorId),
          eq(messagePages.isActive, true),
          eq(messages.isHidden, false),
        ),
      )
      .orderBy(asc(messagePages.pageNo), asc(messages.seq))
      .all();
    const sourceOutput = loadSessionOutput(this.db, accountId, sessionId);
    const sources: RoleStateSourceMessage[] = rows
      .filter(
        ({ message }) =>
          message.role === "user" || message.role === "assistant",
      )
      .map(({ message, page }) => ({
        messageId: message.id,
        revision: page.version,
        role: message.role,
        text:
          message.role === "assistant"
            ? sourceOutput.project(message.content, "completed")
            : message.content,
      }));
    if (!sources.some((source) => source.role === "assistant"))
      throw new RoleRuntimeError("ROLE_FLOOR_RUN_INCOMPLETE", 409);
    const toolEvidence = loadAcceptedRoleToolEvidence(
      this.db,
      accountId,
      sessionId,
      rows
        .filter(({ message }) => message.role === "assistant")
        .map(({ page }) => page.id),
    );
    return { rows, sources, toolEvidence };
  }

  async dryRun(
    accountId: string,
    sessionId: string,
    input: StatePromptDryRunRequest,
  ): Promise<StatePromptPreview> {
    const session = this.snapshots.session(accountId, sessionId);
    const floor = this.db
      .select()
      .from(floors)
      .where(
        and(
          eq(floors.id, input.floor_id),
          eq(floors.sessionId, sessionId),
          isNull(floors.supersededAt),
        ),
      )
      .get();
    if (!floor) throw new RoleRuntimeError("ROLE_FLOOR_NOT_FOUND", 404);
    if (floor.state !== "committed")
      throw new RoleRuntimeError("ROLE_FLOOR_NOT_COMMITTED", 409);
    const previous = this.snapshots.latest(
      accountId,
      sessionId,
      floor.branchId,
    );
    if (!previous) throw new RoleRuntimeError("ROLE_STATE_UNINITIALIZED", 409);
    if (previous.snapshotId !== input.expected_snapshot_id)
      throw new RoleRuntimeError("ROLE_STATE_REPAIR_STALE", 409, {
        expected_snapshot_id: input.expected_snapshot_id,
        current_snapshot_id: previous.snapshotId,
      });
    if (this.running.has(sessionId))
      throw new RoleRuntimeError("ROLE_STATE_BUSY", 409);
    const run = this.db
      .select()
      .from(floorRunStates)
      .where(eq(floorRunStates.floorId, floor.id))
      .get();
    if (!run || run.status !== "completed")
      throw new RoleRuntimeError("ROLE_FLOOR_RUN_INCOMPLETE", 409);
    const loaded = await this.load(accountId, sessionId);
    if (!loaded) throw new RoleRuntimeError("ROLE_STATE_CONFIG_MISSING", 404);
    const first = this.snapshots.firstByFloor(
      accountId,
      sessionId,
      floor.id,
      floor.branchId,
    );
    let before: RoleState;
    let previousSnapshotId = previous.snapshotId;
    if (first) {
      this.assertRepairReady(
        accountId,
        sessionId,
        floor.branchId,
        input.expected_snapshot_id,
      );
      this.assertLatestStateFloor(
        sessionId,
        floor.branchId,
        floor.id,
        previous,
      );
      if (previous.floorId !== floor.id || !first.parentSnapshotId)
        throw new RoleRuntimeError("ROLE_STATE_REPAIR_FLOOR_CHANGED", 409);
      const original = this.snapshots.get(accountId, sessionId, {
        snapshotId: first.parentSnapshotId,
      });
      before = this.originalCalculationBefore(
        accountId,
        first,
        original,
        loaded.profile,
        false,
      );
      previousSnapshotId = original.snapshotId;
    } else {
      const pending = this.pending(sessionId, floor.branchId);
      if (pending?.id !== floor.id)
        throw new RoleRuntimeError("ROLE_STATE_OUT_OF_ORDER", 409, {
          expected_floor_id: pending?.id ?? null,
        });
      before = await this.assembleProposalBefore(
        accountId,
        sessionId,
        floor.branchId,
        previous.variables,
        loaded.profile,
      );
    }
    const { sources, toolEvidence } = this.loadSources(
      accountId,
      sessionId,
      floor.id,
    );
    const outputSchema = buildRestrictedOutputSchema(
      loaded.profile,
      sources.map((source) => source.messageId),
      toolEvidence.map((item) => item.executionId),
    );
    return this.statePrompts.prepare({
      accountId,
      session,
      profile: loaded.profile,
      files: loaded.files,
      before,
      previousSnapshotId,
      floorId: floor.id,
      sources,
      toolEvidence,
      outputSchema,
    });
  }

  async update(
    accountId: string,
    sessionId: string,
    floorId: string,
  ): Promise<RoleDisplaySnapshot> {
    const session = this.snapshots.session(accountId, sessionId);
    if (this.running.has(sessionId))
      throw new RoleRuntimeError("ROLE_STATE_BUSY");
    const floor = this.db
      .select()
      .from(floors)
      .where(
        and(
          eq(floors.id, floorId),
          eq(floors.sessionId, sessionId),
          isNull(floors.supersededAt),
        ),
      )
      .get();
    if (!floor) throw new RoleRuntimeError("ROLE_FLOOR_NOT_FOUND", 404);
    if (floor.state !== "committed")
      throw new RoleRuntimeError("ROLE_FLOOR_NOT_COMMITTED");
    const done = this.snapshots.getByFloor(accountId, sessionId, floorId, floor.branchId);
    if (done) return done;
    if (floor.branchId !== "main") this.snapshots.ensureBranch(accountId, sessionId, floor.branchId);
    const previous = this.snapshots.latest(accountId, sessionId, floor.branchId);
    if (!previous) throw new RoleRuntimeError("ROLE_STATE_UNINITIALIZED");
    const pending = this.pending(sessionId, previous.branchId);
    if (pending?.id !== floorId)
      throw new RoleRuntimeError("ROLE_STATE_OUT_OF_ORDER", 409, {
        expected_floor_id: pending?.id ?? null,
      });
    const run = this.db
      .select()
      .from(floorRunStates)
      .where(eq(floorRunStates.floorId, floorId))
      .get();
    if (!run || run.status !== "completed")
      throw new RoleRuntimeError("ROLE_FLOOR_RUN_INCOMPLETE");
    const callIds = new Set<string>();
    this.running.add(sessionId);
    let committed = false;
    try {
      const loaded = await this.load(accountId, sessionId);
      let variables = previous.variables;
      let calculationBefore = structuredClone(variables);
      if (loaded) {
        const { profile, files } = loaded;
        const { rows, sources, toolEvidence } = this.loadSources(
          accountId,
          sessionId,
          floorId,
        );
        variables = await this.assembleProposalBefore(
          accountId,
          sessionId,
          previous.branchId,
          variables,
          profile,
        );
        calculationBefore = structuredClone(variables);
        const outputSchema = buildRestrictedOutputSchema(
          profile,
          sources.map((item) => item.messageId),
          toolEvidence.map((item) => item.executionId),
        );
        const recording = this.calls.start({
          accountId,
          floorId,
          slot: profile.modelSlot ?? roleStatePolicy.defaultModelSlot,
          purpose: "state_update",
          inputPageId: rows.at(-1)?.page.id ?? null,
          inputMessageId: rows.at(-1)?.message.id ?? null,
        });
        const tracked: ModelCallRecording = {
          ...recording,
          recorder: {
            save: async (record) => {
              await this.calls.save(record);
              callIds.add(record.callId);
            },
          },
        };
        const output = await this.generate(
          loaded,
          variables,
          sources,
          outputSchema,
          tracked,
          toolEvidence,
          { floorId, previousSnapshotId: previous.snapshotId },
        );
        variables = await applyProposal(
          variables,
          output,
          profile,
          roleRuntimeValidators.stateUpdateAgentOutput,
          this.compileSchema(
            profile.stateSchema,
            isNativeSession(session.characterSnapshotJson),
          ),
          sources.map((item) => item.messageId),
          sources,
          [],
          variables,
          toolEvidence,
        );
      }
      const record: RoleDisplaySnapshot = {
        ...previous,
        versionId: session.characterVersionId!,
        floorId,
        attemptId: `${run.runId}:${run.attemptNo}`,
        snapshotId: randomUUID(),
        parentSnapshotId: previous.snapshotId,
        variables,
        source: { kind: "floor", runId: run.runId, jobId: null },
      };
      this.snapshots.save(accountId, record, undefined, calculationBefore);
      committed = true;
      if (callIds.size)
        await this.calls.finishTurn({
          accountId,
          floorId,
          runId: run.runId,
          purpose: "state_update",
          callIds: [...callIds],
          status: "committed",
          outputPageId: null,
          outputMessageId: null,
        });
      return record;
    } catch (error) {
      if (!committed && callIds.size) {
        try {
          await this.calls.finishTurn({
            accountId,
            floorId,
            runId: run.runId,
            purpose: "state_update",
            callIds: [...callIds],
            status: "failed",
            outputPageId: null,
            outputMessageId: null,
          });
        } catch (saveError) {
          throw new AggregateError(
            [error, saveError],
            "State update failed and its final call status could not be saved. Check the original failure and database availability before retrying.",
            { cause: error },
          );
        }
      }
      throw error;
    } finally {
      this.running.delete(sessionId);
    }
  }

  private prompt(profile: RoleStateProfile, files: Record<string, string>) {
    return [
      profile.updaterPrompt,
      ...(profile.ruleFiles ?? []).map((file) => files[file]),
      ...roleStatePolicy.outputInstructions,
      roleStatePolicy.changesDescription,
      profile.factsSchema
        ? roleStatePolicy.factsEvidenceInstruction
        : roleStatePolicy.changesEvidenceInstruction,
    ].join("\n");
  }

  private async generate(
    loaded: NonNullable<Awaited<ReturnType<StateUpdateService["load"]>>>,
    before: RoleState,
    sources: RoleStateSourceMessage[],
    outputSchema: Record<string, unknown>,
    recording: ModelCallRecording,
    toolEvidence: RoleToolEvidence[],
    promptContext: { floorId: string; previousSnapshotId: string },
  ): Promise<RoleStateOutput> {
    const { session, profile, files } = loaded;
    const active = await new LlmProfileService(this.db).resolveActiveProfiles(
      session.id,
      session.accountId,
    );
    const slot = profile.modelSlot ?? roleStatePolicy.defaultModelSlot;
    const model = active[slot];
    if (!model) throw new RoleRuntimeError("ROLE_UPDATER_PROFILE_MISSING");
    const registry = new ProviderRegistry();
    registry.register({
      id: "role-state",
      type: model.provider,
      apiKey: model.apiKey,
      baseURL: model.baseUrl ?? undefined,
      apiMode: "chat",
    });
    const llm = new LLMService(registry, {
      providerId: "role-state",
      modelId: model.modelId,
    });
    const prepared = await this.statePrompts.prepare({
      model,
      accountId: session.accountId,
      session,
      profile,
      files,
      before,
      sources,
      outputSchema,
      toolEvidence,
      ...promptContext,
    });
    const result = await llm.generate({
      recording,
      messages: prepared.messages,
      params: {
        maxOutputTokens: profile.maxTokens,
        reasoningEffort: profile.updaterReasoning?.effort,
        ...stripNullGenerationParams(model.params),
        responseFormat: { type: "json_schema", jsonSchema: outputSchema },
      },
    });
    if (result.finishReason !== "stop")
      throw new RoleRuntimeError("ROLE_STATE_OUTPUT_INCOMPLETE", 422);
    let output: unknown;
    try {
      output = JSON.parse(result.text);
    } catch (cause) {
      throw new RoleRuntimeError(
        "ROLE_STATE_OUTPUT_INVALID",
        422,
        undefined,
        cause,
      );
    }
    if (!roleRuntimeValidators.stateUpdateAgentOutput(output))
      throw new RoleRuntimeError("ROLE_STATE_OUTPUT_INVALID", 422);
    return output as RoleStateOutput;
  }
}
