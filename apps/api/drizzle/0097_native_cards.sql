CREATE TABLE native_card (
 id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, character_id TEXT NOT NULL,
 package_id TEXT NOT NULL, name TEXT NOT NULL, current_revision INTEGER NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 FOREIGN KEY(account_id) REFERENCES account(id) ON DELETE RESTRICT,
 FOREIGN KEY(character_id) REFERENCES character(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX native_card_character_uq ON native_card(character_id);
--> statement-breakpoint
CREATE INDEX native_card_account_updated_idx ON native_card(account_id,updated_at);
--> statement-breakpoint
CREATE TABLE native_card_revision (
 card_id TEXT NOT NULL, revision INTEGER NOT NULL, storage_key TEXT NOT NULL UNIQUE,
 package_id TEXT NOT NULL, manifest_json TEXT NOT NULL, file_count INTEGER NOT NULL,
 total_bytes INTEGER NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(card_id,revision),
 FOREIGN KEY(card_id) REFERENCES native_card(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE native_card_import (
 id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, storage_key TEXT NOT NULL,
 file_name TEXT NOT NULL, package_id TEXT, name TEXT, status TEXT NOT NULL,
 issues_json TEXT NOT NULL DEFAULT '[]', file_count INTEGER NOT NULL DEFAULT 0,
 total_bytes INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 FOREIGN KEY(account_id) REFERENCES account(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX native_card_import_account_status_idx ON native_card_import(account_id,status,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX native_card_import_storage_uq ON native_card_import(storage_key);
--> statement-breakpoint
CREATE TABLE native_card_build (
 id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, card_id TEXT NOT NULL,
 source_revision INTEGER NOT NULL, source_version_id TEXT, status TEXT NOT NULL,
 stage TEXT NOT NULL, storage_key TEXT, issues_json TEXT NOT NULL DEFAULT '[]',
 expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 FOREIGN KEY(account_id) REFERENCES account(id) ON DELETE RESTRICT,
 FOREIGN KEY(card_id,source_revision) REFERENCES native_card_revision(card_id,revision) ON DELETE RESTRICT,
 FOREIGN KEY(source_version_id) REFERENCES character_version(id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX native_card_build_account_updated_idx ON native_card_build(account_id,updated_at);
--> statement-breakpoint
CREATE INDEX native_card_build_card_revision_idx ON native_card_build(card_id,source_revision,created_at);
