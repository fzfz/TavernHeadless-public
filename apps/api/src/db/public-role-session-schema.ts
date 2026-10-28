import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { accounts, sessions } from "./schema.js";
import { roleReleases } from "./role-release-schema.js";

export const publicRoleSessions = sqliteTable(
  "public_role_session",
  {
    sessionId: text("session_id")
      .primaryKey()
      .references(() => sessions.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    releaseId: text("release_id")
      .notNull()
      .references(() => roleReleases.id),
    publisherAccountId: text("publisher_account_id")
      .notNull()
      .references(() => accounts.id),
    operationId: text("operation_id").notNull(),
    userId: text("user_id").notNull(),
    openingId: text("opening_id"),
    sessionType: text("session_type", { enum: ["individual", "group"] })
      .notNull()
      .default("individual"),
    ready: integer("ready", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("public_role_session_operation").on(
      table.accountId,
      table.operationId,
    ),
  ],
);
