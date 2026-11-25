-- Where background sweeps left off, so each run continues from there.
-- 'expired_pages': the R2 list cursor for the expired-page file cleanup.
CREATE TABLE sweep_state (
  name TEXT PRIMARY KEY,
  cursor TEXT,
  -- Unix milliseconds.
  updated_at INTEGER NOT NULL
);
