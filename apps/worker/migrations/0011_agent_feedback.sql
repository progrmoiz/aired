-- Agent feedback (lib/feedback.ts): what agents and people report through
-- the send_feedback MCP tool, `aired feedback` and POST /api/feedback. Never
-- page HTML, tokens or PINs. Read with scripts/feedback.mjs or
-- GET /api/admin/feedback.
CREATE TABLE agent_feedback (
  -- fb_ plus 10 random characters: the id the agent passes on to the user.
  id TEXT PRIMARY KEY,
  -- bug, friction or idea.
  kind TEXT NOT NULL,
  -- blocked, worked_around or minor. NULL: not given.
  impact TEXT,
  message TEXT NOT NULL,
  -- The page it's about, if any (an id, never its HTML).
  page_id TEXT,
  -- What was being used: a tool or command name, e.g. publish_html or aired set.
  tool TEXT,
  -- mcp, cli or api.
  source TEXT NOT NULL,
  -- The client, as it named itself (e.g. claude-code/2.1), capped at 100 characters.
  client TEXT,
  -- agent or person.
  actor TEXT NOT NULL,
  -- The signed-in account, or NULL when anonymous.
  user_id INTEGER,
  -- Truncated SHA-256 of the account id or the caller's IP, for the rate
  -- limit only. Not reversible to the IP.
  rate_key TEXT NOT NULL,
  -- Unix milliseconds.
  created_at INTEGER NOT NULL
);

CREATE INDEX agent_feedback_rate ON agent_feedback (rate_key, created_at);
CREATE INDEX agent_feedback_created ON agent_feedback (created_at DESC);
