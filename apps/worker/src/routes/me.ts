import { Hono } from 'hono';
import type { AppBindings } from '../types.js';
import {
  kvKeys,
  verifyToken,
  generateToken,
  hashToken,
  parseMetadata,
  redactNoreplyEmail,
  normalizeProject,
  UNSORTED_PROJECT,
} from '@aired/core';
import type { PageMetadata } from '@aired/core';
import { requireAuth, requireWebSession } from '../middleware/auth.js';
import { revokeAllSessions } from '../lib/revocation.js';
import { requireCsrfHeader } from '../middleware/csrf.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { TIERS } from '../lib/rate-limit-tiers.js';
import { clearSessionCookie, readSessionCookie, readWorkosSessionCookie, clearWorkosSessionCookie } from '../lib/cookies.js';
import { billingEnabled, getEntitlements, isEntitled } from '../lib/entitlements.js';
import { getCustomerId, getSubscription } from '../lib/billing/store.js';
import { blocksAccountDeletion, deleteAccountRows } from '../lib/billing/forget.js';
import { identityEmails } from '../lib/users.js';
import { revokeMcpGrants } from './mcp-oauth.js';
import { workosEnabled, workosLogoutUrl } from '../lib/workos.js';
import { listActiveSubscriptions } from '../lib/billing/stripe.js';
import { isMissingCustomer } from '../lib/billing/stripe-shapes.js';
import type { StoredSubscription } from '../lib/billing/store.js';
import { AUTH_HEADER } from '@aired/core';
import { addClaimResult, runClaim } from '../lib/claim-decision.js';
import type { ClaimBatchResult } from '../lib/claim-decision.js';
import { PREVIEW_HEADERS, previewDecision } from '../lib/page-preview.js';
import { readShotRows, renderShots, type ShotJob } from '../lib/og-render.js';
import { BACKFILL_MAX, SHOT_CONTENT_TYPE, needsBackfill, renderAllowed, tileCacheControl, tileInfo, tileKey, versionFromEtag } from '../lib/og-shot.js';
import { DELETED_TOKEN_HASH, claimedPageIds, releaseClaimsStatement } from '../lib/page-claims.ts';
import type { ClaimRecord } from '../lib/claim-decision.js';
import {
  claimPageRow,
  getPageRow,
  listOwnerPages,
  listOwnerProjects,
  metadataFromRow,
  releaseOwnerPage,
  releaseOwnerPagesStatement,
  releasedRows,
  replacePageToken,
  resolvePage,
  type PageRow,
  type ProjectFilter,
} from '../lib/pages-store.ts';
import { loadPage, refreshCache, type LoadedPage } from '../lib/page-write.ts';
import { pageViewCounts, viewCountOf } from '../lib/view-counts.ts';

const me = new Hono<AppBindings>();

// All /api/me routes require authentication
me.use('*', requireAuth);

// GET /api/me — return current user profile
me.get('/', async (c) => {
  const user = c.get('user')!;

  // createdAt is not embedded in the JWT; read it from KV (single read fallback)
  let createdAt: string | null = null;
  try {
    const raw = await c.env.PAGES_KV.get(kvKeys.user(user.id));
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        typeof (parsed as Record<string, unknown>)['createdAt'] === 'string'
      ) {
        createdAt = (parsed as Record<string, unknown>)['createdAt'] as string;
      }
    }
  } catch {
    // best-effort — createdAt may be null in response
  }

  // Plan from KV (getEntitlements); billing details from D1, read only when billing is on.
  const [ent, sub] = await Promise.all([
    getEntitlements(c.env, user.id),
    billingEnabled(c.env) ? readSubscription(c.env.DB, user.id) : Promise.resolve(null),
  ]);

  return c.json({
    id: user.id,
    login: user.login,
    email: redactNoreplyEmail(user.email),
    name: user.name,
    createdAt,
    plan: ent.plan,
    limits: { maxBytes: ent.maxBytes, publishTier: ent.publishTier },
    billing: sub
      ? {
          status: sub.status,
          interval: sub.interval,
          renewsAt: sub.currentPeriodEnd,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        }
      : null,
  });
});

// Best-effort: a D1 failure shows billing as null instead of failing /api/me,
// which the dashboard needs to load at all.
async function readSubscription(db: D1Database, uid: number): Promise<StoredSubscription | null> {
  try {
    return await getSubscription(db, uid);
  } catch (err) {
    console.error({ event: 'me_billing_read_failed', uid, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// GET /api/me/pages — list pages owned by the authenticated user, from D1
// `pages` (lib/pages-store.ts), newest first.
// Optional ?project=<name> filters to one project; ?project=__unsorted__ lists
// pages with no project (including old records published before tagging existed).
me.get('/pages', async (c) => {
  const user = c.get('user')!;
  const ownerId = user.id;

  const rawLimit = parseInt(c.req.query('limit') ?? '20', 10);
  const limit = Math.min(isNaN(rawLimit) || rawLimit <= 0 ? 20 : rawLimit, 50);
  const cursor = c.req.query('cursor') || undefined;
  const projectFilter = c.req.query('project') || undefined;

  let filter: ProjectFilter = { kind: 'all' };
  if (projectFilter !== undefined && projectFilter !== UNSORTED_PROJECT) {
    // Match the read filter to the write-time normalization. A query that can't
    // normalize to a stored value (empty, whitespace, >64 chars) matches nothing.
    const normalized = normalizeProject(projectFilter);
    if (normalized === null) {
      return c.json({ pages: [], cursor: null });
    }
    filter = { kind: 'project', name: normalized };
  } else if (projectFilter === UNSORTED_PROJECT) {
    filter = { kind: 'unsorted' };
  }

  let listed: { rows: PageRow[]; cursor: string | null };
  try {
    listed = await listOwnerPages(c.env.DB, ownerId, filter, cursor, limit, Date.now());
  } catch (err) {
    console.error('pages list failed', { ownerId, err });
    return c.json({ error: 'Could not load your pages. Please try again.' }, 503);
  }

  // View counts: D1 page_views (lib/view-counts.ts), falling back to the count
  // frozen in the KV record for a page not viewed since. Best-effort: a page
  // whose count can't be read shows 0.
  const readCounts = new Map<string, number>();
  if (listed.rows.length > 0) {
    const ids = listed.rows.map((r) => r.id);
    const [kvCounts, d1Counts] = await Promise.all([
      c.env.PAGES_KV.get(ids.map((id) => kvKeys.page(id))).catch((err) => {
        console.error('view counts lookup failed while listing pages', { ownerId, err });
        return null;
      }),
      pageViewCounts(c.env.DB, ids).catch((err) => {
        console.error('page_views lookup failed while listing pages', { ownerId, err });
        return new Map<string, number>();
      }),
    ]);
    for (const id of ids) {
      const raw = kvCounts?.get(kvKeys.page(id));
      const m = raw === null || raw === undefined ? null : parseMetadata(raw);
      readCounts.set(id, viewCountOf(d1Counts, id, m?.readCount ?? 0));
    }
  }

  // Project only safe public fields — never leak tokenHash or pin to clients.
  const pages: Array<{
    id: string;
    title: string | null;
    size: number;
    readCount: number;
    reads: number | null;
    permanent: boolean;
    createdAt: string;
    expiresAt: string | null;
    hasPin: boolean;
    /** Who can open it (lib/page-options.ts accessMode). */
    access: "public" | "pin" | "people";
    ownerId: number | null;
    project: string | null;
    /** The dashboard tile's version and blurred placeholder (lib/og-shot.ts), or null. */
    tile: { v: string; lqip: string } | null;
  }> = listed.rows.map((r) => {
    const m = metadataFromRow(r, readCounts.get(r.id) ?? 0);
    return {
      id: m.id,
      title: m.title,
      size: m.size,
      readCount: m.readCount,
      reads: m.reads,
      permanent: m.permanent,
      createdAt: m.createdAt,
      expiresAt: m.expiresAt,
      hasPin: m.pin !== null,
      access: m.access === "people" ? "people" : m.pin !== null ? "pin" : "public",
      ownerId: m.ownerId,
      project: m.project,
      tile: null,
    };
  });

  // Tiles: one D1 read for the whole list. Best-effort: on an error the
  // dashboard falls back to live previews.
  if (pages.length > 0) {
    try {
      const rows = await readShotRows(c.env.DB, pages.map((p) => p.id));
      for (const p of pages) p.tile = tileInfo(rows.get(p.id));
    } catch (err) {
      console.error('page_shots lookup failed while listing pages', { ownerId, err });
    }
  }

  return c.json({ pages, cursor: listed.cursor });
});

// GET /api/me/projects — distinct projects for the authenticated user, with counts.
// GET /api/me/pages/:id/preview — the owner's page HTML for a dashboard
// preview, as text/plain (lib/page-preview.ts). Doesn't count a view, ask for
// the PIN or apply the view limit. 404 for anyone else; 204 when too big.
me.get('/pages/:id/preview', async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  const page = await livePage(c.env, id);
  const decision = previewDecision(page === null ? null : pageFacts(page), user.id, false, Date.now());
  if (!decision.ok) {
    return decision.status === 204 ? new Response(null, { status: 204, headers: PREVIEW_HEADERS }) : c.json({ error: 'Page not found' }, 404);
  }
  const obj = await c.env.PAGES_BUCKET.get(`pages/${id}/index.html`);
  if (obj === null) return c.json({ error: 'Page not found' }, 404);
  return new Response(await obj.text(), { status: 200, headers: PREVIEW_HEADERS });
});

/** A live page, or null: missing, expired, deleted, or D1 unreadable (logged). */
async function livePage(env: AppBindings['Bindings'], id: string): Promise<LoadedPage | null> {
  try {
    return await loadPage(env, id);
  } catch (err) {
    console.error('pages lookup failed for an owner route', { id, err });
    return null;
  }
}

/** The page's facts for preview and screenshot rules: the D1 row's owner, the KV record's PIN. */
function pageFacts(page: LoadedPage): PageMetadata {
  return { ...metadataFromRow(page.row, page.kv?.readCount ?? 0), pin: page.kv?.pin ?? page.row.pin };
}

/**
 * The owner's live page record, or null: missing, someone else's, or expired
 * (the same rule as the preview route, via previewDecision).
 */
async function ownedPage(c: { env: AppBindings['Bindings'] }, userId: number, id: string): Promise<PageMetadata | null> {
  const page = await livePage(c.env, id);
  if (page === null) return null;
  const facts = pageFacts(page);
  // A page too big to preview (204) has no tile either.
  return previewDecision(facts, userId, false, Date.now()).ok ? facts : null;
}

// GET /api/me/pages/:id/tile — the owner's dashboard tile, a 1200×800 JPEG
// of the page (lib/og-shot.ts). PIN and view-limited pages have one too:
// only their owner can fetch it, and it's never served at /og/:id. 404 for
// anyone else. Asked for by its version (?v=), it's cached for good.
me.get('/pages/:id/tile', async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  if ((await ownedPage(c, user.id, id)) === null) return c.json({ error: 'Page not found' }, 404);
  const obj = await c.env.PAGES_BUCKET.get(tileKey(id));
  if (obj === null) return c.json({ error: 'Page not found' }, 404);
  const version = obj.customMetadata?.html ? versionFromEtag(obj.customMetadata.html) : null;
  const asked = c.req.query('v');
  return new Response(obj.body, {
    headers: {
      'Content-Type': SHOT_CONTENT_TYPE,
      'Cache-Control': tileCacheControl(asked !== undefined && asked === version),
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
});

// POST /api/me/pages/shots — draw tiles for the owner's pages that have none
// yet (pages from before screenshots, or that missed the budget). The
// dashboard sends the ids it's showing; up to BACKFILL_MAX are drawn in one
// browser, inside the daily budget, and a page that was tried in the last
// day is skipped. Answers with the new tiles, for the dashboard to swap in.
me.post('/pages/shots', requireCsrfHeader, async (c) => {
  const user = c.get('user')!;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const rawIds = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(rawIds)) return c.json({ error: 'ids must be an array' }, 400);
  const ids = [...new Set(rawIds.filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x)))].slice(0, 20);
  if (ids.length === 0) return c.json({ tiles: {} });

  const now = Date.now();
  const rows = await readShotRows(c.env.DB, ids);
  const wanted = ids.filter((id) => needsBackfill(rows.get(id), now));
  const jobs: ShotJob[] = [];
  for (const id of wanted) {
    if (jobs.length >= BACKFILL_MAX) break;
    const metadata = await ownedPage(c, user.id, id);
    if (metadata === null || !renderAllowed(metadata, now)) continue;
    const obj = await c.env.PAGES_BUCKET.get(`pages/${id}/index.html`);
    if (obj === null) continue;
    jobs.push({ id, page: metadata, html: await obj.text(), htmlEtag: obj.etag });
  }
  const done = await renderShots(c.env, jobs);
  const after = done.length > 0 ? await readShotRows(c.env.DB, done) : new Map();
  const tiles: Record<string, { v: string; lqip: string } | null> = {};
  for (const id of done) tiles[id] = tileInfo(after.get(id));
  return c.json({ tiles });
});

me.get('/projects', async (c) => {
  const user = c.get('user')!;
  try {
    return c.json({ projects: await listOwnerProjects(c.env.DB, user.id, Date.now()) });
  } catch (err) {
    console.error('projects list failed', { ownerId: user.id, err });
    return c.json({ error: 'Could not load your projects. Please try again.' }, 503);
  }
});

// POST /api/me/claim — claim a single page by id + update_token.
// Shares the claim-batch bucket (rl:claim, 5/hour per user).
// A first claim (or a retry of it) returns the page's new update_token, and
// the one sent here stops working. See lib/claim-decision.ts.
me.post('/claim', requireCsrfHeader, rateLimit(TIERS.claim_batch), async (c) => {
  const user = c.get('user')!;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return c.json({ error: 'Request body must be a JSON object' }, 400);
  }

  const req = body as Record<string, unknown>;
  const { id, update_token } = req;

  if (typeof id !== 'string') {
    return c.json({ error: 'id is required' }, 400);
  }
  if (typeof update_token !== 'string') {
    return c.json({ error: 'update_token is required' }, 400);
  }

  return claimPage(c.env, user.id, id, update_token);
});

// POST /api/me/claim-batch — claim multiple pages
me.post(
  '/claim-batch',
  requireCsrfHeader,
  rateLimit(TIERS.claim_batch),
  async (c) => {
    const user = c.get('user')!;

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return c.json({ error: 'Request body must be a JSON object' }, 400);
    }

    const req = body as Record<string, unknown>;
    const { items } = req;

    if (!Array.isArray(items)) {
      return c.json({ error: 'items must be an array' }, 400);
    }

    if (items.length > 100) {
      return c.json({ error: 'Too many items. Maximum is 100.' }, 400);
    }

    const result: ClaimBatchResult = { claimed: [], failed: [], tokens: {} };

    for (const item of items) {
      if (
        typeof item !== 'object' ||
        item === null ||
        Array.isArray(item)
      ) {
        result.failed.push({ id: String((item as Record<string, unknown>)?.['id'] ?? ''), reason: 'claim failed' });
        continue;
      }

      const { id, update_token } = item as Record<string, unknown>;

      if (typeof id !== 'string' || typeof update_token !== 'string') {
        result.failed.push({ id: typeof id === 'string' ? id : '', reason: 'claim failed' });
        continue;
      }

      try {
        const response = await claimPage(c.env, user.id, id, update_token);
        addClaimResult(result, id, await response.json<{ ok?: boolean; update_token?: unknown }>());
      } catch {
        addClaimResult(result, id, {});
      }
    }

    return c.json(result);
  },
);

// POST /api/me/sign-out-everywhere — end every session of this account:
// other browsers, CLI tokens and MCP connections. API keys keep working
// (they're listed and revoked one by one under API keys). Website only.
me.post('/sign-out-everywhere', requireWebSession, requireCsrfHeader, async (c) => {
  const userId = c.get('user')!.id;
  try {
    await revokeAllSessions(c.env.PAGES_KV, userId);
  } catch (err) {
    console.error('Failed to sign out everywhere:', err);
    return c.json({ error: 'Could not sign out everywhere. Please try again.' }, 503);
  }
  clearSessionCookie(c);
  // End this browser's AuthKit session too, as sign-out does.
  const workosSession = readWorkosSessionCookie(c);
  if (workosSession !== null) clearWorkosSessionCookie(c);
  return c.json(
    workosSession !== null && workosEnabled(c.env)
      ? { ok: true, redirect: workosLogoutUrl(c.env, workosSession) }
      : { ok: true },
  );
});

// DELETE /api/me — delete the authenticated user's account
me.delete('/', requireWebSession, requireCsrfHeader, async (c) => {
  const user = c.get('user')!;
  const userId = user.id;
  const jti = c.get('jti');

  // A live Pro subscription would keep charging after the account is gone,
  // so it has to be cancelled first (Manage billing → cancel).
  if (billingEnabled(c.env)) {
    let sub: StoredSubscription | null;
    try {
      sub = await getSubscription(c.env.DB, userId);
    } catch {
      return c.json({ error: 'Could not check your subscription. Please try again.' }, 503);
    }
    const blocked = c.json(
      { error: 'Cancel Pro in Manage billing before deleting your account.', code: 'subscription_active' },
      409,
    );
    if (sub !== null && !sub.cancelAtPeriodEnd && isEntitled(sub, new Date())) return blocked;
    // D1 can lag Stripe: a new purchase or a "renew" in the portal whose
    // webhook hasn't landed yet would slip through, and the delete below
    // removes our only link to the customer. Whenever we know a customer, ask
    // Stripe. A customer Stripe no longer has holds no subscriptions.
    try {
      const customerId = sub?.customerId ?? (await getCustomerId(c.env.DB, userId));
      if (customerId !== null) {
        let live: Awaited<ReturnType<typeof listActiveSubscriptions>> = [];
        try {
          live = await listActiveSubscriptions(c.env, customerId);
        } catch (err) {
          if (!isMissingCustomer(err)) throw err;
        }
        if (blocksAccountDeletion(live)) return blocked;
      }
    } catch {
      return c.json({ error: 'Could not check your subscription. Please try again.' }, 503);
    }
  }

  // Billing, sign-in and API key rows in D1 go before anything else, so a
  // failure can be retried with the account intact (and no key outlives the
  // account). Link (Stripe) keeps its own record of each sale.
  // The emails this account signed in with, read before its identities go:
  // their email index entries go too (below) if they still point here.
  let linkedEmails: string[] = [];
  try {
    linkedEmails = await identityEmails(c.env.DB, userId);
  } catch (err) {
    console.error('Failed to read identity emails during account deletion:', err);
  }
  // Every other session (other browsers, CLI tokens) and MCP connection of
  // this account stops working, not just the one making this request. First,
  // and fail closed: without the marker those sessions would outlive the
  // account. Writing it again on a retry is harmless.
  try {
    await revokeAllSessions(c.env.PAGES_KV, userId);
  } catch (err) {
    console.error('Failed to set the revocation marker during account deletion:', err);
    return c.json({ error: 'Could not delete your account. Please try again.' }, 503);
  }
  // The account's pages become anonymous pages in D1 (the source of truth)
  // in the same batch as the account rows: both commit or neither, so a
  // failure leaves the account and its pages as they were, to retry. Their
  // KV records follow after the response.
  let releasedPages: PageRow[];
  // Old pages with no `pages` row yet, released in page_claims in the same batch.
  let claimIds: string[];
  try {
    const now = Date.now();
    const [released, claims] = await deleteAccountRows(c.env.DB, userId, [
      releaseOwnerPagesStatement(c.env.DB, userId, now),
      releaseClaimsStatement(c.env.DB, userId),
    ]);
    releasedPages = releasedRows(released, now);
    claimIds = claimedPageIds(claims);
  } catch (err) {
    console.error('Failed to delete account rows during account deletion:', err);
    // The marker above already ended every session, this one included.
    clearSessionCookie(c);
    return c.json({ error: 'Could not delete your account records. Sign in again and retry.' }, 503);
  }
  try {
    await c.env.PAGES_KV.delete(`ent:${userId}`);
  } catch (err) {
    console.error('Failed to delete entitlement during account deletion:', err);
  }

  // Step 1: Revoke current JWT by writing revoked_jti to KV
  if (jti !== null) {
    try {
      // Determine exp from the raw token
      const cookieToken = readSessionCookie(c);
      const headerToken = c.req.header(AUTH_HEADER) ?? null;
      const rawToken = cookieToken ?? headerToken;

      let expTtl: number | null = null;
      if (rawToken) {
        try {
          const parts = rawToken.split('.');
          if (parts.length === 3 && parts[1] !== undefined) {
            const payload: unknown = JSON.parse(atob(parts[1]));
            if (
              typeof payload === 'object' &&
              payload !== null &&
              typeof (payload as Record<string, unknown>)['exp'] === 'number'
            ) {
              const exp = (payload as Record<string, unknown>)['exp'] as number;
              const now = Math.floor(Date.now() / 1000);
              expTtl = exp - now;
            }
          }
        } catch {
          // ignore decode errors
        }
      }

      if (expTtl !== null && expTtl > 0) {
        await c.env.PAGES_KV.put(kvKeys.revokedJti(jti), '1', {
          expirationTtl: expTtl,
        });
      } else {
        // Best-effort — write with a 30-day TTL as fallback
        await c.env.PAGES_KV.put(kvKeys.revokedJti(jti), '1', {
          expirationTtl: 30 * 24 * 60 * 60,
        });
      }
    } catch (err) {
      console.error('Failed to revoke jti on account deletion:', err);
    }
  }

  // MCP connections the account approved stop working with it.
  try {
    await revokeMcpGrants(c.env, userId);
  } catch (err) {
    console.error('Failed to revoke MCP grants during account deletion:', err);
  }

  // Step 2: Delete user record and email index entries. An entry is deleted
  // only while it points at this account: another account may hold it now.
  try {
    const userRaw = await c.env.PAGES_KV.get(kvKeys.user(userId));
    await c.env.PAGES_KV.delete(kvKeys.user(userId));

    const emails = new Set(linkedEmails);
    if (userRaw !== null) {
      try {
        const userRecord: unknown = JSON.parse(userRaw);
        if (
          typeof userRecord === 'object' &&
          userRecord !== null &&
          typeof (userRecord as Record<string, unknown>)['email'] === 'string'
        ) {
          emails.add(((userRecord as Record<string, unknown>)['email'] as string).toLowerCase());
        }
      } catch {
        // ignore parse errors
      }
    }
    for (const email of emails) {
      if ((await c.env.PAGES_KV.get(kvKeys.emailIndex(email))) === String(userId)) {
        await c.env.PAGES_KV.delete(kvKeys.emailIndex(email));
      }
    }
  } catch (err) {
    console.error('Failed to delete user record:', err);
  }

  // Step 3: Clear session cookie, and end the AuthKit session too (as sign-out
  // does), or the next Log in in this browser signs straight back in.
  clearSessionCookie(c);
  const workosSession = readWorkosSessionCookie(c);
  if (workosSession !== null) clearWorkosSessionCookie(c);

  // Step 4: Return immediately
  const response = c.json(
    workosSession !== null && workosEnabled(c.env)
      ? { ok: true, redirect: workosLogoutUrl(c.env, workosSession) }
      : { ok: true },
  );

  // Step 5: waitUntil — bring the released pages' KV records in line, and
  // delete this account's keys in the retired KV owner and project indexes.
  c.executionCtx.waitUntil(
    (async () => {
      const kv = c.env.PAGES_KV;
      const now = Date.now();
      const done = new Set<string>();
      for (const row of releasedPages) {
        done.add(row.id);
        await refreshCache(kv, row, now);
      }

      // Pages from before D1 `pages` that have no row yet are found the old
      // way: page_claims (released in the batch above) and the KV owner
      // index. Each gets its row, is released there, and its KV record
      // follows.
      const releaseLegacy = async (pageId: string) => {
        if (done.has(pageId)) return;
        done.add(pageId);
        try {
          const raw = await kv.get(kvKeys.page(pageId));
          const row = await resolvePage(c.env.DB, pageId, raw === null ? null : parseMetadata(raw), now);
          if (row === null) return;
          if (row.ownerId === userId) await releaseOwnerPage(c.env.DB, pageId, userId, now);
          await refreshCache(kv, { ...row, ownerId: row.ownerId === userId ? null : row.ownerId }, now);
        } catch (err) {
          console.error('Failed to release a page during account deletion:', { pageId, err });
        }
      };
      for (const pageId of claimIds) await releaseLegacy(pageId);

      for (const prefix of [kvKeys.pagesByOwnerPrefix(userId), kvKeys.pagesByOwnerProjectOwnerPrefix(userId)]) {
        let cursor: string | undefined = undefined;
        while (true) {
          let list: KVNamespaceListResult<unknown, string>;
          try {
            list = await kv.list({ prefix, limit: 50, ...(cursor ? { cursor } : {}) });
          } catch (err) {
            console.error('Failed to list an owner index during account deletion sweep:', err);
            break;
          }
          for (const entry of list.keys) {
            const pageId = entry.name.split(':').pop();
            if (pageId !== undefined && prefix === kvKeys.pagesByOwnerPrefix(userId)) await releaseLegacy(pageId);
            try {
              await kv.delete(entry.name);
            } catch (err) {
              console.error('Failed to delete an owner index entry during deletion sweep:', { key: entry.name, err });
            }
          }
          if (list.list_complete) break;
          cursor = list.cursor ?? undefined;
        }
      }

      // Finally, drop the project manifest (also retired).
      try {
        await kv.delete(kvKeys.projectsByOwner(userId));
      } catch (err) {
        console.error('Failed to delete project manifest during deletion sweep:', err);
      }
    })(),
  );

  return response;
});

/**
 * Internal helper: claim a single page for a user.
 * Returns a Hono Response. Both claim and claim-batch call this.
 *
 * The page's D1 row decides who owns it and which token works
 * (lib/claim-decision.ts, lib/pages-store.ts). The KV record is updated
 * after it, best-effort.
 */
async function claimPage(
  env: { PAGES_KV: KVNamespace; PAGES_BUCKET: R2Bucket; DB: D1Database },
  userId: number,
  pageId: string,
  updateToken: string,
): Promise<Response> {
  const denied = () => Response.json({ error: 'claim failed' }, { status: 403 });

  let page: LoadedPage | null;
  try {
    page = await loadPage(env, pageId);
  } catch (err) {
    console.error('pages lookup failed during claim', { pageId, err });
    return Response.json({ error: 'Could not claim this page. Please try again.' }, { status: 503 });
  }
  if (page === null) return denied();
  const { row } = page;

  // The row as a claim record; a deleted or vanished row matches nothing.
  const currentClaim = async (): Promise<ClaimRecord> => {
    const r = await getPageRow(env.DB, pageId);
    if (r === null || r.deletedAt !== null) {
      return { ownerId: r?.ownerId ?? null, tokenHash: DELETED_TOKEN_HASH, prevTokenHash: DELETED_TOKEN_HASH, claimedAt: 0 };
    }
    return { ownerId: r.ownerId, tokenHash: r.tokenHash, prevTokenHash: r.prevTokenHash ?? DELETED_TOKEN_HASH, claimedAt: r.claimedAt ?? 0 };
  };

  const outcome = await runClaim(
    { kvOwnerId: row.ownerId, kvTokenHash: row.tokenHash, userId, now: Date.now() },
    {
      getClaim: currentClaim,
      upsertClaim: (record, checkedHash) => claimPageRow(env.DB, pageId, record, checkedHash),
      replaceClaimToken: (hash) => replacePageToken(env.DB, pageId, userId, hash, Date.now()),
      newToken: generateToken,
      hash: hashToken,
      matches: (hash) => verifyToken(updateToken, hash),
      // D1 already holds the claim, so failures here can't revive the old token.
      mirrorToKv: async () => {
        try {
          const claimed = await getPageRow(env.DB, pageId);
          if (claimed === null) return;
          await refreshCache(env.PAGES_KV, claimed);
        } catch (err) {
          console.error('cache refresh failed during claim', { pageId, userId, err });
        }
      },
    },
  );

  if (!outcome.ok) return denied();
  return Response.json({
    ok: true,
    page: {
      id: row.id,
      title: row.title,
      createdAt: new Date(row.createdAt).toISOString(),
      expiresAt: row.expiresAt === null ? null : new Date(row.expiresAt).toISOString(),
    },
    ...(outcome.token !== null ? { update_token: outcome.token } : {}),
  });
}

export { me };
