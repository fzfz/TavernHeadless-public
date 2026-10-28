ALTER TABLE role_release ADD COLUMN state_preset_id TEXT;
--> statement-breakpoint
ALTER TABLE role_release ADD COLUMN state_preset_version_id TEXT;
--> statement-breakpoint
ALTER TABLE role_release ADD COLUMN state_history_turns INTEGER NOT NULL DEFAULT 5;
--> statement-breakpoint
ALTER TABLE floor_result_snapshot ADD COLUMN prompt_context_json TEXT;
