import type { Context, Next } from 'hono';
import type { AppBindings } from '../types.js';
import { AUTH_HEADER, kvKeys, redactNoreplyEmail } from '@aired/core';
import { verifySession, signSession, shouldReissue } from '../lib/jwt.js';
import { readSessionCookie, setSessionCookie } from '../lib/cookies.js';

/**
 * Auth middleware.
 * Reads the JWT from the session cookie OR the aired-Session header.
 * Verifies the token and populates c.get('user') and c.get('jti').
 * On invalid: sets user and jti to null. Never throws.
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
): Promise<void> {
  const cookieValue = readSessionCookie(c);
  const headerValue = c.req.header(AUTH_HEADER) ?? null;
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

  // Step 5: sliding reissue
  const now = Date.now();
  if (shouldReissue(claims, now)) {
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

