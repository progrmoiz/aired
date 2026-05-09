import { Hono } from 'hono';
import type { AppBindings } from '../types.js';
import {
  kvKeys,
  verifyToken,
  parseMetadata,
  serializeMetadata,
  redactNoreplyEmail,
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
} from '../lib/owner-index.js';
import { clearSessionCookie, readSessionCookie } from '../lib/cookies.js';
import { AUTH_HEADER } from '@aired/core';

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

  return c.json({
    id: user.id,
    login: user.login,
    email: redactNoreplyEmail(user.email),
    name: user.name,
    createdAt,
  });
});

// GET /api/me/pages — list pages owned by the authenticated user
me.get('/pages', async (c) => {
  const user = c.get('user')!;
  const ownerId = user.id;

  const rawLimit = parseInt(c.req.query('limit') ?? '20', 10);
  const limit = Math.min(isNaN(rawLimit) || rawLimit <= 0 ? 20 : rawLimit, 50);
  const cursor = c.req.query('cursor') || undefined;

  const { ids, cursor: nextCursor } = await listPagesForOwner(
    c.env.PAGES_KV,
    ownerId,
    cursor,
    limit,
  );

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
  }> = [];

  for (const raw of rawPages) {
    if (raw === null) continue;
    const metadata = parseMetadata(raw);
    if (metadata === null) continue;
    // Self-heal: filter stale index entries where ownerId doesn't match
    if (metadata.ownerId !== ownerId) continue;
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
    });
  }

  return c.json({ pages, cursor: nextCursor });
});

// POST /api/me/claim — claim a single page by id + update_token
me.post('/claim', requireCsrfHeader, async (c) => {
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

  return claimPage(c.env.PAGES_KV, user.id, id, update_token);
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

    const claimed: string[] = [];
    const failed: { id: string; reason: string }[] = [];

    for (const item of items) {
      if (
        typeof item !== 'object' ||
        item === null ||
        Array.isArray(item)
      ) {
        failed.push({ id: String((item as Record<string, unknown>)?.['id'] ?? ''), reason: 'claim failed' });
        continue;
      }

      const { id, update_token } = item as Record<string, unknown>;

      if (typeof id !== 'string' || typeof update_token !== 'string') {
        failed.push({ id: typeof id === 'string' ? id : '', reason: 'claim failed' });
        continue;
      }

      try {
        const result = await claimPage(c.env.PAGES_KV, user.id, id, update_token);
        const resultJson = await result.json<{ ok?: boolean; error?: string }>();
        if (resultJson.ok) {
          claimed.push(id);
        } else {
          failed.push({ id, reason: 'claim failed' });
        }
      } catch {
        failed.push({ id, reason: 'claim failed' });
      }
    }

    return c.json({ claimed, failed });
  },
);

// DELETE /api/me — delete the authenticated user's account
me.delete('/', requireCsrfHeader, async (c) => {
  const user = c.get('user')!;
  const userId = user.id;
  const jti = c.get('jti');

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
            const raw = await c.env.PAGES_KV.get(kvKeys.page(pageId));
            if (raw !== null) {
              const metadata = parseMetadata(raw);
              if (metadata !== null) {
                const updated: PageMetadata = { ...metadata, ownerId: null };
                const kvOptions: KVNamespacePutOptions = {};
                if (metadata.expiresAt !== null) {
                  kvOptions.expiration = Math.floor(Date.parse(metadata.expiresAt) / 1000);
                }
                await c.env.PAGES_KV.put(kvKeys.page(pageId), serializeMetadata(updated), kvOptions);
              }
            }
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
    })(),
  );

  return response;
});

/**
 * Internal helper: claim a single page for a user.
 * Returns a Hono Response. Both claim and claim-batch call this.
 */
async function claimPage(
  kv: KVNamespace,
  userId: number,
  pageId: string,
  updateToken: string,
): Promise<Response> {
  // Step 1: fetch metadata
  const raw = await kv.get(kvKeys.page(pageId));
  if (raw === null) {
    return Response.json({ error: 'claim failed' }, { status: 403 });
  }

  // Step 2: parse
  const metadata = parseMetadata(raw);
  if (metadata === null) {
    return Response.json({ error: 'claim failed' }, { status: 403 });
  }

  // Step 3: ownership precheck — if already owned by someone else, 403 (no oracle)
  if (metadata.ownerId !== null && metadata.ownerId !== userId) {
    return Response.json({ error: 'claim failed' }, { status: 403 });
  }

  // Step 4: verify update_token
  const valid = await verifyToken(updateToken, metadata.tokenHash);
  if (!valid) {
    return Response.json({ error: 'claim failed' }, { status: 403 });
  }

  // Step 5: idempotent if already owned by this user
  if (metadata.ownerId === userId) {
    return Response.json({
      ok: true,
      page: {
        id: metadata.id,
        title: metadata.title,
        createdAt: metadata.createdAt,
        expiresAt: metadata.expiresAt,
      },
    });
  }

  // Set ownerId and write updated metadata
  const updated: PageMetadata = { ...metadata, ownerId: userId };
  const kvOptions: KVNamespacePutOptions = {};
  if (metadata.expiresAt !== null) {
    kvOptions.expiration = Math.floor(Date.parse(metadata.expiresAt) / 1000);
  }
  await kv.put(kvKeys.page(pageId), serializeMetadata(updated), kvOptions);

  // Write owner index entry (best-effort)
  try {
    await addPageToOwner(kv, userId, pageId, metadata.createdAt, metadata.expiresAt);
  } catch (err) {
    console.error('owner-index write failed during claim', { pageId, userId, err });
  }

  // Step 6: return success
  return Response.json({
    ok: true,
    page: {
      id: metadata.id,
      title: metadata.title,
      createdAt: metadata.createdAt,
      expiresAt: metadata.expiresAt,
    },
  });
}

export { me };
