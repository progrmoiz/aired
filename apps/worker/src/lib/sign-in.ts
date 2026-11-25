import type { Context } from 'hono';
import type { AppBindings } from '../types.js';
import { kvKeys, generateOpaqueId, CLI_SESSION_MAX_AGE_SECONDS } from '@aired/core';
import { signSession } from './jwt.js';
import { setSessionCookie, clearOAuthStateCookie } from './cookies.js';
import { isAllowedReturn } from './return-path.js';

export { isAllowedReturn };

/**
 * The end of every sign-in (GitHub or WorkOS): mint the session and hand it
 * to the browser (cookie, then the return path) or to the CLI (one-time code
 * on its localhost port).
 */

/** Constant-time string comparison to prevent timing attacks. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type AuthState = { port?: number; client_state?: string; return?: string };

export async function finishSignIn(
  c: Context<AppBindings>,
  user: { id: number; login: string; email: string | null; name: string | null },
  authState: AuthState,
): Promise<Response> {
  // CLI flow (port present) gets a long-lived, non-rotating token; the web
  // cookie keeps the default sliding 30-day lifetime.
  const isCliFlow = typeof authState.port === 'number';

  let jwt: string;
  try {
    jwt = await signSession(
      { sub: user.id, login: user.login, email: user.email, name: user.name },
      c.env.SESSION_SECRET,
      isCliFlow ? CLI_SESSION_MAX_AGE_SECONDS : undefined,
    );
  } catch (err) {
    console.error('Failed to mint JWT:', err);
    return c.redirect('/?login_failed=1', 302);
  }

  clearOAuthStateCookie(c);

  if (isCliFlow) {
    const cliCode = generateOpaqueId();
    const clientState = authState.client_state ?? '';
    try {
      await c.env.PAGES_KV.put(
        kvKeys.cliCode(cliCode),
        JSON.stringify({ jwt, client_state: clientState }),
        { expirationTtl: 60 },
      );
    } catch (err) {
      console.error('Failed to write cli_code KV:', err);
      return c.redirect('/?login_failed=1', 302);
    }
    return c.redirect(
      `http://localhost:${authState.port}/?code=${encodeURIComponent(cliCode)}&state=${encodeURIComponent(clientState)}`,
      302,
    );
  }

  setSessionCookie(c, jwt);
  const returnPath = isAllowedReturn(authState.return ?? '') ? (authState.return ?? '/dashboard') : '/dashboard';
  return c.redirect(returnPath, 302);
}
