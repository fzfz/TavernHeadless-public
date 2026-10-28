CREATE TABLE IF NOT EXISTS `role_release` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `name` text NOT NULL,
  `character_id` text NOT NULL,
  `character_version_id` text NOT NULL,
  `character_snapshot_json` text NOT NULL,
  `preset_id` text NOT NULL,
  `preset_version_id` text NOT NULL,
  `regex_profile_id` text NOT NULL,
  `regex_profile_version_id` text NOT NULL,
  `worldbook_id` text,
  `worldbook_version_id` text,
  `prompt_mode` text NOT NULL,
  `model_slots_json` text NOT NULL,
  `default_user_id` text NOT NULL,
  `default_user_snapshot_json` text NOT NULL,
  `openings_json` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `role_release_account_created_idx` ON `role_release` (`account_id`,`created_at`,`id`);
