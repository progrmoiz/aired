import type { Context, Next } from 'hono';
import type { AppBindings } from '../types.js';

const ALLOWED_ORIGIN = 'https://aired.sh';
const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization, aired-Session, X-Aired-Request';
const PUBLIC_ALLOWED_HEADERS = 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID';

/** /mcp, /mcp/account, /oauth/* and the OAuth discovery documents. Not /authorize (a page). */
export function isPublicProtocolPath(path: string): boolean {
  return (
    path === '/mcp' ||
    path === '/mcp/account' ||
    path.startsWith('/oauth/') ||
    path.startsWith('/.well-known/oauth-authorization-server') ||
    path.startsWith('/.well-known/oauth-protected-resource')
  );
}

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

  // MCP and its OAuth protocol endpoints are called by clients on any origin
  // (MCP Inspector runs in a browser) with a bearer token, never cookies: open
  // CORS, no credentials.
  if (isPublicProtocolPath(path)) {
    if (c.req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': PUBLIC_ALLOWED_HEADERS,
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    await next();
    c.res.headers.set('Access-Control-Allow-Origin', '*');
    c.res.headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
    c.res.headers.delete('Access-Control-Allow-Credentials');
    return;
  }

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
