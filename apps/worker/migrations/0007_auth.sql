-- WorkOS sign-in (Phase 3). Additive: one new table and one new nullable
-- column; nothing existing changes.

-- CLI device sign-in codes (aired's own device flow, Task 3.5). Only a
-- SHA-256 of the device code is stored; the user code is what a person types.
CREATE TABLE auth_tokens (
  device_hash TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  -- Unix milliseconds.
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  -- Set when a signed-in person approves the code.
  approved_user_id INTEGER,
  -- When that person signed in (Unix seconds). The CLI token inherits it, so
  -- signing out everywhere retires tokens collected from earlier approvals.
  approved_auth_time INTEGER,
  -- Set when the CLI collects its session; a code works once.
  consumed_at INTEGER
);
-- Starting a device sign-in clears expired rows first.
CREATE INDEX auth_tokens_expires_at ON auth_tokens (expires_at);

-- "Sign out everywhere" for one person (Phase 8 reads it). Unix seconds.
ALTER TABLE users ADD COLUMN sessions_valid_since INTEGER;
