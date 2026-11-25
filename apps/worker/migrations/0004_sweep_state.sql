-- Where background sweeps left off, so each run continues from there.
-- 'expired_pages': the R2 list cursor for the expired-page file cleanup.
CREATE TABLE sweep_state (
  name TEXT PRIMARY KEY,
  cursor TEXT,
  -- Unix milliseconds: last update, and when the current pass started.
  updated_at INTEGER NOT NULL,
  pass_started_at INTEGER
);

-- Page files whose KV record was found missing. A file is only deleted when
-- a later run, at least a day after first_seen, finds the record still
-- missing and the file unchanged (same etag).
CREATE TABLE sweep_candidates (
  key TEXT PRIMARY KEY,
  etag TEXT NOT NULL,
  -- Unix milliseconds.
  first_seen INTEGER NOT NULL
);
