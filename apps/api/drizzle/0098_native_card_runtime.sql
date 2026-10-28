CREATE TABLE role_release_native_migration (
 id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, name TEXT NOT NULL,
 character_id TEXT NOT NULL, character_version_id TEXT NOT NULL, character_snapshot_json TEXT NOT NULL,
 preset_id TEXT NOT NULL, preset_version_id TEXT NOT NULL,
 regex_profile_id TEXT, regex_profile_version_id TEXT, worldbook_id TEXT, worldbook_version_id TEXT,
 prompt_mode TEXT NOT NULL, model_slots_json TEXT NOT NULL, default_user_id TEXT NOT NULL,
 default_user_snapshot_json TEXT NOT NULL, openings_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 is_active INTEGER NOT NULL DEFAULT 0,
 FOREIGN KEY(account_id) REFERENCES account(id) ON DELETE RESTRICT
);
--> statement-breakpoint
INSERT INTO role_release_native_migration SELECT * FROM role_release ORDER BY rowid;
--> statement-breakpoint
DROP TABLE role_release;
--> statement-breakpoint
ALTER TABLE role_release_native_migration RENAME TO role_release;
--> statement-breakpoint
CREATE INDEX role_release_account_created_idx ON role_release(account_id,created_at,id);
--> statement-breakpoint
CREATE UNIQUE INDEX role_release_active_character_idx ON role_release(account_id,character_id) WHERE is_active = 1;
--> statement-breakpoint
CREATE TABLE native_card_resource_binding (
 card_id TEXT NOT NULL, revision INTEGER NOT NULL, kind TEXT NOT NULL,
 local_id TEXT NOT NULL, local_version_id TEXT NOT NULL, package_resource_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL, enabled INTEGER NOT NULL,
 PRIMARY KEY(card_id,revision,kind,local_id),
 UNIQUE(card_id,revision,kind,package_resource_id),
 FOREIGN KEY(card_id,revision) REFERENCES native_card_revision(card_id,revision) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX native_card_resource_binding_order_idx ON native_card_resource_binding(card_id,revision,kind,ordinal);
--> statement-breakpoint
CREATE TABLE native_card_publication (
 id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, card_id TEXT NOT NULL,
 revision INTEGER NOT NULL, character_version_id TEXT NOT NULL, release_id TEXT NOT NULL,
 resource_mappings_json TEXT NOT NULL, created_at INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '',
 FOREIGN KEY(account_id) REFERENCES account(id) ON DELETE RESTRICT,
 FOREIGN KEY(card_id,revision) REFERENCES native_card_revision(card_id,revision) ON DELETE RESTRICT,
 FOREIGN KEY(character_version_id) REFERENCES character_version(id) ON DELETE RESTRICT,
 FOREIGN KEY(release_id) REFERENCES role_release(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX native_card_publication_card_idx ON native_card_publication(account_id,card_id,created_at);
--> statement-breakpoint
CREATE TABLE native_card_version_binding (
 character_version_id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL,
 card_id TEXT NOT NULL, revision INTEGER NOT NULL, created_at INTEGER NOT NULL,
 FOREIGN KEY(account_id) REFERENCES account(id) ON DELETE RESTRICT,
 FOREIGN KEY(character_version_id) REFERENCES character_version(id) ON DELETE CASCADE,
 FOREIGN KEY(card_id,revision) REFERENCES native_card_revision(card_id,revision) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX native_card_version_binding_card_idx ON native_card_version_binding(account_id,card_id,revision);
