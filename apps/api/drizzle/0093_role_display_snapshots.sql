CREATE TABLE `role_display_snapshot` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `session_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `floor_id` text,
  `snapshot_no` integer NOT NULL,
  `record_json` text NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `session` (`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`floor_id`) REFERENCES `floor` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_display_snapshot_floor_uq` ON `role_display_snapshot` (`session_id`, `floor_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_display_snapshot_initial_uq` ON `role_display_snapshot` (`session_id`, `branch_id`) WHERE `floor_id` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `role_display_snapshot_order_uq` ON `role_display_snapshot` (`session_id`, `branch_id`, `snapshot_no`);
