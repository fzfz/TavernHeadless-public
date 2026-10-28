import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { ModelCallRecord } from "@tavern/shared";

export const modelCallRecords = sqliteTable(
  "model_call_records",
  {
    callId: text("call_id").primaryKey(),
    invocationId: text("invocation_id").notNull(),
    requestAttemptNo: integer("request_attempt_no").notNull(),
    accountId: text("account_id").notNull(),
    sessionId: text("session_id").notNull(),
    branchId: text("branch_id").notNull(),
    floorId: text("floor_id").notNull(),
    runId: text("run_id").notNull(),
    attemptNo: integer("attempt_no").notNull(),
    preparedAt: integer("prepared_at").notNull(),
    status: text("status").$type<ModelCallRecord["status"]>().notNull(),
    recordJson: text("record_json").notNull(),
    turnCommitStatus: text("turn_commit_status")
      .$type<"pending" | "committed" | "failed">()
      .notNull()
      .default("pending"),
  },
  (table) => ({
    requestUnique: uniqueIndex("model_call_invocation_request_uq").on(
      table.invocationId,
      table.requestAttemptNo,
    ),
    floorHistory: index("model_call_floor_history_idx").on(
      table.accountId,
      table.floorId,
      table.preparedAt,
      table.callId,
    ),
    runHistory: index("model_call_run_history_idx").on(
      table.accountId,
      table.runId,
      table.attemptNo,
    ),
  }),
);
