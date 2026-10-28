import { and, asc, eq, inArray } from "drizzle-orm";
import { roleToolEvidenceSchema, type RoleToolEvidence } from "@tavern/shared";
import type { AppDb } from "../../db/client.js";
import {
  floors,
  messagePages,
  sessions,
  toolExecutionRecords,
} from "../../db/schema.js";

export function loadAcceptedRoleToolEvidence(
  db: AppDb,
  accountId: string,
  sessionId: string,
  sourcePageIds: string[],
): RoleToolEvidence[] {
  if (!sourcePageIds.length) return [];
  const rows = db
    .select({ execution: toolExecutionRecords })
    .from(toolExecutionRecords)
    .innerJoin(
      messagePages,
      eq(messagePages.id, toolExecutionRecords.acceptedPageId),
    )
    .innerJoin(floors, eq(floors.id, messagePages.floorId))
    .innerJoin(sessions, eq(sessions.id, floors.sessionId))
    .where(
      and(
        eq(sessions.accountId, accountId),
        eq(sessions.id, sessionId),
        eq(messagePages.isActive, true),
        eq(messagePages.pageKind, "output"),
        eq(toolExecutionRecords.floorId, floors.id),
        eq(toolExecutionRecords.lifecycleState, "finished"),
        eq(toolExecutionRecords.commitOutcome, "committed"),
        inArray(toolExecutionRecords.acceptedPageId, sourcePageIds),
      ),
    )
    .orderBy(
      asc(toolExecutionRecords.startedAt),
      asc(toolExecutionRecords.attemptNo),
    )
    .all();
  return rows.map(({ execution }) =>
    roleToolEvidenceSchema.parse({
      executionId: execution.id,
      callId: execution.callId,
      runId: execution.runId,
      generationAttemptNo: execution.generationAttemptNo,
      generationStepNo: execution.generationStepNo,
      pageId: execution.acceptedPageId,
      toolName: execution.toolName,
      arguments: JSON.parse(execution.argsJson),
      result: JSON.parse(execution.resultJson),
      status: execution.status,
    }),
  );
}
