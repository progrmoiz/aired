-- Page history (lib/page-versions.ts): every content a page has had, so its
-- owner or an agent can see what changed and put an earlier one back.
-- Restoring makes the old content a new version; nothing is rewritten.
--
-- One row per version. The live content is the row with current = 1; its
-- HTML is the page's own file (pages/<id>/index.html), so object_key is
-- NULL. When an update replaces it, its HTML (and the Markdown or deck
-- sidecar, if any) is copied to pages/<id>/versions/<key>.html and
-- .doc.json, and the row records that key.
--
--   version: 1, 2, 3 ... per page, never reused while rows remain.
--   actor: who published this content: owner (signed in), token (update
--     token), agent (through an MCP server), or unknown (before history).
--   client: web, cli, mcp or api, from the request.
--   message: the optional note sent with the update or restore.
--   restored_from: the version this one copied, for a restore.
--   created_at: when this content went live; NULL for content published
--     before history was kept.
--   replaced_at: when a newer version replaced it; NULL while current.
--   keep_until: unix ms after which hourly housekeeping may drop it (the
--     plan's days, lib/version-limits.ts); NULL: only the count limit applies.
--   removed_at: set by account deletion; housekeeping deletes the files and
--     then the row. Removed rows are never listed or restored.
CREATE TABLE page_versions (
  page_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  current INTEGER NOT NULL DEFAULT 0,
  object_key TEXT,
  has_sidecar INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL,
  title TEXT,
  kind TEXT NOT NULL DEFAULT 'page',
  actor TEXT NOT NULL,
  client TEXT,
  message TEXT,
  restored_from INTEGER,
  created_at INTEGER,
  replaced_at INTEGER,
  keep_until INTEGER,
  removed_at INTEGER,
  PRIMARY KEY (page_id, version)
);

-- At most one live version per page, even with two updates at once.
CREATE UNIQUE INDEX page_versions_current ON page_versions (page_id) WHERE current = 1 AND removed_at IS NULL;
-- Housekeeping: versions past their plan's days, and removed ones.
CREATE INDEX page_versions_keep ON page_versions (keep_until) WHERE keep_until IS NOT NULL;
CREATE INDEX page_versions_removed ON page_versions (removed_at) WHERE removed_at IS NOT NULL;
