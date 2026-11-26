/**
 * WorkOS AuthKit over plain fetch (no SDK). WorkOS only proves who someone
 * is; aired keeps its own session cookie and account ids (lib/resolve-user.ts).
 * Off until both WORKOS_CLIENT_ID and WORKOS_API_KEY are set: until then every
 * sign-in uses GitHub as before. Imports only lib/origin.ts, so tests load
 * it directly.
 */

import { siteOrigin } from './origin.ts';

export type WorkosEnv = {
  WORKOS_CLIENT_ID?: string;
  WORKOS_API_KEY?: string;
  /** Local tests point this at a mock. Default https://api.workos.com. */
  WORKOS_API_BASE?: string;
  SITE_ORIGIN?: string;
};

export function workosEnabled(env: WorkosEnv): boolean {
  return Boolean(env.WORKOS_CLIENT_ID?.trim() && env.WORKOS_API_KEY?.trim());
}

function base(env: WorkosEnv): string {
  return (env.WORKOS_API_BASE ?? 'https://api.workos.com').replace(/\/+$/, '');
}

/** Where WorkOS sends people back: <SITE_ORIGIN>/auth/workos/callback. */
export function workosRedirectUri(env: WorkosEnv): string {
  return `${siteOrigin(env)}/auth/workos/callback`;
}

/** The AuthKit hosted sign-in page for this state. */
export function authorizeUrl(env: WorkosEnv, state: string): string {
  const url = new URL(`${base(env)}/user_management/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', env.WORKOS_CLIENT_ID!.trim());
  url.searchParams.set('redirect_uri', workosRedirectUri(env));
  url.searchParams.set('provider', 'authkit');
  url.searchParams.set('state', state);
  return url.toString();
}

export type WorkosAuthResult = {
  userId: string;
  email: string | null;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
  /** e.g. "GitHubOAuth", "GoogleOAuth", "MagicAuth". */
  authenticationMethod: string | null;
  /** The provider's access token, when "return OAuth tokens" is on for that connection. */
  providerAccessToken: string | null;
  /** The AuthKit session (the access token's `sid`), so signing out of aired can end it too. */
  sessionId: string | null;
};

/** The `sid` claim of a WorkOS access token (a JWT), or null. Read only to sign the session out. */
export function sessionIdFromAccessToken(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as { sid?: unknown };
    return typeof claims.sid === 'string' && /^[A-Za-z0-9_]{1,128}$/.test(claims.sid) ? claims.sid : null;
  } catch {
    return null;
  }
}

/** Where to send the browser to end the AuthKit session, then come back to aired's home page. */
export function workosLogoutUrl(env: WorkosEnv, sessionId: string): string {
  const url = new URL(`${base(env)}/user_management/sessions/logout`);
  url.searchParams.set('session_id', sessionId);
  url.searchParams.set('return_to', `${siteOrigin(env)}/`);
  return url.toString();
}

type Obj = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Read POST /user_management/authenticate's answer; null if it isn't one. */
export function parseAuthenticateResponse(data: unknown): WorkosAuthResult | null {
  const d = (data ?? {}) as Obj;
  const user = (d.user ?? null) as Obj | null;
  const userId = user ? str(user.id) : null;
  if (user === null || userId === null) return null;
  const tokens = (d.oauth_tokens ?? null) as Obj | null;
  return {
    userId,
    email: str(user.email),
    emailVerified: user.email_verified === true,
    firstName: str(user.first_name),
    lastName: str(user.last_name),
    authenticationMethod: str(d.authentication_method),
    providerAccessToken: tokens ? str(tokens.access_token) : null,
    sessionId: sessionIdFromAccessToken(d.access_token),
  };
}

/** Exchange the callback's code for the signed-in WorkOS user. */
export async function authenticateWithCode(
  env: WorkosEnv,
  code: string,
): Promise<{ ok: true; result: WorkosAuthResult } | { ok: false; reason: 'rejected' | 'unavailable' }> {
  let res: Response;
  try {
    res = await fetch(`${base(env)}/user_management/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: env.WORKOS_CLIENT_ID!.trim(),
        client_secret: env.WORKOS_API_KEY!.trim(),
        grant_type: 'authorization_code',
        code,
      }),
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (res.status >= 500) return { ok: false, reason: 'unavailable' };
  if (!res.ok) return { ok: false, reason: 'rejected' };
  const result = parseAuthenticateResponse(await res.json().catch(() => null));
  return result ? { ok: true, result } : { ok: false, reason: 'rejected' };
}
