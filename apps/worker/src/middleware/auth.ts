import type { Context, Next } from 'hono';
import type { AppBindings } from '../types.js';
import { API_KEY_PREFIX, AUTH_HEADER, hashToHex, kvKeys, parseApiKey, redactNoreplyEmail } from '@aired/core';
import { findActiveKey, lastUsedDue, touchKey } from '../lib/api-keys.js';
import { bearerToken } from '../lib/page-token.js';
import { verifySession, signSession, shouldReissue } from '../lib/jwt.js';
import { readSessionCookie, setSessionCookie } from '../lib/cookies.js';
import { loadUserRecord, signedInUser } from '../lib/user-record.js';
import { retiredBy, sessionsValidSince } from '../lib/revocation.js';

/**
 * Auth middleware.
 * Reads the JWT from the session cookie OR the aired-Session header.
 * Verifies the token and populates c.get('user') and c.get('jti').
 * On invalid: sets user and jti to null. Never throws.
 *
 * An API key (Authorization: Bearer aired_sk_…) is checked first; a key that's
 * sent but isn't valid answers 401 (503 if D1 is down) instead of continuing.
 *
 * Verification order:
 *   1. parse via verifySession
 *   2. if not ok → anonymous
 *   3. KV revoked_jti check
 *   4. SESSION_VALID_SINCE check (isNaN guard)
 *   5. shouldReissue → on reissue: revoke old jti, mint new, set cookie if web
 *   6. single post-verification block: set user and jti
 */
export async function authMiddleware(
  c: Context<AppBindings>,
  next: Next,
): Promise<Response | void> {
  c.set('via', null);
  c.set('apiKeyId', null);

  // An in-process API call for an MCP tool call made with an OAuth token.
  const mcpUser = c.env.AIRED_MCP_OAUTH_USER;
  if (typeof mcpUser === 'number') return mcpOAuthAuth(c, next, mcpUser);

  // An API key (Authorization: Bearer aired_sk_…) wins over any session. A key
  // that's sent but isn't valid is a 401, never a quiet fall back to
  // anonymous: a CI job with a revoked key must not publish ownerless pages.
  // Update tokens (at_…) also arrive as Bearer; they aren't keys and are left
  // to the routes.
  const bearer = bearerToken(c.req.header('Authorization'));
  if (bearer?.startsWith(API_KEY_PREFIX)) {
    return keyAuth(c, next, bearer);
  }

  const cookieValue = readSessionCookie(c);
  const headerValue = c.req.header(AUTH_HEADER) ?? null;
  // A key pasted into the session header: refuse it rather than go anonymous.
  if (headerValue?.trim().startsWith(API_KEY_PREFIX)) {
    return c.json({ error: 'Send API keys as Authorization: Bearer, not in the session header' }, 401);
  }
  const isWebContext = cookieValue !== null;
  const rawToken: string | null = cookieValue ?? headerValue;

  const setAnonymous = () => {
    c.set('user', null);
    c.set('jti', null);
  };

  if (!rawToken) {
    setAnonymous();
    await next();
    return;
  }

  const result = await verifySession(rawToken, c.env.SESSION_SECRET);

  if (!result.ok) {
    setAnonymous();
    await next();
    return;
  }

  let claims = result.claims;

  // Step 3: KV revocation check
  const revoked = await c.env.PAGES_KV.get(kvKeys.revokedJti(claims.jti));
  if (revoked !== null) {
    setAnonymous();
    await next();
    return;
  }

  // Step 4: SESSION_VALID_SINCE check
  const validSinceRaw = Date.parse(c.env.SESSION_VALID_SINCE ?? '');
  let threshold: number;
  if (isNaN(validSinceRaw)) {
    console.error('SESSION_VALID_SINCE is malformed; defaulting to epoch');
    threshold = 0;
  } else {
    threshold = validSinceRaw / 1000;
  }

  if (claims.iat < threshold) {
    setAnonymous();
    await next();
    return;
  }

  // Per-account revocation: account deleted, or its owner signed out everywhere.
  if (retiredBy(await sessionsValidSince(c.env.PAGES_KV, claims.sub), claims.iat)) {
    setAnonymous();
    await next();
    return;
  }

  // Step 5: sliding reissue — web (cookie) sessions only.
  // Header-presented (CLI/MCP) tokens are NOT rotated: the reissue path revokes
  // the old jti but can only deliver the replacement via Set-Cookie, so a CLI
  // would revoke its own token and never receive the new one (silent 7-day death).
  // CLI tokens ride their full TTL instead.
  const now = Date.now();
  if (isWebContext && shouldReissue(claims, now)) {
    const oldJti = claims.jti;
    const oldExp = claims.exp;
    const nowSeconds = Math.floor(now / 1000);
    const remainingTtl = oldExp - nowSeconds;

    // Revoke the old JTI
    if (remainingTtl > 0) {
      try {
        await c.env.PAGES_KV.put(
          kvKeys.revokedJti(oldJti),
          '1',
          { expirationTtl: remainingTtl },
        );
      } catch (err) {
        console.error('Failed to write revoked_jti on reissue:', err);
      }
    }

    // Mint new JWT
    try {
      const newJwt = await signSession(
        { sub: claims.sub, login: claims.login, email: claims.email, name: claims.name },
        c.env.SESSION_SECRET,
      );

      // If web context (cookie was present), set new cookie
      if (isWebContext) {
        setSessionCookie(c, newJwt);
      }

      // Update claims from new token
      const newResult = await verifySession(newJwt, c.env.SESSION_SECRET);
      if (newResult.ok) {
        claims = newResult.claims;
      }
    } catch (err) {
      console.error('Failed to reissue JWT:', err);
      // Continue with old claims
    }
  }

  // Step 6: single post-verification block
  c.set('user', {
    id: claims.sub,
    login: claims.login,
    email: redactNoreplyEmail(claims.email),
    name: claims.name,
  });
  c.set('jti', claims.jti);
  // The web cookie and the CLI's aired-Session header are different callers:
  // only the cookie can manage keys, billing or the account (requireWebSession).
  c.set('via', isWebContext ? 'cookie' : 'cli');

  await next();
}

/** Sign in as the account an MCP OAuth token was issued to (already validated by the /mcp route). */
async function mcpOAuthAuth(c: Context<AppBindings>, next: Next, userId: number): Promise<Response | void> {
  const record = await loadUserRecord(c.env.PAGES_KV, userId);
  if (record === null) return c.json({ error: 'Unauthorized' }, 401);
  c.set('user', signedInUser(record));
  c.set('jti', null);
  c.set('via', 'oauth');
  await next();
}

/** Sign the request in with an API key, or answer 401/503. */
async function keyAuth(c: Context<AppBindings>, next: Next, presented: string): Promise<Response | void> {
  const parsed = parseApiKey(presented);
  if (!parsed.ok) return c.json({ error: 'Invalid API key' }, 401);

  let found: Awaited<ReturnType<typeof findActiveKey>>;
  try {
    found = await findActiveKey(c.env.DB, await hashToHex(parsed.key));
  } catch (err) {
    console.error('API key lookup failed', err);
    return c.json({ error: 'Could not check the API key. Please try again.' }, 503);
  }
  if (found === null) return c.json({ error: 'Invalid or revoked API key' }, 401);

  // "Sign out everyone" (SESSION_VALID_SINCE) also retires keys made before it.
  const validSince = Date.parse(c.env.SESSION_VALID_SINCE ?? '');
  if (!isNaN(validSince) && found.createdAt < validSince) {
    return c.json({ error: 'Invalid or revoked API key' }, 401);
  }

  // The account behind the key. Account deletion removes it (and the key).
  const record = await loadUserRecord(c.env.PAGES_KV, found.userId);
  if (record === null) return c.json({ error: 'Invalid or revoked API key' }, 401);

  c.set('user', signedInUser(record));
  c.set('jti', null);
  c.set('via', 'key');
  c.set('apiKeyId', found.id);

  const now = Date.now();
  if (lastUsedDue(found.lastUsedAt, now)) {
    c.executionCtx.waitUntil(
      touchKey(c.env.DB, found.id, now).catch((err) => console.error('API key last_used update failed', err)),
    );
  }
  await next();
}

/**
 * Guard middleware: signed in on the website (the session cookie) only. For
 * managing API keys, deleting the account, billing, approving CLI sign-ins
 * and MCP connections: things a CLI token, an API key or a connected app
 * mustn't be able to do, so a leaked one can't mint more access or take the
 * account.
 */
export async function requireWebSession(
  c: Context<AppBindings>,
  next: Next,
): Promise<Response | void> {
  if (c.get('user') === null) return c.json({ error: 'Unauthorized' }, 401);
  if (c.get('via') !== 'cookie') {
    return c.json(
      { error: 'Sign in on the aired website to do this. The CLI, API keys and connected apps can\'t manage keys, billing or the account.' },
      403,
    );
  }
  await next();
}

/**
 * Guard middleware: returns 401 if the user is not authenticated.
 */
export async function requireAuth(
  c: Context<AppBindings>,
  next: Next,
): Promise<Response | void> {
  if (c.get('user') === null) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
}

