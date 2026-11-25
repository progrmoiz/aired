import type { Context, Next } from 'hono';
import type { AppBindings } from '../types.js';
import { CSRF_HEADER } from '@aired/core';
import { readSessionCookie } from '../lib/cookies.js';
import { csrfHeaderRequired } from '../lib/csrf-rule.js';

/**
 * CSRF protection middleware.
 * Returns 403 when a state-changing request carries the session cookie but
 * not X-Aired-Request: 1.
 */
export async function requireCsrfHeader(
  c: Context<AppBindings>,
  next: Next,
): Promise<Response | void> {
  if (
    csrfHeaderRequired(c.req.method, readSessionCookie(c) !== null) &&
    c.req.header(CSRF_HEADER) !== '1'
  ) {
    return c.json(
      { error: `Forbidden: signed-in browser requests must send the ${CSRF_HEADER}: 1 header` },
      403,
    );
  }
  await next();
}
