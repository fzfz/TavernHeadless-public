DROP INDEX `role_display_snapshot_floor_uq`;
--> statement-breakpoint
DROP INDEX `role_display_snapshot_initial_uq`;
--> statement-breakpoint
CREATE UNIQUE INDEX `role_display_snapshot_initial_uq` ON `role_display_snapshot` (`session_id`, `branch_id`) WHERE `floor_id` IS NULL AND `snapshot_no` = 0;
--> statement-breakpoint
CREATE TABLE `role_state_operation` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `session_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `kind` text NOT NULL,
  `floor_id` text,
  `input_json` text NOT NULL,
  `before_snapshot_id` text,
  `source_snapshot_id` text,
  `after_snapshot_id` text,
  `status` text NOT NULL,
  `error_json` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `session` (`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`floor_id`) REFERENCES `floor` (`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `role_state_operation_session_branch_idx` ON `role_state_operation` (`session_id`, `branch_id`, `created_at`);

--> statement-breakpoint
ALTER TABLE `role_display_snapshot` ADD COLUMN `calculation_before_json` text;
