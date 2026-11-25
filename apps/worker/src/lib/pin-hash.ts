/**
 * Page PINs, stored hashed. No imports (Web Crypto only), so tests load it.
 *
 * Stored value: `pbkdf2-sha256$<iterations>$<salt>$<hash>` (salt and hash
 * base64url, 16 and 32 bytes). Older pages hold the PIN as typed; verifyPin
 * accepts those and says to rewrite them as a hash.
 *
 * Iterations: Workers allows at most 100,000 for PBKDF2, and on the free plan
 * a request gets 10 ms of CPU. 20,000 takes about 5 ms. A PIN is short, so
 * the hash mainly keeps it out of storage and logs; it's not a password.
 * The count is in the stored value, so it can be raised later: verifyPin
 * asks for a rehash when a stored count is below PIN_ITERATIONS.
 *
 * The `pin_<id>` cookie holds an HMAC token over the page id and an expiry,
 * never the PIN.
 */

const PREFIX = 'pbkdf2-sha256';
export const PIN_ITERATIONS = 20_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;
/** Workers' PBKDF2 ceiling: never trust a stored count above it. */
const MAX_ITERATIONS = 100_000;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Compare two byte strings in time that depends only on their lengths. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, HASH_BITS);
  return new Uint8Array(bits);
}

/** Hash a PIN for storage, with a fresh random salt. */
export async function hashPin(pin: string, iterations = PIN_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return `${PREFIX}$${iterations}$${b64url(salt)}$${b64url(await derive(pin, salt, iterations))}`;
}

/** Whether a stored value is in the hash format (else it's a PIN as typed). */
export function isPinHash(stored: string): boolean {
  return stored.startsWith(`${PREFIX}$`);
}

/**
 * Check a typed PIN against the stored value. `needsRehash` is true when the
 * stored value is a plain PIN or uses fewer iterations than PIN_ITERATIONS:
 * on a correct entry, store hashPin(input) instead.
 */
export async function verifyPin(input: string, stored: string): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (!isPinHash(stored)) {
    const ok = sameBytes(enc.encode(input), enc.encode(stored));
    return { ok, needsRehash: ok };
  }
  const parts = stored.split('$');
  if (parts.length !== 4) return { ok: false, needsRehash: false };
  const iterations = Number(parts[1]);
  const salt = fromB64url(parts[2]!);
  const expected = fromB64url(parts[3]!);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS || !salt || !expected) {
    return { ok: false, needsRehash: false };
  }
  const ok = sameBytes(await derive(input, salt, iterations), expected);
  return { ok, needsRehash: ok && iterations < PIN_ITERATIONS };
}

async function cookieMac(secret: string, pageId: string, expSec: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  // A purpose label keeps this MAC apart from anything else signed with the secret.
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`aired-pin-cookie:v1:${pageId}:${expSec}`));
  return new Uint8Array(sig);
}

/** The `pin_<id>` cookie value: `<expiry seconds>.<HMAC>`. */
export async function pinCookieValue(secret: string, pageId: string, expSec: number): Promise<string> {
  return `${expSec}.${b64url(await cookieMac(secret, pageId, expSec))}`;
}

/** Whether a `pin_<id>` cookie is a valid, unexpired token for this page. */
export async function verifyPinCookie(
  secret: string,
  pageId: string,
  cookie: string | null | undefined,
  nowSec: number,
): Promise<boolean> {
  if (!cookie) return false;
  const dot = cookie.indexOf('.');
  if (dot <= 0) return false;
  const expPart = cookie.slice(0, dot);
  if (!/^\d{1,12}$/.test(expPart)) return false;
  const expSec = Number(expPart);
  if (expSec <= nowSec) return false;
  const given = fromB64url(cookie.slice(dot + 1));
  if (!given) return false;
  return sameBytes(given, await cookieMac(secret, pageId, expSec));
}
