-- Browser time spent on link-preview screenshots (src/lib/og-render.ts). One
-- row ('browser'): today's total, reset when the UTC day changes, and when
-- Browser Rendering last said no (429) so nothing tries again until then.
CREATE TABLE og_shot_budget (
  name TEXT PRIMARY KEY,
  -- UTC day the total is for, YYYY-MM-DD.
  day TEXT NOT NULL,
  spent_ms INTEGER NOT NULL DEFAULT 0,
  -- Unix milliseconds; 0 when not blocked.
  blocked_until INTEGER NOT NULL DEFAULT 0
);
