-- API keys for agents and CI (aired_sk_…). Only a SHA-256 of each key is
-- stored. No foreign key to users: GitHub accounts have no users row until
-- they buy Pro. Account deletion removes a user's keys (lib/billing/forget.ts).
-- Additive: a new table, nothing else changes.
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  -- aired_sk_ plus the first 4 characters, for the dashboard list.
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  -- Unix milliseconds.
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER,
  -- For team workspaces later (Phase 8); always NULL until then.
  workspace_id TEXT
);

CREATE INDEX api_keys_user ON api_keys (user_id);
