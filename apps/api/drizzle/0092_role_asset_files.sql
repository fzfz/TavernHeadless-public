CREATE TABLE `role_asset_bundle` (
  `version_id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `character_id` text NOT NULL,
  `storage_key` text NOT NULL,
  `import_id` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_asset_bundle_storage_uq` ON `role_asset_bundle` (`storage_key`);
--> statement-breakpoint
CREATE TABLE `role_asset` (
  `version_id` text NOT NULL,
  `name` text NOT NULL,
  `mime` text NOT NULL,
  `byte_size` integer NOT NULL,
  `purpose` text NOT NULL,
  PRIMARY KEY (`version_id`, `name`),
  FOREIGN KEY (`version_id`) REFERENCES `role_asset_bundle` (`version_id`) ON UPDATE no action ON DELETE restrict
);
