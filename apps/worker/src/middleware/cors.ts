import type { Context, Next } from 'hono';
import type { AppBindings } from '../types.js';

const ALLOWED_ORIGIN = 'https://aired.sh';
const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization, aired-Session, X-Aired-Request';

/**
 * Determine if the request path qualifies for Allow-Credentials: true.
 * Only /api/* and /auth/logout get credentials.
 */
function allowsCredentials(path: string): boolean {
  return path.startsWith('/api/') || path === '/auth/logout';
}

/**
 * Determine if the origin matches the allowed origin for any CORS response.
 * Paths starting with /auth/* (excluding /auth/logout) still get CORS headers
 * but WITHOUT Allow-Credentials.
 */
function originAllowed(origin: string, path: string): boolean {
  if (origin !== ALLOWED_ORIGIN) return false;
  return path.startsWith('/api/') || path.startsWith('/auth/');
}

/**
 * CORS middleware.
 * - OPTIONS preflight from https://aired.sh on /api/* or /auth/logout → full CORS with credentials.
 * - OPTIONS preflight from https://aired.sh on other /auth/* → CORS without credentials.
 * - Other origins → 200 with no CORS headers.
 * - Non-OPTIONS: sets CORS headers after next() if origin matches.
 */
export async function corsMiddleware(
  c: Context<AppBindings>,
  next: Next,
): Promise<Response | void> {
  const origin = c.req.header('Origin') ?? '';
  const path = new URL(c.req.url).pathname;

  if (c.req.method === 'OPTIONS') {
    if (originAllowed(origin, path)) {
      const withCreds = allowsCredentials(path);
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Methods', ALLOWED_METHODS);
      c.header('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      if (withCreds) {
        c.header('Access-Control-Allow-Credentials', 'true');
      }
      return new Response(null, { status: 200, headers: c.res.headers });
    }
    // Other origins: 200 with no CORS headers
    return new Response(null, { status: 200 });
  }

  await next();

  // Post-request: add CORS headers for matching origins
  if (originAllowed(origin, path)) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Methods', ALLOWED_METHODS);
    c.header('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    if (allowsCredentials(path)) {
      c.header('Access-Control-Allow-Credentials', 'true');
    }
  }
}
