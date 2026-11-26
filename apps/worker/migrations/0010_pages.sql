-- Pages: the source of truth for every page's facts, owner and update token
-- (lib/pages-store.ts). KV `page:<id>` stays as the viewer's read cache and
-- holds the view count; R2 holds the HTML.
--
-- This table takes over from page_claims (0003) and the KV owner and project
-- indexes. Those are still written for one release so that rolling the code
-- back loses nothing; nothing reads them for decisions any more. Additive
-- only: a rollback restores code, not D1.
CREATE TABLE pages (
  id TEXT PRIMARY KEY,
  -- NULL: anonymous (never claimed, or released when its owner deleted their account).
  owner_id INTEGER,
  -- For workspaces, later. Unused for now.
  workspace_id INTEGER,
  -- Source project (normalizeProject). NULL: Unsorted.
  project TEXT,
  title TEXT,
  -- Bytes of HTML.
  size INTEGER NOT NULL,
  -- SHA-256 of the current update token. 'deleted' for a deleted page:
  -- hashToken returns hex, so no token matches it.
  token_hash TEXT NOT NULL,
  -- Set by a claim: the token the page had before it, accepted only to
  -- re-claim within a few minutes (lib/claim-decision.ts), and when.
  prev_token_hash TEXT,
  claimed_at INTEGER,
  -- Salted PBKDF2 hash of the PIN (lib/pin-hash.ts), or NULL.
  pin TEXT,
  -- View limit, or NULL. The view count itself is still in KV.
  reads INTEGER,
  permanent INTEGER NOT NULL DEFAULT 0,
  -- Unix milliseconds.
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  deleted_at INTEGER,
  updated_at INTEGER NOT NULL
);

-- The dashboard list: one owner's live pages, newest first.
CREATE INDEX pages_owner_created ON pages (owner_id, created_at DESC, id DESC) WHERE owner_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX pages_owner_project_created ON pages (owner_id, project, created_at DESC, id DESC) WHERE owner_id IS NOT NULL AND deleted_at IS NULL;
-- Expiry sweeps and reports.
CREATE INDEX pages_expires ON pages (expires_at) WHERE deleted_at IS NULL AND expires_at IS NOT NULL;
