import { RoleRuntimeError } from "./runtime-error.js";
import type { StMacroJsonValue } from "../st-macros/types.js";
import { and, asc, desc, eq, isNull, lt, max } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  buildBranchVariableScopeId,
  roleRuntimeValidators,
  apiErrorMessages,
  type RoleDisplaySnapshot,
  type RoleSnapshotPage,
  type RoleState,
  type RoleStateValidator,
  roleRuntimeHistoryPagination,
  decodeRoleHistoryCursor,
  encodeRoleHistoryCursor,
} from "@tavern/shared";
import type { AppDb } from "../../db/client.js";
import { sessions, floors, roleDisplaySnapshots, roleStateOperations } from "../../db/schema.js";
import { VariableService } from "../variables/variable-service.js";
import { SessionBranchRegistryService } from "../variables/host/session-branch-registry-service.js";
import { previewPromptMacroText } from "../prompt-assembler.js";

export class DisplaySnapshotService {
  constructor(private readonly db: AppDb) {}

  session(accountId: string, sessionId: string) {
    const session = this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.accountId, accountId), eq(sessions.id, sessionId)))
      .get();
    if (!session) throw new RoleRuntimeError("ROLE_SESSION_NOT_FOUND", 404);
    return session;
  }

  first(
    accountId: string,
    sessionId: string,
    branchId = "main",
  ): RoleDisplaySnapshot | null {
    this.session(accountId, sessionId);
    const row = this.db
      .select()
      .from(roleDisplaySnapshots)
      .where(
        and(
          eq(roleDisplaySnapshots.accountId, accountId),
          eq(roleDisplaySnapshots.sessionId, sessionId),
          eq(roleDisplaySnapshots.branchId, branchId),
        ),
      )
      .orderBy(asc(roleDisplaySnapshots.snapshotNo))
      .limit(1)
      .get();
    return row ? this.parse(row.recordJson) : null;
  }

  latest(
    accountId: string,
    sessionId: string,
    branchId = "main",
  ): RoleDisplaySnapshot | null {
    this.session(accountId, sessionId);
    const row = this.db
      .select()
      .from(roleDisplaySnapshots)
      .where(
        and(
          eq(roleDisplaySnapshots.accountId, accountId),
          eq(roleDisplaySnapshots.sessionId, sessionId),
          eq(roleDisplaySnapshots.branchId, branchId),
        ),
      )
      .orderBy(desc(roleDisplaySnapshots.snapshotNo))
      .limit(1)
      .get();
    return row ? this.parse(row.recordJson) : null;
  }

  listPage(
    accountId: string,
    sessionId: string,
    branchId: string,
    options: { cursor?: string; limit?: number } = {},
  ): RoleSnapshotPage {
    this.session(accountId, sessionId);
    const limit = options.limit ?? roleRuntimeHistoryPagination.defaultLimit;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > roleRuntimeHistoryPagination.maxLimit
    )
      throw new RoleRuntimeError("ROLE_HISTORY_LIMIT_INVALID", 400);
    let afterSnapshotNo: number | undefined;
    if (options.cursor !== undefined) {
      afterSnapshotNo =
        decodeRoleHistoryCursor(options.cursor, {
          resource: "snapshots",
          sessionId,
          branchId,
        }) ?? undefined;
      if (afterSnapshotNo === undefined)
        throw new RoleRuntimeError("ROLE_HISTORY_CURSOR_INVALID", 400);
    }
    const rows = this.db
      .select()
      .from(roleDisplaySnapshots)
      .where(
        and(
          eq(roleDisplaySnapshots.accountId, accountId),
          eq(roleDisplaySnapshots.sessionId, sessionId),
          eq(roleDisplaySnapshots.branchId, branchId),
          afterSnapshotNo === undefined
            ? undefined
            : lt(roleDisplaySnapshots.snapshotNo, afterSnapshotNo),
        ),
      )
      .orderBy(desc(roleDisplaySnapshots.snapshotNo))
      .limit(limit + 1)
      .all();
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: pageRows.map(({ recordJson }) => {
        const record = this.parse(recordJson);
        return {
          snapshotId: record.snapshotId,
          floorId: record.floorId,
          attemptId: record.attemptId,
        };
      }),
      nextCursor:
        hasMore && pageRows.length > 0
          ? encodeRoleHistoryCursor({
              resource: "snapshots",
              sessionId,
              branchId,
              beforeNo: pageRows.at(-1)!.snapshotNo,
            })
          : null,
    };
  }

  get(
    accountId: string,
    sessionId: string,
    target: { snapshotId: string },
  ): RoleDisplaySnapshot {
    this.session(accountId, sessionId);
    const row = this.db
      .select()
      .from(roleDisplaySnapshots)
      .where(
        and(
          eq(roleDisplaySnapshots.accountId, accountId),
          eq(roleDisplaySnapshots.sessionId, sessionId),
          eq(roleDisplaySnapshots.id, target.snapshotId),
        ),
      )
      .get();
    if (!row) throw new RoleRuntimeError("ROLE_SNAPSHOT_NOT_FOUND", 404);
    return this.parse(row.recordJson);
  }

  getByFloor(
    accountId: string,
    sessionId: string,
    floorId: string,
    branchId = "main",
  ): RoleDisplaySnapshot | null {
    this.session(accountId, sessionId);
    const row = this.db
      .select()
      .from(roleDisplaySnapshots)
      .where(
        and(
          eq(roleDisplaySnapshots.accountId, accountId),
          eq(roleDisplaySnapshots.sessionId, sessionId),
          eq(roleDisplaySnapshots.branchId, branchId),
          eq(roleDisplaySnapshots.floorId, floorId),
        ),
      )
      .orderBy(desc(roleDisplaySnapshots.snapshotNo))
      .limit(1)
      .get();
    return row ? this.parse(row.recordJson) : null;
  }

  firstByFloor(accountId: string, sessionId: string, floorId: string, branchId: string): RoleDisplaySnapshot | null {
    this.session(accountId, sessionId);
    const row = this.db.select().from(roleDisplaySnapshots).where(and(
      eq(roleDisplaySnapshots.accountId, accountId),
      eq(roleDisplaySnapshots.sessionId, sessionId),
      eq(roleDisplaySnapshots.branchId, branchId),
      eq(roleDisplaySnapshots.floorId, floorId),
    )).orderBy(asc(roleDisplaySnapshots.snapshotNo)).limit(1).get();
    return row ? this.parse(row.recordJson) : null;
  }

ensureBranch(accountId: string, sessionId: string, branchId: string): RoleDisplaySnapshot {
    this.session(accountId, sessionId);
    const existing = this.first(accountId, sessionId, branchId);
    if (existing) return existing;
    const branch = new SessionBranchRegistryService(this.db).get(accountId, sessionId, branchId);
    if (!branch?.sourceFloorId || !branch.sourceBranchId) throw new RoleRuntimeError("ROLE_FLOOR_NOT_FOUND", 404);
    const sourceFloor = this.db.select().from(floors).where(and(eq(floors.id, branch.sourceFloorId), eq(floors.sessionId, sessionId))).get();
    if (!sourceFloor) throw new RoleRuntimeError("ROLE_FLOOR_NOT_FOUND", 404);
    const source = this.getByFloor(accountId, sessionId, sourceFloor.id, sourceFloor.branchId)
      ?? (sourceFloor.floorNo === 0 ? this.first(accountId, sessionId, sourceFloor.branchId) : null);
    if (!source) throw new RoleRuntimeError("ROLE_STATE_UNINITIALIZED");
    const initial: RoleDisplaySnapshot = { ...source, branchId, snapshotId: randomUUID(), parentSnapshotId: null, floorId: null, attemptId: null, source: { kind: "initial", runId: null, jobId: null } };
    this.save(accountId, initial);
    return initial;
  }

  initialize(
    accountId: string,
    sessionId: string,
    variables: RoleState,
    validate?: RoleStateValidator,
  ): RoleDisplaySnapshot {
    const session = this.session(accountId, sessionId);
    const existing = this.first(accountId, sessionId);
    if (existing) return existing;
    if (!session.characterVersionId)
      throw new Error(
        "Role session has no fixed character version. Create the session from a published role version.",
      );
    const expand = (value: unknown): unknown => {
      if (typeof value === "string")
        return previewPromptMacroText({
          session,
          text: value,
          chatHistory: [],
          ordinaryVariables: { stat_data: variables },
          localValues: { stat_data: variables as StMacroJsonValue },
          globalValues: {},
        }).text;
      if (Array.isArray(value)) return value.map(expand);
      if (value !== null && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, expand(item)]),
        );
      return value;
    };
    const record: RoleDisplaySnapshot = {
      sessionId,
      branchId: "main",
      floorId: null,
      attemptId: null,
      versionId: session.characterVersionId,
      snapshotId: randomUUID(),
      parentSnapshotId: null,
      variables: expand(variables) as RoleState,
      source: { kind: "initial", runId: null, jobId: null },
    };
    if (validate && !validate(record.variables))
      throw new RoleRuntimeError("ROLE_INITIAL_STATE_INVALID", 422);
    this.save(accountId, record);
    return record;
  }

  save(accountId: string, record: RoleDisplaySnapshot, repair?: { operationId: string; expectedSnapshotId: string; sourceSnapshotId: string | null; latestFloorId?: string; commitModelCalls?: (tx: Pick<AppDb, "select" | "update">) => void }, calculationBefore?: RoleState): void {
    if (!roleRuntimeValidators.record(record))
      throw new Error(
        "Display snapshot violates the shared runtime record schema. Correct the snapshot fields before submitting it.",
      );
    const session = this.session(accountId, record.sessionId);
    if (session.characterVersionId !== record.versionId)
      throw new Error(
        "Display snapshot uses another character version. Use the version fixed by this session.",
      );
    this.db.transaction((tx) => {
      if (record.floorId !== null) {
        const floor = tx
          .select()
          .from(floors)
          .where(
            and(
              eq(floors.id, record.floorId),
              eq(floors.sessionId, record.sessionId),
              eq(floors.branchId, record.branchId),
              isNull(floors.supersededAt),
            ),
          )
          .get();
        if (!floor || floor.state !== "committed")
          throw new Error(
            "Display snapshot requires a committed floor in the same session branch. Complete its reply before updating state.",
          );
      }
      if (repair?.latestFloorId) {
        const latestFloor = tx.select({ id: floors.id }).from(floors).where(and(
          eq(floors.sessionId, record.sessionId),
          eq(floors.branchId, record.branchId),
          eq(floors.state, "committed"),
          isNull(floors.supersededAt),
        )).orderBy(desc(floors.floorNo)).limit(1).get();
        if (latestFloor?.id !== repair.latestFloorId) throw new RoleRuntimeError("ROLE_STATE_REPAIR_FLOOR_CHANGED", 409, {
          floor_id: repair.latestFloorId,
          current_floor_id: latestFloor?.id ?? null,
        });
      }
      const previousRow = tx
        .select()
        .from(roleDisplaySnapshots)
        .where(
          and(
            eq(roleDisplaySnapshots.accountId, accountId),
            eq(roleDisplaySnapshots.sessionId, record.sessionId),
            eq(roleDisplaySnapshots.branchId, record.branchId),
          ),
        )
        .orderBy(desc(roleDisplaySnapshots.snapshotNo))
        .limit(1)
        .get();
      const previous = previousRow ? this.parse(previousRow.recordJson) : null;
      if ((previous?.snapshotId ?? null) !== record.parentSnapshotId) {
        if (repair) throw new RoleRuntimeError("ROLE_STATE_REPAIR_STALE", 409, {
          expected_snapshot_id: repair.expectedSnapshotId,
          current_snapshot_id: previous?.snapshotId ?? null,
        });
        throw new Error("Display snapshot parent is no longer current. Reload the committed state before generating another update.");
      }
      const last = tx
        .select({ number: max(roleDisplaySnapshots.snapshotNo) })
        .from(roleDisplaySnapshots)
        .where(
          and(
            eq(roleDisplaySnapshots.sessionId, record.sessionId),
            eq(roleDisplaySnapshots.branchId, record.branchId),
          ),
        )
        .get();
      const snapshotNo = (last?.number ?? -1) + 1;
      tx.insert(roleDisplaySnapshots)
        .values({
          id: record.snapshotId,
          accountId,
          sessionId: record.sessionId,
          branchId: record.branchId,
          floorId: record.floorId,
          snapshotNo,
          recordJson: JSON.stringify(record),
          calculationBeforeJson: calculationBefore === undefined ? null : JSON.stringify(calculationBefore),
        })
        .run();
      new VariableService(tx).restoreMany({
        accountId,
        items: [
          {
            scope: "branch",
            scopeId: buildBranchVariableScopeId(
              record.sessionId,
              record.branchId,
            ),
            key: "stat_data",
            value: record.variables,
            updatedAt: Date.now(),
          },
        ],
      });
      repair?.commitModelCalls?.(tx);
      if (repair) tx.update(roleStateOperations).set({
        status: "succeeded",
        beforeSnapshotId: record.parentSnapshotId,
        sourceSnapshotId: repair.sourceSnapshotId,
        afterSnapshotId: record.snapshotId,
        updatedAt: Date.now(),
      }).where(eq(roleStateOperations.id, repair.operationId)).run();
    });
  }

  completeNoop(accountId: string, record: RoleDisplaySnapshot, operationId: string, sourceSnapshotId: string | null): void {
    this.db.transaction((tx) => {
      const current = tx.select({ id: roleDisplaySnapshots.id }).from(roleDisplaySnapshots).where(and(
        eq(roleDisplaySnapshots.accountId, accountId),
        eq(roleDisplaySnapshots.sessionId, record.sessionId),
        eq(roleDisplaySnapshots.branchId, record.branchId),
      )).orderBy(desc(roleDisplaySnapshots.snapshotNo)).limit(1).get();
      if (current?.id !== record.snapshotId) throw new RoleRuntimeError("ROLE_STATE_REPAIR_STALE", 409, {
        expected_snapshot_id: record.snapshotId,
        current_snapshot_id: current?.id ?? null,
      });
      tx.update(roleStateOperations).set({
        status: "succeeded",
        beforeSnapshotId: record.snapshotId,
        sourceSnapshotId,
        afterSnapshotId: record.snapshotId,
        updatedAt: Date.now(),
      }).where(eq(roleStateOperations.id, operationId)).run();
    });
  }

  private parse(json: string): RoleDisplaySnapshot {
    const value: unknown = JSON.parse(json);
    if (!roleRuntimeValidators.record(value))
      throw new Error(
        "Saved display snapshot violates the runtime record schema. Restore the snapshot from a valid database backup.",
      );
    return value as RoleDisplaySnapshot;
  }
}
