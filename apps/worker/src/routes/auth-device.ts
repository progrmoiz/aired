import { Hono, type Context } from 'hono';
import type { AppBindings } from '../types.js';
import { CLI_SESSION_MAX_AGE_SECONDS, hashToHex, kvKeys } from '@aired/core';
import { rateLimit } from '../middleware/rate-limit.js';
import { TIERS } from '../lib/rate-limit-tiers.js';
import { requireAuth, requireWebSession } from '../middleware/auth.js';
import { requireCsrfHeader } from '../middleware/csrf.js';
import { signSession } from '../lib/jwt.js';
import { siteOrigin } from '../lib/billing/webhook-plan.js';
import { loadUserRecord } from '../lib/user-record.js';
import {
  DEVICE_CODE_TTL_MS,
  DEVICE_POLL_INTERVAL,
  generateDeviceCode,
  generateUserCode,
  normalizeUserCode,
} from '../lib/device-code.js';
import { approveDeviceAuth, consumeDeviceAuth, createDeviceAuth, readDeviceAuth } from '../lib/device-auth.js';

/**
 * aired's own CLI device sign-in (Task 3.5), so `aired login --device` works
 * with any way of signing in, not only GitHub:
 * 1. POST /auth/device: the CLI gets a secret device code and a user code.
 * 2. The person opens aired.sh/device, signs in if needed, and approves the
 *    user code (POST /auth/device/approve).
 * 3. The CLI polls POST /auth/device/poll with the device code and gets a
 *    CLI session once it's approved. Old CLIs keep using GitHub's device flow
 *    (GET /auth/device); the poll route tells the two apart by the prefix.
 */
const authDevice = new Hono<AppBindings>();

// POST /auth/device — start a device sign-in.
authDevice.post('/device', rateLimit(TIERS.device_start), async (c) => {
  const deviceCode = generateDeviceCode();
  const deviceHash = await hashToHex(deviceCode);
  const now = Date.now();
  let userCode: string | null = null;
  try {
    for (let i = 0; i < 3 && userCode === null; i++) {
      const candidate = generateUserCode();
      if (await createDeviceAuth(c.env.DB, { deviceHash, userCode: candidate, now, expiresAt: now + DEVICE_CODE_TTL_MS })) {
        userCode = candidate;
      }
    }
  } catch (err) {
    console.error('Failed to store device code:', err);
    return c.json({ error: 'Could not start sign-in. Please try again.' }, 503);
  }
  if (userCode === null) return c.json({ error: 'Could not start sign-in. Please try again.' }, 503);

  const verificationUri = `${siteOrigin(c.env)}/device`;
  c.header('Cache-Control', 'no-store');
  return c.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?code=${userCode}`,
    interval: DEVICE_POLL_INTERVAL,
    expires_in: DEVICE_CODE_TTL_MS / 1000,
  });
});

// POST /auth/device/approve {user_code} — a signed-in person approves a code
// from aired.sh/device. Only the web session cookie counts: an API key or a
// CLI token mustn't be able to mint (or keep renewing) CLI sessions.
authDevice.post(
  '/device/approve',
  requireAuth,
  requireWebSession,
  requireCsrfHeader,
  rateLimit(TIERS.oauth_init),
  async (c) => {
    const body = (await c.req.json().catch(() => null)) as { user_code?: unknown } | null;
    const userCode = normalizeUserCode(body?.user_code);
    if (userCode === null) return c.json({ error: 'That isn’t a sign-in code. It looks like BCDF-GHJK.' }, 400);
    const userId = c.get('user')!.id;
    // The CLI session is minted from the account record: no record, no approval.
    if ((await loadUserRecord(c.env.PAGES_KV, userId)) === null) {
      return c.json({ error: 'Sign in again, then approve the code.' }, 403);
    }
    let approved: boolean;
    try {
      approved = await approveDeviceAuth(c.env.DB, userCode, userId, Date.now());
    } catch (err) {
      console.error('Failed to approve device code:', err);
      return c.json({ error: 'Could not approve the code. Please try again.' }, 503);
    }
    if (!approved) {
      return c.json({ error: 'That code is wrong, already used or expired. Run aired login --device again for a new one.' }, 404);
    }
    return c.json({ ok: true });
  },
);

const pollLimit = rateLimit(TIERS.device_poll);

/** The poll for an aired device code (routes/auth.ts sends it here by prefix). */
export async function pollNativeDevice(c: Context<AppBindings>, deviceCode: string): Promise<Response> {
  const limited = await pollLimit(c, async () => {});
  if (limited) return limited;

  const deviceHash = await hashToHex(deviceCode);
  const now = Date.now();
  let userId: number | null;
  try {
    const row = await readDeviceAuth(c.env.DB, deviceHash);
    if (row === null || row.expires_at <= now || row.consumed_at !== null) {
      return c.json({ error: 'device_code_expired' }, 400);
    }
    if (row.approved_user_id === null) {
      c.header('Retry-After', String(DEVICE_POLL_INTERVAL));
      return c.json({ status: 'authorization_pending' }, 202);
    }
    userId = await consumeDeviceAuth(c.env.DB, deviceHash, now);
  } catch (err) {
    console.error('Failed to read device code:', err);
    return c.json({ error: 'server error' }, 500);
  }
  // Collected by a poll that raced this one.
  if (userId === null) return c.json({ error: 'device_code_expired' }, 400);

  // The account was deleted after approving.
  const record = await loadUserRecord(c.env.PAGES_KV, userId);
  if (record === null) return c.json({ error: 'access_denied' }, 400);

  const user = { id: userId, login: record.login, email: record.email, name: record.name };
  let jwt: string;
  try {
    jwt = await signSession(
      { sub: user.id, login: user.login, email: user.email, name: user.name },
      c.env.SESSION_SECRET,
      CLI_SESSION_MAX_AGE_SECONDS,
    );
  } catch (err) {
    console.error('Failed to mint JWT on device poll:', err);
    return c.json({ error: 'server error' }, 500);
  }
  c.header('Cache-Control', 'no-store');
  return c.json({ jwt, user });
}

/** GET /device — the approval page, never inside someone else's frame. */
export async function devicePage(c: Context<AppBindings>): Promise<Response> {
  if (!c.env.ASSETS) return c.text('Not found', 404);
  const res = await c.env.ASSETS.fetch(c.req.raw);
  const headers = new Headers(res.headers);
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', "frame-ancestors 'none'");
  headers.set('Cache-Control', 'no-store');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export { authDevice };
