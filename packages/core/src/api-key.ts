/**
 * API keys: `aired_sk_` + 32 random base62 characters + a 6-character base62
 * CRC32 of those 32. The checksum lets the server (and secret scanners) reject
 * a mistyped or made-up key without a database lookup. Only a SHA-256 hash of
 * the whole key is stored server-side.
 *
 * No imports, so the worker tests load this file directly.
 */

export const API_KEY_PREFIX = 'aired_sk_';
const BODY_LENGTH = 32;
const CHECKSUM_LENGTH = 6;
export const API_KEY_LENGTH = API_KEY_PREFIX.length + BODY_LENGTH + CHECKSUM_LENGTH;

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const KEY_SHAPE = new RegExp(`^${API_KEY_PREFIX}[0-9A-Za-z]{${BODY_LENGTH + CHECKSUM_LENGTH}}$`);

let crcTable: Uint32Array | null = null;

/** CRC-32 (IEEE). Exported for its known-answer test only. */
export function crc32(text: string): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < text.length; i++) crc = crcTable[(crc ^ text.charCodeAt(i)) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function checksum(body: string): string {
  let n = crc32(body);
  let out = '';
  for (let i = 0; i < CHECKSUM_LENGTH; i++) {
    out = BASE62[n % 62] + out;
    n = Math.floor(n / 62);
  }
  return out;
}

/** Uniform random base62 characters (rejection sampling, no modulo bias). */
function randomBase62(length: number): string {
  let out = '';
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < 248) out += BASE62[byte % 62]; // 248 = 4 * 62
      if (out.length === length) break;
    }
  }
  return out;
}

/** A new API key. Show it once; store only its SHA-256 (hashToHex). */
export function generateApiKey(): string {
  const body = randomBase62(BODY_LENGTH);
  return `${API_KEY_PREFIX}${body}${checksum(body)}`;
}

/** Whether a string is shaped like an API key and its checksum matches. */
export function parseApiKey(value: unknown): { ok: true; key: string } | { ok: false } {
  if (typeof value !== 'string' || !KEY_SHAPE.test(value)) return { ok: false };
  const body = value.slice(API_KEY_PREFIX.length, API_KEY_PREFIX.length + BODY_LENGTH);
  const sum = value.slice(API_KEY_PREFIX.length + BODY_LENGTH);
  return checksum(body) === sum ? { ok: true, key: value } : { ok: false };
}

/** What the dashboard shows for a key: the prefix and its first 4 random characters. */
export function apiKeyDisplayPrefix(key: string): string {
  return key.slice(0, API_KEY_PREFIX.length + 4);
}
