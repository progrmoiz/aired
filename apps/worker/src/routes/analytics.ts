import { Hono, type Context } from 'hono';
import type { AppBindings } from '../types.js';
import { getEntitlements, planLimitError } from '../lib/entitlements.ts';
import { siteOrigin } from '../lib/origin.ts';
import { getPageRow } from '../lib/pages-store.ts';
import { iconUrls } from '../lib/favicon.ts';
import { MAX_DAYS, analyticsConfig, demoReport, loadReport, parseOffset, parseRange, type Report, type Scope, type Window } from '../lib/analytics.ts';

/**
 * /api/me/analytics: Pro analytics from Analytics Engine (lib/analytics.ts).
 *
 *   GET /api/me/analytics?range=7|30|90&offset=N            all the caller's pages
 *   GET /api/me/analytics/pages/:id?range=7|30|90&offset=N  one page they own
 *
 * `offset` steps back whole windows (0, the default, ends today), as far as
 * Analytics Engine keeps data.
 *
 * Signed out: 401. Free: 402 plan_limit with an upgrade link. Someone
 * else's page or a deleted one: 404. No token set up: 503. Answers are
 * cached for five minutes per scope and window.
 *
 * Only .ts imports (and types), so tests run it with app.request().
 */
const analytics = new Hono<AppBindings>();

const CACHE_SECONDS = 300;

/** Signed in (as requireAuth does), then Pro or a 402, before anything else is looked at. */
analytics.use('*', async (c, next): Promise<Response | void> => {
  const user = c.get('user');
  if (user === null || user === undefined) return c.json({ error: 'Unauthorized' }, 401);
  const ent = await getEntitlements(c.env, user.id);
  if (ent.plan !== 'pro') {
    return c.json(planLimitError('analytics', siteOrigin(c.env), 'analytics'), 402);
  }
  await next();
});

analytics.get('/', async (c) => {
  const w = windowOf(c);
  if (w instanceof Response) return w;
  const ownerId = c.get('user')!.id;
  const report = await answer(c, { kind: 'owner', ownerId }, w);
  if (report instanceof Response) return report;
  // Top pages get their titles, and pages no longer theirs are left out.
  const ids = (report.pages ?? []).map((p) => p.id);
  let titles = new Map<string, string | null>();
  if (ids.length > 0) {
    try {
      const { results } = await c.env.DB.prepare(
        `SELECT id, title FROM pages WHERE owner_id = ? AND deleted_at IS NULL AND id IN (${ids.map(() => '?').join(', ')})`,
      )
        .bind(ownerId, ...ids)
        .all<{ id: string; title: string | null }>();
      titles = new Map(results.map((r) => [r.id, r.title]));
    } catch (err) {
      console.error({ event: 'analytics_titles_failed', ownerId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return c.json({
    ...report,
    icons: await icons(c, report),
    pages: (report.pages ?? []).filter((p) => titles.has(p.id)).map((p) => ({ ...p, title: titles.get(p.id) ?? null })),
  });
});

analytics.get('/pages/:id', async (c) => {
  const w = windowOf(c);
  if (w instanceof Response) return w;
  const id = c.req.param('id');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return c.json({ error: 'Page not found' }, 404);
  let row;
  try {
    row = await getPageRow(c.env.DB, id);
  } catch (err) {
    console.error({ event: 'analytics_page_lookup_failed', id, error: err instanceof Error ? err.message : String(err) });
    return c.json({ error: 'Could not load this page. Please try again.' }, 503);
  }
  // Expired pages keep their numbers; deleted ones and other people's are 404.
  if (row === null || row.deletedAt !== null || row.ownerId !== c.get('user')!.id) {
    return c.json({ error: 'Page not found' }, 404);
  }
  const report = await answer(c, { kind: 'page', id }, w);
  if (report instanceof Response) return report;
  return c.json({ ...report, icons: await icons(c, report), page: { id: row.id, title: row.title } });
});

type Ctx = Context<AppBindings>;

/** The report from the cache, demo data, or Analytics Engine; or an error response. */
/**
 * Signed /api/favicon URLs for the report's referrer hosts (lib/favicon.ts):
 * only hosts in the caller's own report can have their icon fetched.
 */
function icons(c: Ctx, report: Report): Promise<Record<string, string>> {
  return iconUrls(c.env.SESSION_SECRET, [...report.referrers.map((r) => r.host), report.peak?.host ?? '']);
}

/** The window from ?range and ?offset, or a 400. */
function windowOf(c: Ctx): Window | Response {
  const range = parseRange(c.req.query('range'));
  if (range === null) return c.json({ error: 'range must be 7, 30 or 90' }, 400);
  const offset = parseOffset(c.req.query('offset'), range);
  if (offset === null) return c.json({ error: `offset must be a whole number, within the last ${MAX_DAYS} days` }, 400);
  return { range, offset };
}

async function answer(c: Ctx, scope: Scope, w: Window): Promise<Report | Response> {
  c.header('Cache-Control', 'private, no-store');
  const now = Date.now();
  if (c.env.ANALYTICS_DEMO === '1') {
    let ids: string[] = [];
    if (scope.kind === 'owner') {
      const { results } = await c.env.DB.prepare(
        'SELECT id FROM pages WHERE owner_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20',
      )
        .bind(scope.ownerId)
        .all<{ id: string }>();
      ids = results.map((r) => r.id);
    }
    return demoReport(scope, w, now, ids);
  }
  const config = analyticsConfig(c.env);
  if (config === null) {
    return c.json({ error: 'Analytics is not set up yet.', code: 'analytics_unavailable' }, 503);
  }

  const cacheKey = new Request(
    `https://analytics.aired.internal/${scope.kind === 'page' ? `page/${scope.id}` : `owner/${scope.ownerId}`}?range=${w.range}&offset=${w.offset}`,
  );
  const cache = typeof caches === 'undefined' ? null : caches.default;
  const hit = await cache?.match(cacheKey).catch(() => undefined);
  if (hit) return (await hit.json()) as Report;

  let report: Report;
  try {
    report = await loadReport((url, init) => fetch(url, init), config, scope, w, now);
  } catch (err) {
    console.error({ event: 'analytics_query_failed', scope: scope.kind, error: err instanceof Error ? err.message : String(err) });
    return c.json({ error: 'Could not load the numbers. Please try again.' }, 503);
  }
  if (cache !== null) {
    const stored = new Response(JSON.stringify(report), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_SECONDS}` },
    });
    c.executionCtx.waitUntil(cache.put(cacheKey, stored).catch(() => {}));
  }
  return report;
}

export { analytics };
