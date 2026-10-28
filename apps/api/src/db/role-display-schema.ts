import { sessions, floors } from "./schema.js";
import { sql } from "drizzle-orm";
import {
  integer,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const roleDisplaySnapshots = sqliteTable(
  "role_display_snapshot",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    branchId: text("branch_id").notNull(),
    floorId: text("floor_id").references(() => floors.id, {
      onDelete: "cascade",
    }),
    snapshotNo: integer("snapshot_no").notNull(),
    recordJson: text("record_json").notNull(),
    calculationBeforeJson: text("calculation_before_json"),
  },
  (table) => ({
    initialUnique: uniqueIndex("role_display_snapshot_initial_uq")
      .on(table.sessionId, table.branchId)
      .where(sql`${table.floorId} IS NULL AND ${table.snapshotNo} = 0`),
    orderUnique: uniqueIndex("role_display_snapshot_order_uq").on(
      table.sessionId,
      table.branchId,
      table.snapshotNo,
    ),
  }),
);

export const roleStateOperations = sqliteTable("role_state_operation", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  branchId: text("branch_id").notNull(),
  kind: text("kind", { enum: ["recalculate", "restore_missing"] }).notNull(),
  floorId: text("floor_id").references(() => floors.id, { onDelete: "set null" }),
  inputJson: text("input_json").notNull(),
  beforeSnapshotId: text("before_snapshot_id"),
  sourceSnapshotId: text("source_snapshot_id"),
  afterSnapshotId: text("after_snapshot_id"),
  status: text("status", { enum: ["running", "succeeded", "failed"] }).notNull(),
  errorJson: text("error_json"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => ({
  sessionBranchIdx: index("role_state_operation_session_branch_idx").on(table.sessionId, table.branchId, table.createdAt),
}));
