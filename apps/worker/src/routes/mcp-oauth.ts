import { Hono, type Context } from 'hono';
import {
  AuthorizationError,
  CimdFetchError,
  OAuthAuthorizationServer,
  type ConsentDescription,
} from '@cloudflare/workers-oauth-provider';
import { kvKeys } from '@aired/core';
import type { AppBindings } from '../types.js';
import { siteOrigin } from '../lib/billing/webhook-plan.js';
import { readSessionCookie } from '../lib/cookies.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { TIERS } from '../lib/rate-limit-tiers.js';
import { consentPage, consentErrorPage } from '../lib/mcp-consent.js';

/**
 * OAuth for the remote MCP (Task 5.2), so connector clients (Claude,
 * ChatGPT, Cursor…) can act as a signed-in aired account without an API key.
 *
 * aired is its own authorization server (@cloudflare/workers-oauth-provider,
 * grants in KV under client:/grant:/token:/transaction:). People approve a
 * client on /authorize with their normal aired web session. Two resources:
 * - /mcp/account: sign-in required. A client with no token gets a 401
 *   challenge that starts the OAuth flow. This is the connector URL.
 * - /mcp: unchanged for everyone else (anonymous, or an API key), and it also
 *   accepts a token issued for it.
 * Tool calls made with a token reach the HTTP API in-process as that account
 * (see withMcpOAuthUser); the token itself is never passed on.
 */

type Env = AppBindings['Bindings'];

/** The one scope: act on your aired pages and account through the MCP tools. */
export const MCP_SCOPE = 'mcp';

export function mcpResources(env: Env): { open: string; account: string } {
  const origin = siteOrigin(env);
  return { open: `${origin}/mcp`, account: `${origin}/mcp/account` };
}

// The issuer comes from SITE_ORIGIN, so build one server per origin.
const servers = new Map<string, OAuthAuthorizationServer<Env>>();
export function mcpAuthServer(env: Env): OAuthAuthorizationServer<Env> {
  const issuer = siteOrigin(env);
  let server = servers.get(issuer);
  if (server === undefined) {
    const r = mcpResources(env);
    server = new OAuthAuthorizationServer<Env>({
      issuer,
      resources: [r.account, r.open],
      defaultResource: r.account,
      clientRegistrationEndpoint: '/oauth/register',
      scopesSupported: [MCP_SCOPE, 'offline_access'],
      clientIdMetadataDocumentEnabled: true,
    });
    servers.set(issuer, server);
  }
  return server;
}

export type McpTokenUser = { userId: number; scope: string[] };

/** A token for this resource, or null. Expired, revoked or someone else's resource: null. */
export async function validateMcpToken(env: Env, resource: string, token: string): Promise<McpTokenUser | null> {
  const v = await mcpAuthServer(env).validateToken<{ userId?: unknown }>(resource, token, env);
  if (v === null || v.audience !== resource) return null;
  if (typeof v.expiresAt === 'number' && v.expiresAt * 1000 <= Date.now()) return null;
  const userId = v.props?.userId;
  if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) return null;
  return { userId, scope: v.scope };
}

function metadataUrl(env: Env, resource: string): string {
  return `${siteOrigin(env)}/.well-known/oauth-protected-resource${new URL(resource).pathname}`;
}

/** The 401 that tells an MCP client where to sign in (RFC 9728, MCP authorization). */
export function mcpChallenge(c: Context<AppBindings>, resource: string, error?: 'invalid_token'): Response {
  const parts = [`resource_metadata="${metadataUrl(c.env, resource)}"`, `scope="${MCP_SCOPE}"`];
  if (error) parts.push(`error="${error}"`);
  return c.json(
    { error: error === 'invalid_token' ? 'The access token is invalid or expired. Sign in again.' : 'Sign in to aired to use this MCP server.' },
    401,
    { 'WWW-Authenticate': `Bearer ${parts.join(', ')}` },
  );
}

/** The 403 for a token without the mcp scope (MCP step-up). */
export function mcpInsufficientScope(c: Context<AppBindings>, resource: string): Response {
  return c.json({ error: 'The token needs the mcp scope.' }, 403, {
    'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${MCP_SCOPE}", resource_metadata="${metadataUrl(c.env, resource)}"`,
  });
}

/**
 * The env an in-process API call runs with when a tool call came with an
 * OAuth token: authMiddleware signs it in as this account (authMethod
 * 'oauth'). Only code can set it, never a request.
 */
export function withMcpOAuthUser(env: Env, userId: number): Env {
  return Object.create(env, { AIRED_MCP_OAUTH_USER: { value: userId, enumerable: false } }) as Env;
}

const mcpOAuth = new Hono<AppBindings>();

// RFC 9728 protected resource metadata for both MCP resources.
for (const path of ['/mcp', '/mcp/account'] as const) {
  mcpOAuth.get(`/.well-known/oauth-protected-resource${path}`, (c) => {
    const r = mcpResources(c.env);
    const resource = path === '/mcp' ? r.open : r.account;
    c.header('Cache-Control', 'public, max-age=3600');
    return c.json({
      resource,
      authorization_servers: [siteOrigin(c.env)],
      scopes_supported: [MCP_SCOPE],
      bearer_methods_supported: ['header'],
      resource_name: 'aired',
    });
  });
}

// Protocol endpoints owned by the library: discovery, token, registration, revocation.
mcpOAuth.all('/.well-known/oauth-authorization-server', (c) => mcpAuthServer(c.env).fetch(c.req.raw, c.env, c.executionCtx));
mcpOAuth.all('/.well-known/oauth-authorization-server/*', (c) => mcpAuthServer(c.env).fetch(c.req.raw, c.env, c.executionCtx));
mcpOAuth.all('/oauth/*', rateLimit(TIERS.oauth_init), (c) => mcpAuthServer(c.env).fetch(c.req.raw, c.env, c.executionCtx));

/** Signed in on the website (the session cookie), not with a CLI token or an API key. */
async function webAccount(c: Context<AppBindings>): Promise<{ id: number; login: string } | null> {
  const user = c.get('user');
  if (user === null || c.get('authMethod') !== 'session' || readSessionCookie(c) === null) return null;
  // Tokens are minted from the account record: no record, no approval.
  if ((await c.env.PAGES_KV.get(kvKeys.user(user.id))) === null) return null;
  return { id: user.id, login: user.login };
}

function html(body: string, status: number, headers?: Headers): Response {
  const h = headers ?? new Headers();
  h.set('Content-Type', 'text/html; charset=utf-8');
  h.set('Cache-Control', 'no-store');
  h.set('X-Frame-Options', 'DENY');
  h.set('Content-Security-Policy', "frame-ancestors 'none'");
  return new Response(body, { status, headers: h });
}

/** AuthorizationError / CimdFetchError per the library's table: redirect only when it says it's safe. */
function authorizeFailure(err: unknown): Response {
  if (err instanceof AuthorizationError && err.redirectTo) return Response.redirect(err.redirectTo, 302);
  if (err instanceof AuthorizationError) return html(consentErrorPage(err.description), 400);
  if (err instanceof CimdFetchError) return html(consentErrorPage('This app could not be verified.'), 400);
  throw err;
}

// GET /authorize — validate the client's request, sign in if needed, then ask.
mcpOAuth.get('/authorize', rateLimit(TIERS.oauth_init), async (c) => {
  const oauth = mcpAuthServer(c.env).getOAuthApi(c.env);
  try {
    const request = await oauth.parseAuthRequest(c.req.raw);
    const account = await webAccount(c);
    if (account === null) {
      const back = `/authorize${new URL(c.req.url).search}`;
      return c.redirect(`/auth/login?return=${encodeURIComponent(back)}`, 302);
    }
    const details: ConsentDescription = await oauth.describeConsent(request);
    const consent = await oauth.beginConsent(request);
    return html(consentPage(details, consent.handle, account.login), 200, consent.headers);
  } catch (err) {
    return authorizeFailure(err);
  }
});

// POST /authorize — Allow or Deny from the consent page.
mcpOAuth.post('/authorize', rateLimit(TIERS.oauth_init), async (c) => {
  const oauth = mcpAuthServer(c.env).getOAuthApi(c.env);
  const account = await webAccount(c);
  if (account === null) return html(consentErrorPage('Your aired session ended. Start connecting again from the app.'), 401);
  const form = await c.req.formData().catch(() => null);
  const handle = String(form?.get('handle') ?? '');
  try {
    if (form?.get('decision') !== 'approve') {
      const denied = await oauth.denyConsent(c.req.raw, handle);
      denied.headers.set('Location', denied.redirectTo);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    // One scope: what the tools need.
    const approved = await oauth.approveConsent(c.req.raw, handle, { scope: [MCP_SCOPE] });
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: String(account.id),
      metadata: { login: account.login },
      scope: approved.request.scope,
      props: { userId: account.id },
    });
    approved.headers.set('Location', redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (err) {
    return authorizeFailure(err);
  }
});

export { mcpOAuth };
