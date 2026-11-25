-- Pages published without an account that someone has claimed into theirs.
-- Once a row exists it is the authority for the page's owner and update
-- token: KV page records can be written back stale (a view bumping the read
-- count, an update racing the claim), but token checks read this row, so a
-- token retired by the claim stays retired. Rows are never deleted, because
-- without one the possibly stale KV record would be trusted again.
CREATE TABLE page_claims (
  page_id TEXT PRIMARY KEY,
  -- NULL once released: the owner deleted their account, or the page was
  -- deleted. The page is then anonymous, and only token_hash still works.
  owner_id INTEGER,
  -- SHA-256 of the current update token (the one the claim returned).
  -- 'deleted' for a deleted page: no token hashes to it.
  token_hash TEXT NOT NULL,
  -- SHA-256 of the token the page had before the claim. Only accepted to
  -- re-claim within a few minutes, so a retry after a lost response works.
  prev_token_hash TEXT NOT NULL,
  -- Unix milliseconds.
  claimed_at INTEGER NOT NULL
);

CREATE INDEX page_claims_owner ON page_claims (owner_id);
