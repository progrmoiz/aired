-- View counts (lib/view-counts.ts). A view used to rewrite the KV record
-- `page:<id>` with readCount + 1 and the global `stats:live` key; now it
-- adds one to a row here instead, and Analytics Engine keeps the details
-- Pro owners see (lib/view-event.ts).
--
-- page_views: a page's total views. No row yet: the total is still the
-- readCount frozen in its KV record, and the first view here starts from it.
CREATE TABLE page_views (
  page_id TEXT PRIMARY KEY,
  count INTEGER NOT NULL
);

-- view_totals: views on every page, per viewer country (CF-IPCountry), since
-- this table started. GET /api/stats adds these to the totals frozen in
-- `stats:live`.
CREATE TABLE view_totals (
  country TEXT PRIMARY KEY,
  count INTEGER NOT NULL
);
