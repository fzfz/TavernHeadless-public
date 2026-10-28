CREATE TABLE role_app_draft (
 id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, creator_id TEXT NOT NULL,
 revision INTEGER NOT NULL, input_json TEXT NOT NULL, snapshot_json TEXT NOT NULL, updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX role_app_draft_account_idx ON role_app_draft(account_id, updated_at);
