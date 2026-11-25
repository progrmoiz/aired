/**
 * Codes for aired's own CLI device sign-in (Task 3.5). The CLI keeps the
 * device code secret and polls with it; the person types the short user code
 * on aired.sh/device. No imports, so tests load it directly.
 */

/** Device codes from aired start with this; GitHub's never do. */
export const NATIVE_DEVICE_PREFIX = 'aired_dc_';
/** How long a code can be approved and collected. */
export const DEVICE_CODE_TTL_MS = 10 * 60 * 1000;
/** Seconds the CLI waits between polls. */
export const DEVICE_POLL_INTERVAL = 5;

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
// No vowels (no words), no 0/O or 1/I lookalikes. 20^8 codes.
const USER_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';

function pick(alphabet: string, n: number): string {
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) {
      if (b < limit && out.length < n) out += alphabet[b % alphabet.length];
    }
  }
  return out;
}

export function isNativeDeviceCode(code: string): boolean {
  return code.startsWith(NATIVE_DEVICE_PREFIX);
}

export function generateDeviceCode(): string {
  return NATIVE_DEVICE_PREFIX + pick(BASE62, 40);
}

/** e.g. "BCDF-GHJK". */
export function generateUserCode(): string {
  const s = pick(USER_ALPHABET, 8);
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** What a person typed, as "XXXX-XXXX", or null if it can't be a user code. */
export function normalizeUserCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== 8) return null;
  for (const ch of s) if (!USER_ALPHABET.includes(ch)) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
