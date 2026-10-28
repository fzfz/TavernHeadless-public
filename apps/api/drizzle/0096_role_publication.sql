ALTER TABLE role_release ADD COLUMN is_active integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE role_release SET is_active = 1 WHERE rowid IN (
  SELECT current.rowid FROM role_release AS current
  WHERE NOT EXISTS (
    SELECT 1 FROM role_release AS newer
    WHERE newer.account_id = current.account_id AND newer.character_id = current.character_id
      AND (newer.created_at > current.created_at OR (newer.created_at = current.created_at AND newer.rowid > current.rowid))
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX role_release_active_character_idx ON role_release(account_id, character_id) WHERE is_active = 1;
