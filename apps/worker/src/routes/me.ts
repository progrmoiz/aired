import { Hono } from 'hono';
import type { AppBindings } from '../types.js';
import {
  kvKeys,
  verifyToken,
  generateToken,
  hashToken,
  parseMetadata,
  serializeMetadata,
  redactNoreplyEmail,
  normalizeProject,
  UNSORTED_PROJECT,
} from '@aired/core';
import type { PageMetadata } from '@aired/core';
import { requireAuth } from '../middleware/auth.js';
import { requireCsrfHeader } from '../middleware/csrf.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { TIERS } from '../lib/rate-limit-tiers.js';
import {
  addPageToOwner,
  listPagesForOwner,
  removePageFromOwner,
  addPageToOwnerProject,
  listPagesForOwnerProject,
  listProjectsForOwner,
  bumpProjectCount,
} from '../lib/owner-index.js';
import { clearSessionCookie, readSessionCookie } from '../lib/cookies.js';
import { billingEnabled, getEntitlements, isEntitled } from '../lib/entitlements.js';
import { getSubscription } from '../lib/billing/store.js';
import type { StoredSubscription } from '../lib/billing/store.js';
import { AUTH_HEADER } from '@aired/core';
import { addClaimResult, runClaim } from '../lib/claim-decision.js';
import type { ClaimBatchResult } from '../lib/claim-decision.js';
import { claimedIds, getClaim, releaseClaimsForOwner, replaceClaimToken, upsertClaim } from '../lib/page-claims.js';

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

// GET /api/me/pages — list pages owned by the authenticated user.
// Optional ?project=<name> filters to one project; ?project=__unsorted__ lists
// pages with no project (including old records published before tagging existed).
me.get('/pages', async (c) => {
  const user = c.get('user')!;
  const ownerId = user.id;

  const rawLimit = parseInt(c.req.query('limit') ?? '20', 10);
  const limit = Math.min(isNaN(rawLimit) || rawLimit <= 0 ? 20 : rawLimit, 50);
  const cursor = c.req.query('cursor') || undefined;
  const projectFilter = c.req.query('project') || undefined;

  // Decide the id source + an optional metadata predicate.
  // - named project: query the project index, double-check metadata.project matches.
  // - __unsorted__: walk the flat index, keep only project === null.
  // - default: the flat index, no project predicate.
  let ids: string[];
  let nextCursor: string | null;
  let predicate: ((m: PageMetadata) => boolean) | null = null;

  if (projectFilter !== undefined && projectFilter !== UNSORTED_PROJECT) {
    // Match the read filter to the write-time normalization. A query that can't
    // normalize to a stored value (empty, whitespace, >64 chars) matches nothing.
    const normalized = normalizeProject(projectFilter);
    if (normalized === null) {
      return c.json({ pages: [], cursor: null });
    }
    const res = await listPagesForOwnerProject(c.env.PAGES_KV, ownerId, normalized, cursor, limit);
    ids = res.ids;
    nextCursor = res.cursor;
    predicate = (m) => m.project === normalized;
  } else {
    const res = await listPagesForOwner(c.env.PAGES_KV, ownerId, cursor, limit);
    ids = res.ids;
    nextCursor = res.cursor;
    if (projectFilter === UNSORTED_PROJECT) {
      predicate = (m) => m.project === null;
    }
  }

  // Fetch all page metadata in parallel
  const rawPages = await Promise.all(
    ids.map((id) => c.env.PAGES_KV.get(kvKeys.page(id))),
  );

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
    ownerId: number | null;
    project: string | null;
  }> = [];

  const parsed = rawPages.map((raw) => (raw === null ? null : parseMetadata(raw)));

  // A claimed page whose KV record was written back stale (ownerId null) is
  // still this owner's: D1 page_claims says so. Best-effort; on a D1 error
  // those pages are left out, as before.
  let claimedHere = new Set<string>();
  const unownedIds = parsed.flatMap((m) => (m !== null && m.ownerId === null ? [m.id] : []));
  if (unownedIds.length > 0) {
    try {
      claimedHere = await claimedIds(c.env.DB, ownerId, unownedIds);
    } catch (err) {
      console.error('page_claims lookup failed while listing pages', { ownerId, err });
    }
  }

  for (const found of parsed) {
    if (found === null) continue;
    const metadata = found.ownerId === null && claimedHere.has(found.id) ? { ...found, ownerId } : found;
    // Self-heal: filter stale index entries where ownerId doesn't match
    if (metadata.ownerId !== ownerId) continue;
    // Apply the project predicate (self-heals stale project-index entries too)
    if (predicate !== null && !predicate(metadata)) continue;
    pages.push({
      id: metadata.id,
      title: metadata.title,
      size: metadata.size,
      readCount: metadata.readCount,
      reads: metadata.reads,
      permanent: metadata.permanent,
      createdAt: metadata.createdAt,
      expiresAt: metadata.expiresAt,
      hasPin: metadata.pin !== null,
      ownerId: metadata.ownerId,
      project: metadata.project,
    });
  }

  return c.json({ pages, cursor: nextCursor });
});

// GET /api/me/projects — distinct projects for the authenticated user, with counts.
me.get('/projects', async (c) => {
  const user = c.get('user')!;
  const projects = await listProjectsForOwner(c.env.PAGES_KV, user.id);
  return c.json({ projects });
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

// DELETE /api/me — delete the authenticated user's account
me.delete('/', requireCsrfHeader, async (c) => {
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
    if (sub !== null && !sub.cancelAtPeriodEnd && isEntitled(sub, new Date())) {
      return c.json(
        { error: 'Cancel Pro in Manage billing before deleting your account.', code: 'subscription_active' },
        409,
      );
    }
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

  // Step 2: Delete user record and email index
  try {
    const userRaw = await c.env.PAGES_KV.get(kvKeys.user(userId));
    await c.env.PAGES_KV.delete(kvKeys.user(userId));

    if (userRaw !== null) {
      try {
        const userRecord: unknown = JSON.parse(userRaw);
        if (
          typeof userRecord === 'object' &&
          userRecord !== null &&
          typeof (userRecord as Record<string, unknown>)['email'] === 'string'
        ) {
          const email = (userRecord as Record<string, unknown>)['email'] as string;
          await c.env.PAGES_KV.delete(kvKeys.emailIndex(email));
        }
      } catch {
        // ignore parse errors
      }
    }
  } catch (err) {
    console.error('Failed to delete user record:', err);
  }

  // Step 3: Clear session cookie
  clearSessionCookie(c);

  // Step 4: Return immediately
  const response = c.json({ ok: true });

  // Step 5: waitUntil — paginated sweep to null out ownerId on all pages
  c.executionCtx.waitUntil(
    (async () => {
      // Claimed pages become anonymous pages again, like every other page.
      // Their D1 rows are released, not deleted, and keep the rotated hash:
      // the KV record may hold a stale pre-claim hash, which must not become
      // the authority again. `released` mirrors the right hash into KV below.
      let released = new Map<string, string>();
      try {
        released = await releaseClaimsForOwner(c.env.DB, userId);
      } catch (err) {
        console.error('Failed to release page claims during account deletion:', err);
      }
      const mirrorAnonymous = async (pageId: string) => {
        const raw = await c.env.PAGES_KV.get(kvKeys.page(pageId));
        if (raw === null) return;
        const metadata = parseMetadata(raw);
        if (metadata === null) return;
        const updated: PageMetadata = {
          ...metadata,
          ownerId: null,
          tokenHash: released.get(pageId) ?? metadata.tokenHash,
        };
        const kvOptions: KVNamespacePutOptions = {};
        if (metadata.expiresAt !== null) {
          kvOptions.expiration = Math.floor(Date.parse(metadata.expiresAt) / 1000);
        }
        await c.env.PAGES_KV.put(kvKeys.page(pageId), serializeMetadata(updated), kvOptions);
      };
      const swept = new Set<string>();

      let sweepCursor: string | undefined = undefined;

      while (true) {
        const listOptions: KVNamespaceListOptions = {
          prefix: kvKeys.pagesByOwnerPrefix(userId),
          limit: 50,
        };
        if (sweepCursor) {
          listOptions.cursor = sweepCursor;
        }

        let list: KVNamespaceListResult<unknown, string>;
        try {
          list = await c.env.PAGES_KV.list(listOptions);
        } catch (err) {
          console.error('Failed to list owner index during account deletion sweep:', err);
          break;
        }

        for (const entry of list.keys) {
          const segments = entry.name.split(':');
          const pageId = segments[segments.length - 1];
          if (pageId === undefined) continue;

          try {
            swept.add(pageId);
            await mirrorAnonymous(pageId);
          } catch (err) {
            console.error('Failed to null ownerId on page during deletion sweep:', { pageId, err });
          }

          // Delete the index entry
          try {
            await c.env.PAGES_KV.delete(entry.name);
          } catch (err) {
            console.error('Failed to delete owner index entry during deletion sweep:', { key: entry.name, err });
          }
        }

        if (list.list_complete) {
          break;
        }
        sweepCursor = list.cursor ?? undefined;
      }

      // Claimed pages missing from the owner index (a failed index write).
      for (const pageId of released.keys()) {
        if (swept.has(pageId)) continue;
        try {
          await mirrorAnonymous(pageId);
        } catch (err) {
          console.error('Failed to null ownerId on claimed page during deletion sweep:', { pageId, err });
        }
      }

      // Second sweep: delete the owner's project-index entries (page records were
      // already handled above — here we only clear the secondary index keys).
      let projectSweepCursor: string | undefined = undefined;
      while (true) {
        const listOptions: KVNamespaceListOptions = {
          prefix: kvKeys.pagesByOwnerProjectOwnerPrefix(userId),
          limit: 50,
        };
        if (projectSweepCursor) {
          listOptions.cursor = projectSweepCursor;
        }

        let list: KVNamespaceListResult<unknown, string>;
        try {
          list = await c.env.PAGES_KV.list(listOptions);
        } catch (err) {
          console.error('Failed to list project index during account deletion sweep:', err);
          break;
        }

        for (const entry of list.keys) {
          try {
            await c.env.PAGES_KV.delete(entry.name);
          } catch (err) {
            console.error('Failed to delete project index entry during deletion sweep:', { key: entry.name, err });
          }
        }

        if (list.list_complete) {
          break;
        }
        projectSweepCursor = list.cursor ?? undefined;
      }

      // Finally, drop the project manifest.
      try {
        await c.env.PAGES_KV.delete(kvKeys.projectsByOwner(userId));
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
 * D1 `page_claims` decides who owns a claimed page and which token works
 * (lib/claim-decision.ts). The KV record is updated after it, best-effort.
 */
async function claimPage(
  env: { PAGES_KV: KVNamespace; DB: D1Database },
  userId: number,
  pageId: string,
  updateToken: string,
): Promise<Response> {
  const kv = env.PAGES_KV;
  const denied = () => Response.json({ error: 'claim failed' }, { status: 403 });

  const raw = await kv.get(kvKeys.page(pageId));
  if (raw === null) return denied();
  const metadata = parseMetadata(raw);
  if (metadata === null) return denied();

  const outcome = await runClaim(
    { kvOwnerId: metadata.ownerId, kvTokenHash: metadata.tokenHash, userId, now: Date.now() },
    {
      getClaim: () => getClaim(env.DB, pageId),
      upsertClaim: (record, checkedHash) => upsertClaim(env.DB, pageId, record, checkedHash),
      replaceClaimToken: (hash) => replaceClaimToken(env.DB, pageId, userId, hash),
      newToken: generateToken,
      hash: hashToken,
      matches: (hash) => verifyToken(updateToken, hash),
      // KV is a cache for the viewer and dashboard; D1 already holds the
      // claim, so a failure here can't revive the old token.
      mirrorToKv: async (ownerId, tokenHash) => {
        try {
          const updated: PageMetadata = { ...metadata, ownerId, tokenHash };
          const kvOptions: KVNamespacePutOptions = {};
          if (metadata.expiresAt !== null) {
            kvOptions.expiration = Math.floor(Date.parse(metadata.expiresAt) / 1000);
          }
          await kv.put(kvKeys.page(pageId), serializeMetadata(updated), kvOptions);
        } catch (err) {
          console.error('page metadata write failed during claim', { pageId, userId, err });
        }
      },
      indexPage: async () => {
        try {
          await addPageToOwner(kv, userId, pageId, metadata.createdAt, metadata.expiresAt);
        } catch (err) {
          console.error('owner-index write failed during claim', { pageId, userId, err });
        }
        if (metadata.project !== null) {
          try {
            await addPageToOwnerProject(kv, userId, metadata.project, pageId, metadata.createdAt, metadata.expiresAt);
            await bumpProjectCount(kv, userId, metadata.project, 1);
          } catch (err) {
            console.error('owner-project-index write failed during claim', { pageId, userId, project: metadata.project, err });
          }
        }
      },
    },
  );

  if (!outcome.ok) return denied();
  return Response.json({
    ok: true,
    page: {
      id: metadata.id,
      title: metadata.title,
      createdAt: metadata.createdAt,
      expiresAt: metadata.expiresAt,
    },
    ...(outcome.token !== null ? { update_token: outcome.token } : {}),
  });
}

export { me };
