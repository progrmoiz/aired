import { Hono } from 'hono';
import type { AppBindings } from '../types.js';
import {
  kvKeys,
  generateOpaqueId,
  redactNoreplyEmail,
  AUTH_HEADER,
  CLI_SESSION_MAX_AGE_SECONDS,
} from '@aired/core';
import { signSession, verifySession } from '../lib/jwt.js';
import {
  setSessionCookie,
  clearSessionCookie,
  readSessionCookie,
  readOAuthStateCookie,
  setOAuthStateCookie,
  clearOAuthStateCookie,
  readWorkosSessionCookie,
  clearWorkosSessionCookie,
} from '../lib/cookies.js';
import {
  exchangeCode,
  fetchUser,
  requestDeviceCode,
  pollDeviceToken,
} from '../lib/github.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCsrfHeader } from '../middleware/csrf.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { TIERS } from '../lib/rate-limit-tiers.js';
import { resolveGithubSignIn } from '../lib/resolve-user.js';
import { constantTimeEqual, finishSignIn, isAllowedReturn, type AuthState } from '../lib/sign-in.js';
import { workosEnabled, workosLogoutUrl } from '../lib/workos.js';
import { siteOrigin } from '../lib/billing/webhook-plan.js';
import { startWorkosSignIn } from './auth-workos.js';
import { pollNativeDevice } from './auth-device.js';
import { isNativeDeviceCode } from '../lib/device-code.js';

const auth = new Hono<AppBindings>();

// GET /auth/github — initiate web OAuth flow
auth.get('/github', rateLimit(TIERS.oauth_init), async (c) => {
  const url = new URL(c.req.url);
  const returnParam = url.searchParams.get('return') ?? '/dashboard';
  const returnPath = isAllowedReturn(returnParam) ? returnParam : '/dashboard';

  const state = generateOpaqueId();

  try {
    await c.env.PAGES_KV.put(
      kvKeys.authState(state),
      JSON.stringify({ return: returnPath }),
      { expirationTtl: 600 },
    );
  } catch (err) {
    console.error('Failed to write auth_state KV:', err);
    return c.redirect('/?login_failed=1', 302);
  }

  setOAuthStateCookie(c, state);

  const githubUrl = new URL('https://github.com/login/oauth/authorize');
  githubUrl.searchParams.set('client_id', c.env.GITHUB_CLIENT_ID);
  // The GitHub OAuth app's callback must be <SITE_ORIGIN>/auth/callback.
  githubUrl.searchParams.set('redirect_uri', `${siteOrigin(c.env)}/auth/callback`);
  githubUrl.searchParams.set('scope', 'read:user user:email');
  githubUrl.searchParams.set('state', state);

  return c.redirect(githubUrl.toString(), 302);
});

// GET /auth/cli — initiate CLI OAuth flow
auth.get('/cli', rateLimit(TIERS.oauth_init), async (c) => {
  const url = new URL(c.req.url);
  const portParam = url.searchParams.get('port');
  const clientState = url.searchParams.get('state') ?? '';

  if (!portParam) {
    return c.json({ error: 'port is required' }, 400);
  }

  const portNum = parseInt(portParam, 10);
  if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
    return c.json({ error: 'port must be an integer in [1024, 65535]' }, 400);
  }

  // With WorkOS on, the CLI signs in through AuthKit too (any method).
  if (workosEnabled(c.env)) {
    return startWorkosSignIn(c, { port: portNum, client_state: clientState });
  }

  const stateWorker = generateOpaqueId();

  try {
    await c.env.PAGES_KV.put(
      kvKeys.authState(stateWorker),
      JSON.stringify({ port: portNum, client_state: clientState }),
      { expirationTtl: 600 },
    );
  } catch (err) {
    console.error('Failed to write auth_state KV for CLI flow:', err);
    return c.json({ error: 'server error' }, 500);
  }

  setOAuthStateCookie(c, stateWorker);

  const githubUrl = new URL('https://github.com/login/oauth/authorize');
  githubUrl.searchParams.set('client_id', c.env.GITHUB_CLIENT_ID);
  // The GitHub OAuth app's callback must be <SITE_ORIGIN>/auth/callback.
  githubUrl.searchParams.set('redirect_uri', `${siteOrigin(c.env)}/auth/callback`);
  githubUrl.searchParams.set('scope', 'read:user user:email');
  githubUrl.searchParams.set('state', stateWorker);

  return c.redirect(githubUrl.toString(), 302);
});

// GET /auth/callback — GitHub OAuth callback
auth.get('/callback', rateLimit(TIERS.oauth_init), async (c) => {
  const url = new URL(c.req.url);
  const errorParam = url.searchParams.get('error');

  if (errorParam === 'access_denied') {
    return c.redirect('/?login_cancelled=1', 302);
  }
  if (errorParam !== null) {
    return c.redirect('/?login_failed=1', 302);
  }

  const urlState = url.searchParams.get('state');
  const cookieState = readOAuthStateCookie(c);

  if (!urlState || !cookieState) {
    return new Response(
      '<!DOCTYPE html><html><body><h1>Authentication Error</h1><p>Missing state parameter. Please try signing in again.</p></body></html>',
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  const statesMatch = constantTimeEqual(urlState, cookieState);
  if (!statesMatch) {
    return new Response(
      '<!DOCTYPE html><html><body><h1>Authentication Error</h1><p>State mismatch. Please try signing in again.</p></body></html>',
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  const authStateRaw = await c.env.PAGES_KV.get(kvKeys.authState(urlState));
  if (authStateRaw === null) {
    return new Response(
      '<!DOCTYPE html><html><body><h1>Authentication Error</h1><p>Session expired. Please try signing in again.</p></body></html>',
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  // Delete auth_state (one-shot)
  await c.env.PAGES_KV.delete(kvKeys.authState(urlState)).catch(() => {});

  let authState: AuthState & { provider?: string };
  try {
    authState = JSON.parse(authStateRaw) as typeof authState;
  } catch {
    return c.redirect('/?login_failed=1', 302);
  }
  // A state minted for the WorkOS flow can't finish here.
  if (authState.provider === 'workos') {
    return c.redirect('/?login_failed=state', 302);
  }

  const code = url.searchParams.get('code');
  if (!code) {
    return c.redirect('/?login_failed=1', 302);
  }

  const tokenResult = await exchangeCode(code, c.env);
  if (!tokenResult.ok) {
    if (tokenResult.reason === 'github_unavailable') {
      return c.redirect('/?login_failed=github_unavailable', 302);
    }
    return c.redirect('/?login_failed=1', 302);
  }

  let ghUser: { id: number; login: string; email: string | null; name: string | null };
  try {
    ghUser = await fetchUser(tokenResult.access_token);
  } catch {
    return c.redirect('/?login_failed=1', 302);
  }

  // Apply redactNoreplyEmail defensively (fetchUser already filters, but defense-in-depth)
  const safeEmail = redactNoreplyEmail(ghUser.email);
  let user;
  try {
    user = await resolveGithubSignIn(c.env, { ...ghUser, email: safeEmail });
  } catch (err) {
    console.error('Failed to upsert user record:', err);
    return c.redirect('/?login_failed=1', 302);
  }

  return finishSignIn(c, user, authState);
});

// POST /auth/cli/exchange — exchange one-time CLI code for JWT
auth.post('/cli/exchange', rateLimit(TIERS.oauth_init), async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid code' }, 400);
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return c.json({ error: 'invalid code' }, 400);
  }

  const { code, state } = body as Record<string, unknown>;

  if (typeof code !== 'string' || typeof state !== 'string') {
    return c.json({ error: 'invalid code' }, 400);
  }

  const cliCodeRaw = await c.env.PAGES_KV.get(kvKeys.cliCode(code));
  if (cliCodeRaw === null) {
    return c.json({ error: 'invalid code' }, 400);
  }

  let cliCodeData: { jwt: string; client_state: string };
  try {
    cliCodeData = JSON.parse(cliCodeRaw) as typeof cliCodeData;
  } catch {
    return c.json({ error: 'invalid code' }, 400);
  }

  // Constant-time compare body.state to stored client_state
  const statesMatch = constantTimeEqual(state, cliCodeData.client_state ?? '');
  if (!statesMatch) {
    return c.json({ error: 'invalid code' }, 400);
  }

  // Delete cli_code (one-shot)
  await c.env.PAGES_KV.delete(kvKeys.cliCode(code)).catch(() => {});

  const { jwt } = cliCodeData;

  // Verify JWT to extract user info (defensive — we just minted it)
  const result = await verifySession(jwt, c.env.SESSION_SECRET);
  if (!result.ok) {
    return c.json({ error: 'invalid code' }, 400);
  }

  const { claims } = result;
  return c.json({
    jwt,
    user: {
      id: claims.sub,
      login: claims.login,
      email: claims.email,
      name: claims.name,
    },
  });
});

// POST /auth/logout — revoke session
auth.post('/logout', requireAuth, requireCsrfHeader, async (c) => {
  const jti = c.get('jti');

  if (jti !== null) {
    // Re-read the token to get exp for TTL calculation
    const rawToken = readSessionCookie(c) ?? c.req.header(AUTH_HEADER) ?? '';
    if (rawToken) {
      const result = await verifySession(rawToken, c.env.SESSION_SECRET);
      if (result.ok) {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const remainingTtl = result.claims.exp - nowSeconds;
        if (remainingTtl > 0) {
          try {
            await c.env.PAGES_KV.put(
              kvKeys.revokedJti(jti),
              '1',
              { expirationTtl: remainingTtl },
            );
          } catch (err) {
            console.error('Failed to write revoked_jti on logout:', err);
          }
        }
      }
    }
  }

  clearSessionCookie(c);
  // Signed in through AuthKit: the browser also has to end the WorkOS session,
  // or the next "Log in" signs straight back in as the same person.
  const workosSession = readWorkosSessionCookie(c);
  if (workosSession !== null) {
    clearWorkosSessionCookie(c);
    if (workosEnabled(c.env)) return c.json({ ok: true, redirect: workosLogoutUrl(c.env, workosSession) });
  }
  return c.json({ ok: true });
});

// GET /auth/device — GitHub's device flow, for CLI versions before aired's own (POST /auth/device)
auth.get('/device', rateLimit(TIERS.oauth_init), async (c) => {
  let deviceResponse: Record<string, unknown>;
  try {
    deviceResponse = await requestDeviceCode(c.env);
  } catch {
    return c.json({ error: 'GitHub unavailable' }, 503);
  }

  const deviceCode = deviceResponse['device_code'];
  if (typeof deviceCode !== 'string') {
    return c.json({ error: 'GitHub unavailable' }, 503);
  }

  try {
    await c.env.PAGES_KV.put(
      kvKeys.deviceCode(deviceCode),
      JSON.stringify({ attempts: 0 }),
      { expirationTtl: 900 },
    );
  } catch (err) {
    console.error('Failed to write device_code KV:', err);
    return c.json({ error: 'server error' }, 500);
  }

  return c.json({
    user_code: deviceResponse['user_code'],
    verification_uri: deviceResponse['verification_uri'],
    interval: deviceResponse['interval'],
    device_code: deviceCode,
  });
});

// POST /auth/device/poll — poll device flow token
const githubPollLimit = rateLimit(TIERS.oauth_init);
auth.post('/device/poll', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid request' }, 400);
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return c.json({ error: 'invalid request' }, 400);
  }

  const { device_code } = body as Record<string, unknown>;

  if (typeof device_code !== 'string') {
    return c.json({ error: 'invalid request' }, 400);
  }

  // aired's own device codes (current CLIs); GitHub's for older ones.
  if (isNativeDeviceCode(device_code)) return pollNativeDevice(c, device_code);
  const limited = await githubPollLimit(c, async () => {});
  if (limited) return limited;

  const stateRaw = await c.env.PAGES_KV.get(kvKeys.deviceCode(device_code));
  if (stateRaw === null) {
    return c.json({ error: 'device_code_expired' }, 400);
  }

  let state: { attempts: number };
  try {
    state = JSON.parse(stateRaw) as typeof state;
  } catch {
    return c.json({ error: 'device_code_expired' }, 400);
  }

  const attempts = (state.attempts ?? 0) + 1;

  if (attempts >= 60) {
    return c.json({ error: 'max_attempts' }, 400);
  }

  const pollResult = await pollDeviceToken(device_code, c.env);

  if (pollResult.ok) {
    // Delete device_code (one-shot)
    await c.env.PAGES_KV.delete(kvKeys.deviceCode(device_code)).catch(() => {});

    let ghUser: { id: number; login: string; email: string | null; name: string | null };
    try {
      ghUser = await fetchUser(pollResult.access_token);
    } catch {
      return c.json({ error: 'github_error' }, 502);
    }

    const safeEmail = redactNoreplyEmail(ghUser.email);
    let user;
    try {
      user = await resolveGithubSignIn(c.env, { ...ghUser, email: safeEmail });
    } catch (err) {
      console.error('Failed to upsert user on device poll:', err);
      return c.json({ error: 'server error' }, 500);
    }

    let jwt: string;
    try {
      jwt = await signSession(
        { sub: user.id, login: user.login, email: user.email, name: user.name },
        c.env.SESSION_SECRET,
        CLI_SESSION_MAX_AGE_SECONDS,
        { kind: 'cli' },
      );
    } catch (err) {
      console.error('Failed to mint JWT on device poll:', err);
      return c.json({ error: 'server error' }, 500);
    }

    return c.json({
      jwt,
      user: {
        id: user.id,
        login: user.login,
        email: user.email,
        name: user.name,
      },
    });
  }

  if (pollResult.reason === 'authorization_pending') {
    // Update attempts count
    try {
      await c.env.PAGES_KV.put(
        kvKeys.deviceCode(device_code),
        JSON.stringify({ attempts }),
        { expirationTtl: 900 },
      );
    } catch {
      // Ignore KV write errors — will expire naturally
    }
    const response = c.json({ status: 'authorization_pending' }, 202);
    c.header('Retry-After', '2');
    return response;
  }

  return c.json({ error: pollResult.reason }, 400);
});

export { auth };
