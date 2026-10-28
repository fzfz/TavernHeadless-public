import { and, eq } from "drizzle-orm";
import type { AppDb, DbExecutor } from "../../db/client.js";
import {
  floorRunStates,
  floors,
  operationLogs,
  sessions,
} from "../../db/schema.js";
import { OperationLogService } from "../operation-log-service.js";
import { ChatServiceError } from "./errors.js";

const action = "session.respond.accept";
const journalId = (accountId: string, sessionId: string, operationId: string) =>
  JSON.stringify([action, accountId, sessionId, operationId]);

export class RespondOperationService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  accept(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    floorId: string;
    operationId?: string;
    intent?: "send" | "continue" | "regenerate";
  }) {
    if (!input.operationId) return;
    new OperationLogService(this.db).append({
      id: journalId(input.accountId, input.sessionId, input.operationId),
      accountId: input.accountId,
      actorType: "account",
      actorId: input.accountId,
      actorAccountId: input.accountId,
      sourceType: "http",
      action,
      status: "succeeded",
      requestId: input.operationId,
      sessionId: input.sessionId,
      branchId: input.branchId,
      floorId: input.floorId,
      targetType: "floor",
      targetId: input.floorId,
      metadata: { intent: input.intent ?? "send" },
    });
  }

  find(accountId: string, sessionId: string, operationId: string) {
    const session = this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId)))
      .get();
    if (!session)
      throw new ChatServiceError("session_not_found", "Session not found");
    const row = this.db
      .select({
        floor: floors,
        run: floorRunStates,
        branchId: operationLogs.branchId,
        metadataJson: operationLogs.metadataJson,
      })
      .from(operationLogs)
      .innerJoin(floors, eq(floors.id, operationLogs.floorId))
      .leftJoin(floorRunStates, eq(floorRunStates.floorId, floors.id))
      .where(
        and(
          eq(operationLogs.id, journalId(accountId, sessionId, operationId)),
          eq(operationLogs.accountId, accountId),
          eq(operationLogs.sessionId, sessionId),
          eq(operationLogs.action, action),
        ),
      )
      .get();
    if (!row) return null;
    const metadata: { intent?: "send" | "continue" | "regenerate" } =
      JSON.parse(row.metadataJson ?? "{}");
    return {
      operationId,
      sessionId,
      intent: metadata.intent ?? "send",
      branchId: row.floor.branchId,
      floorId: row.floor.id,
      floorState: row.floor.state,
      runStatus: row.run?.status ?? null,
      publicPhase: row.run?.publicPhase ?? null,
    };
  }

  get(accountId: string, sessionId: string, operationId: string) {
    const result = this.find(accountId, sessionId, operationId);
    if (!result)
      throw new ChatServiceError(
        "response_operation_not_found",
        "This request has not created a conversation turn.",
      );
    return result;
  }
}
