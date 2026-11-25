/**
 * API keys in D1 (migration 0006). Only the SHA-256 of a key is stored; the
 * key itself is shown once, when it's created. Only type imports, so tests
 * run this against the real migration on node:sqlite.
 */

export const MAX_ACTIVE_KEYS = 5;
export const KEY_NAME_MAX = 60;
/** last_used_at is written at most this often per key. */
export const LAST_USED_EVERY_MS = 60 * 60 * 1000;

export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
};

/** A key name: trimmed, 1 to KEY_NAME_MAX characters, no control characters. */
export function normalizeKeyName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const n = name.trim();
  if (n.length === 0 || n.length > KEY_NAME_MAX) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(n)) return null;
  return n;
}

/** The active key with this hash: its id, owner and when it was last used. */
export async function findActiveKey(
  db: D1Database,
  keyHash: string,
): Promise<{ id: string; userId: number; lastUsedAt: number | null } | null> {
  const row = await db
    .prepare('SELECT id, user_id, last_used_at FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL')
    .bind(keyHash)
    .first<{ id: string; user_id: number; last_used_at: number | null }>();
  return row === null ? null : { id: row.id, userId: row.user_id, lastUsedAt: row.last_used_at };
}

/** Whether last_used_at is old enough to write again. */
export function lastUsedDue(lastUsedAt: number | null, now: number): boolean {
  return lastUsedAt === null || now - lastUsedAt >= LAST_USED_EVERY_MS;
}

export async function touchKey(db: D1Database, id: string, now: number): Promise<void> {
  await db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').bind(now, id).run();
}

export async function listKeys(db: D1Database, userId: number): Promise<ApiKeyRow[]> {
  const { results } = await db
    .prepare(
      'SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC',
    )
    .bind(userId)
    .all<{ id: string; name: string; prefix: string; created_at: number; last_used_at: number | null }>();
  return results.map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
}

/**
 * Store a new key unless the user already has MAX_ACTIVE_KEYS. The count and
 * the insert are one statement, so two parallel requests can't both get a
 * sixth key. False when the user is at the limit.
 */
export async function insertKey(
  db: D1Database,
  key: { id: string; userId: number; name: string; prefix: string; keyHash: string; createdAt: number },
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO api_keys (id, user_id, name, prefix, key_hash, created_at)
       SELECT ?, ?, ?, ?, ?, ?
       WHERE (SELECT count(*) FROM api_keys WHERE user_id = ? AND revoked_at IS NULL) < ?`,
    )
    .bind(key.id, key.userId, key.name, key.prefix, key.keyHash, key.createdAt, key.userId, MAX_ACTIVE_KEYS)
    .run();
  return result.meta.changes === 1;
}

/** Revoke one of the user's keys. False if there's no such active key. */
export async function revokeKey(db: D1Database, userId: number, id: string, now: number): Promise<boolean> {
  const result = await db
    .prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(now, id, userId)
    .run();
  return result.meta.changes === 1;
}
