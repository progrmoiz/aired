/**
 * View counts in D1 (migrations/0012_view_counts.sql): one row per page and
 * one per viewer country. A view costs one D1 write for the page (awaited, so
 * view limits hold) and one for the country (in the background), and no KV
 * writes.
 *
 * Pages viewed before this table have their count frozen in the KV record
 * (`readCount`). A page's first view here starts from that number, and until
 * then readers fall back to it (viewCountOf).
 *
 * No imports, so tests run the real SQL over node:sqlite.
 */

export type CountedView = { counted: true; count: number } | { counted: false };

/**
 * Count one view of a page, unless it has reached its view limit (`reads`).
 * `seed` is the KV record's readCount, used only when the page has no row yet.
 * Atomic: two views at the limit can't both get in.
 */
export async function countPageView(db: D1Database, id: string, seed: number, reads: number | null): Promise<CountedView> {
  const row = await db
    .prepare(
      `INSERT INTO page_views (page_id, count) SELECT ?, ? + 1 WHERE ? IS NULL OR ? < ?
       ON CONFLICT (page_id) DO UPDATE SET count = count + 1 WHERE ? IS NULL OR count < ?
       RETURNING count`,
    )
    .bind(id, seed, reads, seed, reads, reads, reads)
    .first<{ count: number }>();
  return row === null ? { counted: false } : { counted: true, count: row.count };
}

/** Add one view to the viewer's country total. */
export async function countCountryView(db: D1Database, country: string): Promise<void> {
  await db
    .prepare('INSERT INTO view_totals (country, count) VALUES (?, 1) ON CONFLICT (country) DO UPDATE SET count = count + 1')
    .bind(country)
    .run();
}

/** D1 caps bound parameters at 100 per query. */
const CHUNK = 100;

/** The D1 counts for these pages. Pages with no row are left out. */
export async function pageViewCounts(db: D1Database, ids: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    if (chunk.length === 0) continue;
    const { results } = await db
      .prepare(`SELECT page_id, count FROM page_views WHERE page_id IN (${chunk.map(() => '?').join(', ')})`)
      .bind(...chunk)
      .all<{ page_id: string; count: number }>();
    for (const r of results) out.set(r.page_id, r.count);
  }
  return out;
}

/** A page's views: its D1 count, or the count frozen in its KV record. */
export function viewCountOf(counts: ReadonlyMap<string, number>, id: string, kvCount: number): number {
  return counts.get(id) ?? kvCount;
}

/** Views per country counted in D1. */
export async function countryTotals(db: D1Database): Promise<Record<string, number>> {
  const { results } = await db.prepare('SELECT country, count FROM view_totals').all<{ country: string; count: number }>();
  const geo: Record<string, number> = {};
  for (const r of results) geo[r.country] = r.count;
  return geo;
}

/**
 * The public stats: the totals frozen in `stats:live` plus the views counted
 * in D1 since. Publishes still count in `stats:live`.
 */
export function mergeViewTotals<T extends { publishes: number; views: number; geo: Record<string, number> }>(
  frozen: T,
  d1Geo: Record<string, number>,
): { publishes: number; views: number; geo: Record<string, number> } {
  const geo: Record<string, number> = { ...frozen.geo };
  let views = frozen.views;
  for (const [country, n] of Object.entries(d1Geo)) {
    geo[country] = (geo[country] ?? 0) + n;
    views += n;
  }
  return { publishes: frozen.publishes, views, geo };
}
