import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
export const roleAppDrafts = sqliteTable(
  "role_app_draft",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    creatorId: text("creator_id").notNull(),
    revision: integer("revision").notNull(),
    inputJson: text("input_json").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    account: index("role_app_draft_account_idx").on(t.accountId, t.updatedAt),
  }),
);
