import { sql } from "drizzle-orm";
import { roleStatePolicy } from "@tavern/shared";
import {
  uniqueIndex,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const roleReleases = sqliteTable(
  "role_release",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    name: text("name").notNull(),
    characterId: text("character_id").notNull(),
    characterVersionId: text("character_version_id").notNull(),
    characterSnapshotJson: text("character_snapshot_json").notNull(),
    presetId: text("preset_id").notNull(),
    presetVersionId: text("preset_version_id").notNull(),
    regexProfileId: text("regex_profile_id"),
    regexProfileVersionId: text("regex_profile_version_id"),
    worldbookId: text("worldbook_id"),
    worldbookVersionId: text("worldbook_version_id"),
    promptMode: text("prompt_mode").notNull(),
    modelSlotsJson: text("model_slots_json").notNull(),
    statePresetId: text("state_preset_id"),
    statePresetVersionId: text("state_preset_version_id"),
    stateHistoryTurns: integer("state_history_turns")
      .notNull()
      .default(roleStatePolicy.defaultHistoryTurns),
    modelCapabilitiesJson: text("model_capabilities_json"),
    modelCapabilitiesRevokedAt: integer("model_capabilities_revoked_at"),
    defaultUserId: text("default_user_id").notNull(),
    defaultUserSnapshotJson: text("default_user_snapshot_json").notNull(),
    openingsJson: text("openings_json").notNull(),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    activeCharacter: uniqueIndex("role_release_active_character_idx")
      .on(table.accountId, table.characterId)
      .where(sql`${table.isActive} = 1`),
    accountCreated: index("role_release_account_created_idx").on(
      table.accountId,
      table.createdAt,
      table.id,
    ),
  }),
);
