import { and, asc, desc, eq, isNull, ne, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { RoleDisplaySnapshot } from "@tavern/shared";
import type { AppDb } from "../db/client.js";
import {
  floors,
  sessions,
  messages,
  messagePages,
  operationLogs,
} from "../db/schema.js";
import { parseJsonField } from "../lib/http.js";
import type { AuthenticatedAuthContext } from "../plugins/auth.js";
import {
  BranchLocalVariableSnapshotService,
  isBranchLocalSnapshotMissingError,
} from "./branch-local-variable-snapshot-service.js";
import { DisplaySnapshotService } from "./role-runtime/display-snapshot-service.js";
import { OperationLogService } from "./operation-log-service.js";
import {
  GenerationCoordinatorConflictError,
  type GenerationCoordinator,
} from "./generation-guard-service.js";

const SELECT_ACTION = "reply_candidate.activate";
export class ReplyCandidateError extends Error {
  constructor(
    public readonly statusCode: 404 | 409,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export type ActivateReplyCandidateInput = {
  sessionId: string;
  branchId: string;
  floorId: string;
  expectedSnapshotId: string | null;
  operationId: string;
};

export class ReplyCandidateService {
  constructor(
    private readonly db: AppDb,
    private readonly coordinator: GenerationCoordinator,
  ) {}

  private session(accountId: string, sessionId: string) {
    const session = this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId)))
      .get();
    if (!session)
      throw new ReplyCandidateError(
        404,
        "not_found",
        "演绎不存在，请返回历史演绎。",
      );
    return session;
  }

  private head(sessionId: string, branchId: string) {
    return this.db
      .select()
      .from(floors)
      .where(
        and(
          eq(floors.sessionId, sessionId),
          eq(floors.branchId, branchId),
          ne(floors.state, "failed"),
          isNull(floors.supersededAt),
        ),
      )
      .orderBy(desc(floors.floorNo), desc(floors.createdAt))
      .get();
  }

  private hasReadyState(
    accountId: string,
    sessionId: string,
    branchId: string,
    floorId: string,
  ): boolean {
    const snapshots = new DisplaySnapshotService(this.db);
    return (
      snapshots.latest(accountId, sessionId, branchId) === null ||
      snapshots.getByFloor(accountId, sessionId, floorId, branchId) !== null
    );
  }

  list(accountId: string, floorId: string) {
    const floor = this.db
      .select()
      .from(floors)
      .innerJoin(sessions, eq(sessions.id, floors.sessionId))
      .where(and(eq(floors.id, floorId), eq(sessions.accountId, accountId)))
      .get()?.floor;
    if (!floor)
      throw new ReplyCandidateError(
        404,
        "not_found",
        "回复不存在，请刷新演绎页面。",
      );
    const head = this.head(floor.sessionId, floor.branchId);
    const group = this.db
      .select()
      .from(floors)
      .where(
        and(
          eq(floors.sessionId, floor.sessionId),
          eq(floors.branchId, floor.branchId),
          eq(floors.floorNo, floor.floorNo),
          eq(floors.state, "committed"),
        ),
      )
      .orderBy(asc(floors.createdAt), asc(floors.id))
      .all();
    return {
      session_id: floor.sessionId,
      branch_id: floor.branchId,
      floor_no: floor.floorNo,
      active_floor_id:
        group.find((item) => item.supersededAt === null)?.id ?? null,
      can_activate:
        head?.floorNo === floor.floorNo &&
        head.state === "committed" &&
        this.hasReadyState(accountId, floor.sessionId, floor.branchId, head.id),
      items: group.map((item) => {
        const rows = this.db
          .select({ message: messages, pageId: messagePages.id })
          .from(messagePages)
          .innerJoin(messages, eq(messages.pageId, messagePages.id))
          .where(
            and(
              eq(messagePages.floorId, item.id),
              eq(messagePages.isActive, true),
              or(
                eq(messagePages.pageKind, "output"),
                eq(messagePages.pageKind, "mixed"),
              ),
              or(eq(messages.role, "assistant"), eq(messages.role, "narrator")),
              eq(messages.isHidden, false),
            ),
          )
          .orderBy(asc(messages.seq), asc(messages.id))
          .all();
        return {
          floor_id: item.id,
          page_id: rows[0]?.pageId ?? null,
          text: rows.map((row) => row.message.content).join("\n\n"),
          created_at: item.createdAt,
        };
      }),
    };
  }

  async activate(
    actor: AuthenticatedAuthContext,
    input: ActivateReplyCandidateInput,
  ) {
    const session = this.session(actor.accountId, input.sessionId);
    if (session.status !== "active")
      throw new ReplyCandidateError(
        409,
        "invalid_state",
        "此演绎已归档，请返回历史演绎。",
      );
    try {
      return await this.coordinator.execute({
        sessionId: input.sessionId,
        branchId: input.branchId,
        mode: "reject",
        task: async () =>
          this.db.transaction((tx) => {
            const snapshots = new DisplaySnapshotService(this.db);
            const receiptId = JSON.stringify([
              actor.accountId,
              input.sessionId,
              SELECT_ACTION,
              input.operationId,
            ]);
            const receipt = tx
              .select()
              .from(operationLogs)
              .where(eq(operationLogs.id, receiptId))
              .get();
            if (receipt) {
              const metadata = parseJsonField(receipt.metadataJson) as {
                floor_id?: string;
                branch_id?: string;
                expected_snapshot_id?: string | null;
              } | null;
              if (
                metadata?.floor_id !== input.floorId ||
                metadata.branch_id !== input.branchId ||
                metadata.expected_snapshot_id !== input.expectedSnapshotId
              )
                throw new ReplyCandidateError(
                  409,
                  "operation_conflict",
                  "候选选择请求与已保存内容不一致，请刷新页面。",
                );
              return {
                active_floor_id:
                  this.head(input.sessionId, input.branchId)?.id ?? null,
                current: snapshots.latest(
                  actor.accountId,
                  input.sessionId,
                  input.branchId,
                ),
              };
            }
            const target = tx
              .select()
              .from(floors)
              .where(
                and(
                  eq(floors.id, input.floorId),
                  eq(floors.sessionId, input.sessionId),
                  eq(floors.branchId, input.branchId),
                  eq(floors.state, "committed"),
                ),
              )
              .get();
            if (!target)
              throw new ReplyCandidateError(
                404,
                "not_found",
                "候选回复不可用，请刷新演绎页面。",
              );
            const head = this.head(input.sessionId, input.branchId);
            if (
              !head ||
              head.floorNo !== target.floorNo ||
              head.state !== "committed"
            )
              throw new ReplyCandidateError(
                409,
                "candidate_not_last_turn",
                "只能切换最后一轮的候选回复，请从该轮建立分支后继续。",
              );
            const current = snapshots.latest(
              actor.accountId,
              input.sessionId,
              input.branchId,
            );
            if ((current?.snapshotId ?? null) !== input.expectedSnapshotId)
              throw new ReplyCandidateError(
                409,
                "candidate_state_stale",
                "演绎状态已更新，请刷新后重新选择。",
              );
            const source = snapshots.getByFloor(
              actor.accountId,
              input.sessionId,
              target.id,
              input.branchId,
            );
            if (
              head.id !== target.id &&
              current &&
              (!source ||
                !this.hasReadyState(
                  actor.accountId,
                  input.sessionId,
                  input.branchId,
                  head.id,
                ))
            ) {
              throw new ReplyCandidateError(
                409,
                "candidate_state_unavailable",
                "角色状态尚未更新，请重试角色状态更新后再切换候选回复。",
              );
            }
            const now = Date.now();
            if (head.id !== target.id) {
              tx.update(floors)
                .set({
                  supersededAt: now,
                  supersededByFloorId: target.id,
                  updatedAt: now,
                })
                .where(eq(floors.id, head.id))
                .run();
              tx.update(floors)
                .set({
                  supersededAt: null,
                  supersededByFloorId: null,
                  updatedAt: now,
                })
                .where(eq(floors.id, target.id))
                .run();
            }
            let next: RoleDisplaySnapshot | null = current;
            if (head.id !== target.id) {
              new BranchLocalVariableSnapshotService(tx).restoreBranchFromFloor(
                {
                  accountId: actor.accountId,
                  sessionId: input.sessionId,
                  sourceFloorId: target.id,
                  sourceBranchId: input.branchId,
                  targetBranchId: input.branchId,
                  createdAt: now,
                },
              );
              if (current) {
                next = {
                  ...current,
                  snapshotId: randomUUID(),
                  parentSnapshotId: current.snapshotId,
                  floorId: target.id,
                  attemptId: source?.attemptId ?? null,
                  variables: source!.variables,
                  source: { kind: "manual", runId: null, jobId: null },
                };
                snapshots.save(actor.accountId, next);
              }
              tx.update(sessions)
                .set({ updatedAt: now })
                .where(eq(sessions.id, input.sessionId))
                .run();
            }
            new OperationLogService(tx).append({
              id: receiptId,
              accountId: actor.accountId,
              actorType: actor.actorType,
              actorId: actor.actorId,
              actorAccountId: actor.actorAccountId,
              actorClientId: actor.actorClientId,
              sourceType: "http",
              action: SELECT_ACTION,
              status: "succeeded",
              targetType: "floor",
              targetId: target.id,
              sessionId: input.sessionId,
              branchId: input.branchId,
              floorId: target.id,
              metadata: {
                floor_id: input.floorId,
                branch_id: input.branchId,
                expected_snapshot_id: input.expectedSnapshotId,
              },
              beforeRef: {
                active_floor_id: head.id,
                snapshot_id: current?.snapshotId ?? null,
              },
              afterRef: {
                active_floor_id: target.id,
                snapshot_id: next?.snapshotId ?? null,
              },
              createdAt: now,
            });
            return { active_floor_id: target.id, current: next };
          }),
      });
    } catch (error) {
      if (isBranchLocalSnapshotMissingError(error))
        throw new ReplyCandidateError(
          409,
          "candidate_state_unavailable",
          "候选回复缺少保存的变量，请选择其他回复。",
        );
      if (error instanceof GenerationCoordinatorConflictError)
        throw new ReplyCandidateError(
          409,
          "generation_conflict",
          "回复正在生成，请等待完成后切换候选。",
        );
      throw error;
    }
  }
}
