import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { accounts, accountUsers } from "./schema.js";

export const accountCredentials = sqliteTable(
  "account_credential",
  {
    accountId: text("account_id")
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    passwordSalt: text("password_salt").notNull(),
    passwordHash: text("password_hash").notNull(),
  },
  (table) => ({
    emailUnique: uniqueIndex("account_credential_email_uq").on(table.email),
  }),
);

export const accountLoginSessions = sqliteTable(
  "account_login_session",
  {
    tokenHash: text("token_hash").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => ({
    accountIdx: index("account_login_session_account_idx").on(table.accountId),
  }),
);

export const registrationOperations = sqliteTable("registration_operation", {
  id: text("id").primaryKey(),
  status: text("status", {
    enum: ["pending", "created", "not_created"],
  }).notNull(),
  accountId: text("account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  name: text("name"),
  email: text("email"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const accountPreferences = sqliteTable("account_preference", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  defaultPersonaId: text("default_persona_id").references(
    () => accountUsers.id,
    { onDelete: "set null" },
  ),
});
