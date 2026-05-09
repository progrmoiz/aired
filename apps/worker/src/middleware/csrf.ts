import type { Context, Next } from 'hono';
import type { AppBindings } from '../types.js';
import { CSRF_HEADER } from '@aired/core';

/**
 * CSRF protection middleware.
 * Returns 403 when the request method is not GET/HEAD/OPTIONS
 * and the X-Aired-Request header is not '1'.
 */
export async function requireCsrfHeader(
  c: Context<AppBindings>,
  next: Next,
): Promise<Response | void> {
  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    if (c.req.header(CSRF_HEADER) !== '1') {
      return c.json({ error: 'Forbidden' }, 403);
    }
  }
  await next();
}
