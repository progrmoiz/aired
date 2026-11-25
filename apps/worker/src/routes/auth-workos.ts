import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppBindings } from '../types.js';
import { kvKeys, generateOpaqueId } from '@aired/core';
import { readOAuthStateCookie, setOAuthStateCookie } from '../lib/cookies.js';
import { fetchUser } from '../lib/github.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { TIERS } from '../lib/rate-limit-tiers.js';
import { authenticateWithCode, authorizeUrl, workosEnabled } from '../lib/workos.js';
import { resolveWorkosUser } from '../lib/resolve-user.js';
import { constantTimeEqual, finishSignIn, isAllowedReturn, type AuthState } from '../lib/sign-in.js';

/**
 * Sign-in through WorkOS AuthKit (Google, GitHub, Microsoft, Apple, email
 * codes), on when WORKOS_CLIENT_ID and WORKOS_API_KEY are set. Until then
 * /auth/login sends people to the GitHub sign-in, as today.
 */
const authWorkos = new Hono<AppBindings>();

/** Send the browser to AuthKit, remembering where to go after (or the CLI's port). */
export async function startWorkosSignIn(c: Context<AppBindings>, authState: AuthState): Promise<Response> {
  const state = generateOpaqueId();
  try {
    await c.env.PAGES_KV.put(kvKeys.authState(state), JSON.stringify({ ...authState, provider: 'workos' }), {
      expirationTtl: 600,
    });
  } catch (err) {
    console.error('Failed to write auth_state KV:', err);
    return c.redirect('/?login_failed=1', 302);
  }
  setOAuthStateCookie(c, state);
  return c.redirect(authorizeUrl(c.env, state), 302);
}

// GET /auth/login?return= — the one sign-in entry point. With WorkOS off it
// hands over to /auth/github, which counts the attempt itself.
const loginRateLimit = rateLimit(TIERS.oauth_init);
authWorkos.get('/login', (c, next) => (workosEnabled(c.env) ? loginRateLimit(c, next) : next()), async (c) => {
  const returnParam = c.req.query('return') ?? '/dashboard';
  const returnPath = isAllowedReturn(returnParam) ? returnParam : '/dashboard';
  if (!workosEnabled(c.env)) {
    return c.redirect(`/auth/github?return=${encodeURIComponent(returnPath)}`, 302);
  }
  return startWorkosSignIn(c, { return: returnPath });
});

const failed = (c: Context<AppBindings>, why = '1') => c.redirect(`/?login_failed=${why}`, 302);

// GET /auth/workos/callback — AuthKit sends the person back here with a code.
authWorkos.get('/workos/callback', rateLimit(TIERS.oauth_init), async (c) => {
  if (!workosEnabled(c.env)) return failed(c);
  const error = c.req.query('error');
  if (error === 'access_denied') return c.redirect('/?login_cancelled=1', 302);
  if (error) return failed(c);

  const urlState = c.req.query('state');
  const cookieState = readOAuthStateCookie(c);
  if (!urlState || !cookieState || !constantTimeEqual(urlState, cookieState)) return failed(c, 'state');

  const raw = await c.env.PAGES_KV.get(kvKeys.authState(urlState));
  if (raw === null) return failed(c, 'expired');
  await c.env.PAGES_KV.delete(kvKeys.authState(urlState)).catch(() => {});
  let authState: AuthState & { provider?: string };
  try {
    authState = JSON.parse(raw) as typeof authState;
  } catch {
    return failed(c);
  }
  // A state minted for the GitHub flow can't finish here.
  if (authState.provider !== 'workos') return failed(c, 'state');

  const code = c.req.query('code');
  if (!code) return failed(c);

  const auth = await authenticateWithCode(c.env, code);
  if (!auth.ok) return failed(c, auth.reason === 'unavailable' ? 'workos_unavailable' : '1');

  // A GitHub sign-in with provider tokens tells us the GitHub id, which is
  // how GitHub-era accounts are keyed. Without tokens, email linking applies.
  let githubId: number | null = null;
  if (auth.result.authenticationMethod === 'GitHubOAuth' && auth.result.providerAccessToken) {
    try {
      const gh = await fetchUser(auth.result.providerAccessToken);
      if (Number.isSafeInteger(gh.id) && gh.id > 0) githubId = gh.id;
    } catch (err) {
      console.warn('GitHub lookup through WorkOS tokens failed; linking by email instead', err);
    }
  }

  let user;
  try {
    user = await resolveWorkosUser(c.env, {
      workosUserId: auth.result.userId,
      email: auth.result.email,
      emailVerified: auth.result.emailVerified,
      firstName: auth.result.firstName,
      lastName: auth.result.lastName,
      githubId,
    });
  } catch (err) {
    console.error('Failed to resolve WorkOS user:', err);
    return failed(c);
  }
  return finishSignIn(c, user, authState);
});

export { authWorkos };
