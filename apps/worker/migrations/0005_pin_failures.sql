-- Wrong PIN entries per page, counted globally (D1 is one database, unlike
-- the per-location rate-limit bindings). Too many in one window locks PIN
-- entry on that page until the window ends (src/lib/pin-failures.ts).
CREATE TABLE pin_failures (
  page_id TEXT PRIMARY KEY,
  -- Unix milliseconds when the current window started.
  window_start INTEGER NOT NULL,
  failures INTEGER NOT NULL
);
