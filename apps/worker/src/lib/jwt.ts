import { SignJWT, jwtVerify } from 'jose';
import { SESSION_MAX_AGE_SECONDS } from '@aired/core';
import { generateOpaqueId, isValidUUID } from '@aired/core';
import type { JwtClaims } from '@aired/core';

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

/**
 * 'web': the website's session cookie (30 days, sliding). 'cli': a CLI token
 * (365 days). Only a 'web' token in the cookie counts as the website
 * (requireWebSession); a CLI token can't be promoted by sending it as a cookie.
 */
export type SessionKind = 'web' | 'cli';

/** The session claims plus what this worker adds. */
export type SessionClaims = JwtClaims & {
  kind: SessionKind;
  /** When the person actually signed in (Unix seconds), kept across reissues. Per-account revocation compares against it. */
  authTime: number;
};

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/**
 * Sign a new session JWT (HS256).
 * Sets iat, exp, jti, and v:1. Claims are embedded as custom fields.
 */
export async function signSession(
  claims: Omit<JwtClaims, 'iat' | 'exp' | 'jti' | 'v'>,
  secret: string,
  maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS,
  opts: { kind?: SessionKind; authTime?: number } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jti = generateOpaqueId();
  const kind: SessionKind = opts.kind ?? (maxAgeSeconds > SESSION_MAX_AGE_SECONDS ? 'cli' : 'web');

  return new SignJWT({
    sub: String(claims.sub),
    login: claims.login,
    email: claims.email,
    name: claims.name,
    jti,
    v: 1,
    kind,
    auth_time: opts.authTime ?? now,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + maxAgeSeconds)
    .sign(secretKey(secret));
}

export type VerifyResult =
  | { ok: true; claims: SessionClaims }
  | { ok: false; reason: string };

/**
 * Verify a session JWT. Never throws.
 * Returns { ok: false, reason } for all error cases including:
 * - non-string input
 * - malformed (0, 2, 4 segments)
 * - bad signature / wrong algorithm
 * - expired
 * - malformed jti
 * - v !== 1
 */
export async function verifySession(
  token: unknown,
  secret: string,
): Promise<VerifyResult> {
  if (typeof token !== 'string') {
    return { ok: false, reason: 'not_a_string' };
  }
  if (token === '') {
    return { ok: false, reason: 'empty_token' };
  }

  const segments = token.split('.');
  if (segments.length !== 3) {
    return { ok: false, reason: `invalid_segment_count:${segments.length}` };
  }

  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      algorithms: ['HS256'],
    });

    // Extract and validate claims
    const sub = typeof payload['sub'] === 'string' ? parseInt(payload['sub'], 10) : NaN;
    const login = payload['login'];
    const email = payload['email'];
    const name = payload['name'];
    const jti = payload['jti'];
    const iat = payload['iat'];
    const exp = payload['exp'];
    const v = payload['v'];

    if (
      isNaN(sub) ||
      typeof login !== 'string' ||
      (email !== null && email !== undefined && typeof email !== 'string') ||
      (name !== null && name !== undefined && typeof name !== 'string') ||
      typeof jti !== 'string' ||
      typeof iat !== 'number' ||
      typeof exp !== 'number'
    ) {
      return { ok: false, reason: 'invalid_claims' };
    }

    if (!isValidUUID(jti)) {
      return { ok: false, reason: 'invalid_jti' };
    }

    if (v !== 1) {
      return { ok: false, reason: 'unsupported_version' };
    }

    // Tokens from before these claims: a lifetime past the web session's
    // 30 days means a CLI token; the sign-in time is unknown, so iat stands in.
    const rawKind = payload['kind'];
    const kind: SessionKind =
      rawKind === 'web' || rawKind === 'cli' ? rawKind : exp - iat > SESSION_MAX_AGE_SECONDS ? 'cli' : 'web';
    const rawAuthTime = payload['auth_time'];
    const authTime = typeof rawAuthTime === 'number' && rawAuthTime <= iat ? rawAuthTime : iat;

    const claims: SessionClaims = {
      sub,
      login,
      email: typeof email === 'string' ? email : null,
      name: typeof name === 'string' ? name : null,
      iat,
      exp,
      jti,
      v: 1,
      kind,
      authTime,
    };

    return { ok: true, claims };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: message };
  }
}

/**
 * Return true when the token is in its sliding-reissue window:
 * more than 7 days old AND not yet expired.
 */
export function shouldReissue(claims: JwtClaims, now: number): boolean {
  const nowSeconds = Math.floor(now / 1000);
  const ageSeconds = nowSeconds - claims.iat;
  return ageSeconds > SEVEN_DAYS_SECONDS && nowSeconds < claims.exp;
}
