import {
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { RoleAssetFile } from "@tavern/shared";

export const roleAssetBundles = sqliteTable(
  "role_asset_bundle",
  {
    versionId: text("version_id").primaryKey(),
    accountId: text("account_id").notNull(),
    characterId: text("character_id").notNull(),
    storageKey: text("storage_key").notNull(),
    importId: text("import_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    storageKeyUnique: uniqueIndex("role_asset_bundle_storage_uq").on(
      table.storageKey,
    ),
  }),
);

export const roleAssets = sqliteTable(
  "role_asset",
  {
    versionId: text("version_id")
      .notNull()
      .references(() => roleAssetBundles.versionId, { onDelete: "restrict" }),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    byteSize: integer("byte_size").notNull(),
    purpose: text("purpose").$type<RoleAssetFile["purpose"]>().notNull(),
  },
  (table) => ({ pk: primaryKey({ columns: [table.versionId, table.name] }) }),
);
