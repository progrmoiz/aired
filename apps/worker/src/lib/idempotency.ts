/**
 * Idempotency keys for POST /api/publish (middleware/idempotency.ts). A
 * client sends `Idempotency-Key: <any string, up to 255 characters>` and may
 * retry the same request with it for 24 hours: the first answer comes back
 * again (with `Idempotent-Replayed: true`) instead of a second page. The
 * same key with a different body is a 422.
 *
 * Keys live in D1 (migrations/0019_idempotency_keys.sql), scoped to who
 * sent them: the account when signed in, else the sender's network (the IP,
 * or an IPv6 /64). Only hashes are stored; the saved answer, which holds the
 * page's update token, is encrypted with a key derived from the
 * Idempotency-Key, so D1 alone can't give it back.
 *
 * Only 2xx answers are saved. A failed request (bad input, a rate limit, a
 * storage error) gives its key back, so the client can fix it and retry
 * with the same key. A reservation whose request never finished (a crashed
 * isolate) is taken over after a minute.
 */

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** How long a reservation with no answer yet blocks retries before one may take it over. */
export const PENDING_TIMEOUT_MS = 60 * 1000;
export const MAX_KEY_LENGTH = 255;

/** 1 to 255 printable ASCII characters, not all spaces. */
export function validIdempotencyKey(key: string): boolean {
  return key.length > 0 && key.length <= MAX_KEY_LENGTH && /^[\x20-\x7e]+$/.test(key) && key.trim() !== "";
}

const enc = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

export type KeyRef = { keyHash: string; secret: CryptoKey };

/** The row's id and the answer's encryption key, each from the scope and key under its own label. */
export async function keyRef(scope: string, key: string): Promise<KeyRef> {
  const keyHash = await sha256Hex(`aired-idempotency-id-v1\0${scope}\0${key}`);
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`aired-idempotency-enc-v1\0${scope}\0${key}`));
  const secret = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  return { keyHash, secret };
}

export type SavedAnswer = { status: number; body: string };

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));
}

async function seal(ref: KeyRef, answer: SavedAnswer): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, ref.secret, enc.encode(JSON.stringify(answer))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toBase64(out);
}

async function open(ref: KeyRef, sealed: string): Promise<SavedAnswer> {
  const bytes = fromBase64(sealed);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, ref.secret, bytes.slice(12));
  return JSON.parse(new TextDecoder().decode(plain)) as SavedAnswer;
}

export type KeyState =
  | { state: "reserved" }
  | { state: "pending" }
  | { state: "mismatch" }
  | { state: "done"; answer: SavedAnswer };

/**
 * Reserve the key for this body, or say what it already holds. A row past
 * 24 hours, or a reservation left unanswered for a minute, is taken over.
 */
export async function reserveKey(db: D1Database, ref: KeyRef, bodyHash: string, now: number): Promise<KeyState> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const taken = await db
      .prepare(
        `INSERT INTO idempotency_keys (key_hash, body_hash, status, response, created_at) VALUES (?, ?, NULL, NULL, ?)
         ON CONFLICT (key_hash) DO UPDATE SET body_hash = excluded.body_hash, status = NULL, response = NULL, created_at = excluded.created_at
         WHERE idempotency_keys.created_at <= ? OR (idempotency_keys.status IS NULL AND idempotency_keys.created_at <= ?)`,
      )
      .bind(ref.keyHash, bodyHash, now, now - IDEMPOTENCY_TTL_MS, now - PENDING_TIMEOUT_MS)
      .run();
    if ((taken.meta.changes ?? 0) > 0) return { state: "reserved" };
    const row = await db
      .prepare("SELECT body_hash, status, response FROM idempotency_keys WHERE key_hash = ?")
      .bind(ref.keyHash)
      .first<{ body_hash: string; status: number | null; response: string | null }>();
    // Released between the two statements: try the reservation once more.
    if (row === null) continue;
    if (row.body_hash !== bodyHash) return { state: "mismatch" };
    if (row.status === null || row.response === null) return { state: "pending" };
    return { state: "done", answer: await open(ref, row.response) };
  }
  return { state: "pending" };
}

/** Save the first request's answer under its reservation. */
export async function saveAnswer(db: D1Database, ref: KeyRef, answer: SavedAnswer): Promise<void> {
  await db
    .prepare("UPDATE idempotency_keys SET status = ?, response = ? WHERE key_hash = ? AND status IS NULL")
    .bind(answer.status, await seal(ref, answer), ref.keyHash)
    .run();
}

/** Give the key back after a request that failed, so a retry runs it again. */
export async function releaseKey(db: D1Database, ref: KeyRef): Promise<void> {
  await db.prepare("DELETE FROM idempotency_keys WHERE key_hash = ? AND status IS NULL").bind(ref.keyHash).run();
}

/** Rows older than 24 hours, for hourly housekeeping. Returns how many went. */
export async function pruneIdempotencyKeys(db: D1Database, now: number): Promise<number> {
  const res = await db.prepare("DELETE FROM idempotency_keys WHERE created_at <= ?").bind(now - IDEMPOTENCY_TTL_MS).run();
  return res.meta.changes ?? 0;
}
