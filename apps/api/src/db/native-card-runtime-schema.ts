import {
  integer,
  sqliteTable,
  text,
  index,
  uniqueIndex,
  primaryKey,
  foreignKey,
} from "drizzle-orm/sqlite-core";
import { nativeCardRevisions } from "./native-card-schema.js";
import { accounts, characterVersions } from "./schema.js";
import { roleReleases } from "./role-release-schema.js";
export const nativeCardResourceBindings = sqliteTable(
  "native_card_resource_binding",
  {
    cardId: text("card_id").notNull(),
    revision: integer("revision").notNull(),
    kind: text("kind").notNull(),
    localId: text("local_id").notNull(),
    localVersionId: text("local_version_id").notNull(),
    packageResourceId: text("package_resource_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.cardId, t.revision, t.kind, t.localId] }),
    package: uniqueIndex("native_card_resource_binding_package_uq").on(
      t.cardId,
      t.revision,
      t.kind,
      t.packageResourceId,
    ),
    order: index("native_card_resource_binding_order_idx").on(
      t.cardId,
      t.revision,
      t.kind,
      t.ordinal,
    ),
    revision: foreignKey({
      columns: [t.cardId, t.revision],
      foreignColumns: [
        nativeCardRevisions.cardId,
        nativeCardRevisions.revision,
      ],
    }).onDelete("cascade"),
  }),
);
export const nativeCardPublications = sqliteTable(
  "native_card_publication",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    cardId: text("card_id").notNull(),
    revision: integer("revision").notNull(),
    characterVersionId: text("character_version_id")
      .notNull()
      .references(() => characterVersions.id, { onDelete: "restrict" }),
    releaseId: text("release_id")
      .notNull()
      .references(() => roleReleases.id, { onDelete: "restrict" }),
    resourceMappingsJson: text("resource_mappings_json").notNull(),
    note: text("note").notNull().default(""),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    revision: foreignKey({
      columns: [t.cardId, t.revision],
      foreignColumns: [
        nativeCardRevisions.cardId,
        nativeCardRevisions.revision,
      ],
    }).onDelete("restrict"),
    card: index("native_card_publication_card_idx").on(
      t.accountId,
      t.cardId,
      t.createdAt,
    ),
  }),
);
export const nativeCardVersionBindings = sqliteTable(
  "native_card_version_binding",
  {
    characterVersionId: text("character_version_id")
      .primaryKey()
      .references(() => characterVersions.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    cardId: text("card_id").notNull(),
    revision: integer("revision").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    revision: foreignKey({
      columns: [t.cardId, t.revision],
      foreignColumns: [
        nativeCardRevisions.cardId,
        nativeCardRevisions.revision,
      ],
    }).onDelete("restrict"),
    card: index("native_card_version_binding_card_idx").on(
      t.accountId,
      t.cardId,
      t.revision,
    ),
  }),
);
