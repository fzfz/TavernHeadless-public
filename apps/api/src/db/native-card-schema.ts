import {
  integer,
  sqliteTable,
  text,
  index,
  uniqueIndex,
  primaryKey,
  foreignKey,
} from "drizzle-orm/sqlite-core";
import { accounts, characters, characterVersions } from "./schema.js";

export const nativeCards = sqliteTable(
  "native_card",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    packageId: text("package_id").notNull(),
    name: text("name").notNull(),
    currentRevision: integer("current_revision").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    character: uniqueIndex("native_card_character_uq").on(t.characterId),
    account: index("native_card_account_updated_idx").on(
      t.accountId,
      t.updatedAt,
    ),
  }),
);
export const nativeCardRevisions = sqliteTable(
  "native_card_revision",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => nativeCards.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    packageId: text("package_id").notNull(),
    manifestJson: text("manifest_json").notNull(),
    fileCount: integer("file_count").notNull(),
    totalBytes: integer("total_bytes").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cardId, t.revision] }) }),
);
export const nativeCardImports = sqliteTable(
  "native_card_import",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    packageId: text("package_id"),
    name: text("name"),
    confirmedCardId: text("confirmed_card_id"),
    status: text("status").notNull(),
    issuesJson: text("issues_json").notNull().default("[]"),
    fileCount: integer("file_count").notNull().default(0),
    totalBytes: integer("total_bytes").notNull().default(0),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    account: index("native_card_import_account_status_idx").on(
      t.accountId,
      t.status,
      t.createdAt,
    ),
    storage: uniqueIndex("native_card_import_storage_uq").on(t.storageKey),
  }),
);
export const nativeCardBuilds = sqliteTable(
  "native_card_build",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    cardId: text("card_id").notNull(),
    sourceRevision: integer("source_revision").notNull(),
    sourceVersionId: text("source_version_id").references(
      () => characterVersions.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull(),
    stage: text("stage").notNull(),
    storageKey: text("storage_key"),
    issuesJson: text("issues_json").notNull().default("[]"),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    revision: foreignKey({
      columns: [t.cardId, t.sourceRevision],
      foreignColumns: [
        nativeCardRevisions.cardId,
        nativeCardRevisions.revision,
      ],
    }).onDelete("restrict"),
    account: index("native_card_build_account_updated_idx").on(
      t.accountId,
      t.updatedAt,
    ),
    card: index("native_card_build_card_revision_idx").on(
      t.cardId,
      t.sourceRevision,
      t.createdAt,
    ),
  }),
);
