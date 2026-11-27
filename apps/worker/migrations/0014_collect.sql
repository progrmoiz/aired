-- The data layer (lib/collect-store.ts): what viewers save with
-- aired.collect, and the JSON an owner pushes with update_data.
--
-- Only pages with an owner collect. owner_id is copied onto every row so
-- account deletion can remove them in one statement in its batch.

-- One row per saved entry.
--   viewer: the per-page viewer key (lib/collect-token.ts), an HMAC of the
--     viewer's cookie and the page id. The same person has a different key
--     on every page, and the key can't be turned back into the cookie.
--   entry_key: optional, set by the page (save(record, { key })). One row per
--     (page, viewer, key): saving again replaces it, for a vote or a checklist.
--   data: the record as JSON, checked by lib/collect-validate.ts.
--   expires_at: unix ms when the plan's retention ends; NULL keeps it while
--     the page lives. The hourly housekeeping deletes rows past it.
CREATE TABLE responses (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  viewer TEXT NOT NULL,
  entry_key TEXT,
  data TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER
);

-- The owner's list and the monthly count (newest first, per page).
CREATE INDEX responses_page_created ON responses (page_id, created_at DESC, id DESC);
-- A viewer's own entries.
CREATE INDEX responses_page_viewer ON responses (page_id, viewer, created_at DESC);
-- One keyed entry per viewer.
CREATE UNIQUE INDEX responses_page_viewer_key ON responses (page_id, viewer, entry_key) WHERE entry_key IS NOT NULL;
-- Account deletion and retention.
CREATE INDEX responses_owner ON responses (owner_id);
CREATE INDEX responses_expires ON responses (expires_at) WHERE expires_at IS NOT NULL;

-- One row per page that has data-layer settings or live data.
--   public_results: 1 lets every viewer read all entries (aired.collect.all),
--     for polls. 0 (default): viewers read only their own.
--   closed: 1 stops new saves (the owner closed the form).
--   data: the JSON an owner or agent pushed with update_data, or NULL.
--   data_version: goes up by one on every push; open pages poll it.
--   entries, bytes: what the page holds now. month, month_count: the UTC
--     month ('2026-11') and the entries created in it. Kept here so a save
--     checks the plan's caps with one row instead of counting every entry;
--     every delete takes its rows off, and housekeeping recounts after the
--     retention sweep.
CREATE TABLE page_data (
  page_id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  public_results INTEGER NOT NULL DEFAULT 0,
  closed INTEGER NOT NULL DEFAULT 0,
  data TEXT,
  data_size INTEGER NOT NULL DEFAULT 0,
  data_version INTEGER NOT NULL DEFAULT 0,
  entries INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  month TEXT NOT NULL DEFAULT '',
  month_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX page_data_owner ON page_data (owner_id);
