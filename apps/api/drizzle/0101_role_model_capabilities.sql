ALTER TABLE tool_execution_record ADD COLUMN call_id TEXT;
--> statement-breakpoint
ALTER TABLE tool_execution_record ADD COLUMN generation_attempt_no INTEGER;
--> statement-breakpoint
ALTER TABLE tool_execution_record ADD COLUMN accepted_page_id TEXT REFERENCES message_page(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX tool_execution_record_accepted_page_idx ON tool_execution_record(accepted_page_id);
--> statement-breakpoint
ALTER TABLE role_release ADD COLUMN model_capabilities_json TEXT;
--> statement-breakpoint
ALTER TABLE session ADD COLUMN role_model_capabilities_snapshot_json TEXT;
