CREATE TABLE registration_operation (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  account_id TEXT REFERENCES account(id) ON DELETE SET NULL,
  name TEXT,
  email TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
