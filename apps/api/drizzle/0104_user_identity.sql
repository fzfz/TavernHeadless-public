CREATE TABLE account_credential (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX account_credential_email_uq ON account_credential(email);
--> statement-breakpoint
CREATE TABLE account_login_session (
  token_hash TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX account_login_session_account_idx ON account_login_session(account_id);
--> statement-breakpoint
CREATE TABLE account_preference (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  default_persona_id TEXT REFERENCES account_user(id) ON DELETE SET NULL
);
