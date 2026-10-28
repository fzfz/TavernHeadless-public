CREATE TABLE public_role_session (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES account(id),
  release_id TEXT NOT NULL REFERENCES role_release(id),
  publisher_account_id TEXT NOT NULL REFERENCES account(id),
  operation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  opening_id TEXT,
  session_type TEXT NOT NULL DEFAULT 'individual',
  ready INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(account_id, operation_id)
);
