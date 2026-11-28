/**
 * Clicks on the agent menu at the top of each guide and the docs (the
 * "Copy page" button: open in ChatGPT or Claude, install commands, the
 * Markdown copy). POST /api/site-event writes one Analytics Engine data
 * point per click (dataset `aired_site_events`, binding SITE_EVENTS):
 *
 *   index1  page (a guide's slug, or 'docs')
 *   blob1   page
 *   blob2   menu item
 *   blob3   UTC day, YYYY-MM-DD
 *   double1 1
 *
 * Nothing about the visitor: no IP, no cookie, no user id, no referrer.
 * GET /api/admin/site-events reads the totals back. Analytics Engine keeps
 * them three months.
 *
 * No imports, so tests load it directly.
 */

export const SITE_EVENTS_DATASET = 'aired_site_events';

export const SITE_EVENT_PAGES = [
  'html-to-link',
  'share-claude-artifacts',
  'share-chatgpt-html',
  'share-gemini-canvas',
  'publish-from-claude-code',
  'publish-from-cursor',
  'password-protect-html',
  'share-html-privately',
  'share-html-with-client',
  'share-slides',
  'share-vite-app',
  'tiiny-host-alternative',
  'docs',
] as const;

export const SITE_EVENT_ITEMS = [
  'copy_page',
  'open_markdown',
  'chatgpt',
  'claude',
  'claude_code',
  'codex',
  'cursor',
  'vscode',
  'windsurf',
  'claude_app',
  'chatgpt_app',
  'mcp_url', // the old "copy the server address" row, kept so earlier counts still read
] as const;

export type SiteEventPage = (typeof SITE_EVENT_PAGES)[number];
export type SiteEventItem = (typeof SITE_EVENT_ITEMS)[number];

export type SiteEventParse =
  | { ok: true; page: SiteEventPage; item: SiteEventItem }
  | { ok: false; error: string };

export function parseSiteEvent(body: unknown): SiteEventParse {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'Body must be a JSON object' };
  const { page, item } = body as { page?: unknown; item?: unknown };
  if (!(SITE_EVENT_PAGES as readonly unknown[]).includes(page)) return { ok: false, error: 'page must be a guide or docs' };
  if (!(SITE_EVENT_ITEMS as readonly unknown[]).includes(item)) return { ok: false, error: `item must be one of: ${SITE_EVENT_ITEMS.join(', ')}` };
  return { ok: true, page: page as SiteEventPage, item: item as SiteEventItem };
}

export type SiteEventPoint = { indexes: [string]; blobs: [string, string, string]; doubles: [number] };

export function siteEventPoint(page: SiteEventPage, item: SiteEventItem, nowMs: number): SiteEventPoint {
  return { indexes: [page], blobs: [page, item, new Date(nowMs).toISOString().slice(0, 10)], doubles: [1] };
}

/** Clicks per page and item over the last `days` days (1 to 90). */
export function siteEventQuery(days: number): string {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('days must be 1 to 90');
  return (
    `SELECT blob1 AS page, blob2 AS item, SUM(_sample_interval) AS clicks ` +
    `FROM ${SITE_EVENTS_DATASET} WHERE timestamp > NOW() - INTERVAL '${days}' DAY ` +
    `GROUP BY page, item ORDER BY clicks DESC FORMAT JSON`
  );
}
