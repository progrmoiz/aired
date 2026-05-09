import { redactNoreplyEmail } from '@aired/core';
import type { Env } from '../types.js';

type OkAccessToken = { ok: true; access_token: string; scope: string };
type ErrResult = { ok: false; reason: string };

/**
 * Exchange a GitHub OAuth authorization code for an access token.
 */
export async function exchangeCode(
  code: string,
  env: Env,
): Promise<OkAccessToken | ErrResult> {
  try {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    if (!res.ok) {
      return { ok: false, reason: 'github_unavailable' };
    }

    const data = await res.json() as Record<string, unknown>;

    if (typeof data['error'] === 'string') {
      return { ok: false, reason: data['error'] };
    }

    if (typeof data['access_token'] !== 'string') {
      return { ok: false, reason: 'no_access_token' };
    }

    return {
      ok: true,
      access_token: data['access_token'],
      scope: typeof data['scope'] === 'string' ? data['scope'] : '',
    };
  } catch {
    return { ok: false, reason: 'github_unavailable' };
  }
}

export type GitHubUser = {
  id: number;
  login: string;
  email: string | null;
  name: string | null;
};

/**
 * Fetch the authenticated GitHub user.
 * If email is null, falls back to fetchPrimaryEmail.
 */
export async function fetchUser(accessToken: string): Promise<GitHubUser> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': 'aired/1.0.0',
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub /user returned ${res.status}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const id = typeof data['id'] === 'number' ? data['id'] : 0;
  const login = typeof data['login'] === 'string' ? data['login'] : '';
  const name = typeof data['name'] === 'string' ? data['name'] : null;
  let email = typeof data['email'] === 'string' ? data['email'] : null;

  if (email === null) {
    email = await fetchPrimaryEmail(accessToken);
  }

  return { id, login, email: redactNoreplyEmail(email), name };
}

/**
 * Fetch the primary verified email from GitHub.
 * raw /user/emails response array MUST NOT be logged
 */
export async function fetchPrimaryEmail(accessToken: string): Promise<string | null> {
  const res = await fetch('https://api.github.com/user/emails', {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': 'aired/1.0.0',
    },
  });

  if (!res.ok) {
    return null;
  }

  const emails = await res.json() as unknown;

  if (!Array.isArray(emails)) {
    return null;
  }

  for (const entry of emails) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      entry['primary'] === true &&
      entry['verified'] === true &&
      typeof entry['email'] === 'string'
    ) {
      return redactNoreplyEmail(entry['email'] as string);
    }
  }

  return null;
}

/**
 * Request a device code from GitHub for the device flow.
 */
export async function requestDeviceCode(env: Env): Promise<Record<string, unknown>> {
  try {
    const res = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        scope: 'read:user user:email',
      }),
    });

    if (!res.ok) {
      throw new Error(`GitHub device code returned ${res.status}`);
    }

    return await res.json() as Record<string, unknown>;
  } catch {
    throw new Error('github_unavailable');
  }
}

type OkDeviceToken = { ok: true; access_token: string };
type ErrDeviceToken = { ok: false; reason: 'authorization_pending' | 'expired_token' | 'github_unavailable' | string };

/**
 * Poll for the device flow access token.
 */
export async function pollDeviceToken(
  deviceCode: string,
  env: Env,
): Promise<OkDeviceToken | ErrDeviceToken> {
  try {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    if (!res.ok) {
      return { ok: false, reason: 'github_unavailable' };
    }

    const data = await res.json() as Record<string, unknown>;

    if (typeof data['error'] === 'string') {
      const reason = data['error'] as string;
      if (reason === 'authorization_pending' || reason === 'expired_token') {
        return { ok: false, reason };
      }
      return { ok: false, reason };
    }

    if (typeof data['access_token'] !== 'string') {
      return { ok: false, reason: 'no_access_token' };
    }

    return { ok: true, access_token: data['access_token'] };
  } catch {
    return { ok: false, reason: 'github_unavailable' };
  }
}
