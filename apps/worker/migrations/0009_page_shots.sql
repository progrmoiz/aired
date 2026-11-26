-- Dashboard tile screenshots (src/lib/og-render.ts, og-shot.ts). One row per
-- page that has been drawn, or tried: the HTML etag the images were taken
-- from, the tiny blurred placeholder the page list sends, and when the last
-- try started. lqip NULL means tried (or in progress) with no images yet.
-- Rows go with the page (DELETE /api/pages/:id, the expired sweep).
CREATE TABLE page_shots (
  id TEXT PRIMARY KEY,
  html_etag TEXT,
  -- data:image/jpeg;base64,… of a 24x16 JPEG, about 1 KB.
  lqip TEXT,
  -- Unix milliseconds.
  tried_at INTEGER NOT NULL
);
