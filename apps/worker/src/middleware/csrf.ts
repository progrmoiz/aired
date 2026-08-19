import type { Context, Next } from 'hono';
import type { AppBindings } from '../types.js';
import { CSRF_HEADER } from '@aired/core';
import { readSessionCookie } from '../lib/cookies.js';

/**
 * CSRF protection middleware.
 *
 * Only cookie-authenticated (browser) requests carry ambient credentials a
 * third-party site could ride along on, so the X-Aired-Request check only
 * applies when a session cookie is present. Bearer update_token and
 * header-presented JWT (aired-Session) auth are never sent automatically by
 * a browser, so they're not CSRF-able and must not be blocked here — this
 * previously 403'd every anonymous DELETE/PUT /api/pages/:id call that used
 * a valid Bearer update_token instead of a cookie session.
 */
export async function requireCsrfHeader(
  c: Context<AppBindings>,
  next: Next,
): Promise<Response | void> {
  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    if (readSessionCookie(c) !== null && c.req.header(CSRF_HEADER) !== '1') {
      return c.json({ error: 'Forbidden' }, 403);
    }
  }
  await next();
}
