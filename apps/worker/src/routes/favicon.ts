import { Hono } from 'hono';
import type { AppBindings } from '../types.js';
import { MISSING_TTL_MS, findIcon, iconHeaders, validIconHost, verifyIconSig, type Fetcher, type IconType } from '../lib/favicon.ts';

/**
 * GET /api/favicon/:host?s=<sig> — a referrer site's icon for Pro analytics
 * (lib/favicon.ts). Signed in, and only for hosts the caller's own report
 * signed. From R2 (`favicons/<host>`) when we have it; otherwise the Worker
 * fetches it once and stores it. A site without one gets a marker, and isn't
 * asked again for 7 days. Misses are rate-limited per account. Anything that
 * isn't an icon is a 404, and the dashboard shows its link icon instead.
 *
 * Only .ts imports (and types), so tests run it with app.request().
 */
const favicon = new Hono<AppBindings>();

const KEY = (host: string) => `favicons/${host}`;
const ALLOWED: ReadonlySet<string> = new Set(['image/svg+xml', 'image/png', 'image/x-icon', 'image/gif', 'image/webp']);

const none = () =>
  new Response(null, { status: 404, headers: { 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });

favicon.get('/:host', async (c) => {
  const user = c.get('user');
  if (user === null || user === undefined) return c.json({ error: 'Unauthorized' }, 401);
  const host = c.req.param('host');
  if (!validIconHost(host) || !(await verifyIconSig(c.env.SESSION_SECRET, host, c.req.query('s')))) return none();

  const stored = await c.env.PAGES_BUCKET.get(KEY(host)).catch(() => null);
  if (stored !== null) {
    const missingAt = Number(stored.customMetadata?.missing ?? '');
    const type = stored.httpMetadata?.contentType ?? '';
    if (Number.isFinite(missingAt) && missingAt > 0) {
      await stored.body?.cancel?.().catch?.(() => {});
      if (Date.now() - missingAt < MISSING_TTL_MS) return none();
    } else if (ALLOWED.has(type)) {
      return new Response(stored.body, { headers: iconHeaders(type as IconType) });
    }
  }

  // A miss: fetch it, at most FAVICON_BURST a minute per account.
  if (c.env.FAVICON_BURST) {
    try {
      const { success } = await c.env.FAVICON_BURST.limit({ key: String(user.id) });
      if (!success) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    } catch {
      // The limiter failing doesn't block the icon.
    }
  }
  const fetcher: Fetcher = (url, init) => fetch(url, init);
  const icon = await findIcon(fetcher, host);
  if (icon === null) {
    c.executionCtx.waitUntil(
      c.env.PAGES_BUCKET.put(KEY(host), new Uint8Array(), { customMetadata: { missing: String(Date.now()) } }).catch(() => {}),
    );
    return none();
  }
  c.executionCtx.waitUntil(
    c.env.PAGES_BUCKET.put(KEY(host), icon.bytes, { httpMetadata: { contentType: icon.type } }).catch((err) =>
      console.error({ event: 'favicon_store_failed', host, error: err instanceof Error ? err.message : String(err) }),
    ),
  );
  return new Response(icon.bytes, { headers: iconHeaders(icon.type) });
});

export { favicon };
