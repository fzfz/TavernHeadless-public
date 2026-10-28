CREATE TABLE `model_call_records` (
  `call_id` text PRIMARY KEY NOT NULL,
  `invocation_id` text NOT NULL,
  `request_attempt_no` integer NOT NULL,
  `account_id` text NOT NULL,
  `session_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `floor_id` text NOT NULL,
  `run_id` text NOT NULL,
  `attempt_no` integer NOT NULL,
  `prepared_at` integer NOT NULL,
  `status` text NOT NULL,
  `record_json` text NOT NULL,
  `turn_commit_status` text NOT NULL DEFAULT 'pending'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_call_invocation_request_uq` ON `model_call_records` (`invocation_id`, `request_attempt_no`);
--> statement-breakpoint
CREATE INDEX `model_call_floor_history_idx` ON `model_call_records` (`account_id`, `floor_id`, `prepared_at`, `call_id`);
--> statement-breakpoint
CREATE INDEX `model_call_run_history_idx` ON `model_call_records` (`account_id`, `run_id`, `attempt_no`);
