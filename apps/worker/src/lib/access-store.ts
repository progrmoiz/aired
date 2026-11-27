/**
 * D1 for "only these people" (migrations/0016_page_access.sql): the list,
 * the one-time codes and the owner's visit log. No imports, so tests run the
 * real SQL over node:sqlite.
 */

/** A page's list as stored: emails, and domains as `@domain`. */
export async function getAccessEntries(db: D1Database, pageId: string): Promise<string[]> {
  const res = await db.prepare("SELECT entry FROM page_access WHERE page_id = ? ORDER BY entry").bind(pageId).all<{ entry: string }>();
  return (res.results ?? []).map((r) => r.entry);
}

/**
 * Replace a page's list in one batch (one transaction), so a visitor never
 * sees half of the old list and half of the new one. Chunked inserts stay
 * under D1's 100 bound parameters.
 */
export async function replaceAccessList(db: D1Database, pageId: string, ownerId: number, entries: readonly string[], now: number): Promise<void> {
  const stmts: D1PreparedStatement[] = [db.prepare("DELETE FROM page_access WHERE page_id = ?").bind(pageId)];
  for (let i = 0; i < entries.length; i += 20) {
    const chunk = entries.slice(i, i + 20);
    stmts.push(
      db
        .prepare(`INSERT OR IGNORE INTO page_access (page_id, entry, owner_id, created_at) VALUES ${chunk.map(() => "(?, ?, ?, ?)").join(", ")}`)
        .bind(...chunk.flatMap((e) => [pageId, e, ownerId, now])),
    );
  }
  await db.batch(stmts);
}

/** The page isn't "only these people" any more: its list and live codes go. The visit log stays for the owner. */
export async function clearAccessList(db: D1Database, pageId: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM page_access WHERE page_id = ?").bind(pageId),
    db.prepare("DELETE FROM access_codes WHERE page_id = ?").bind(pageId),
  ]);
}

/** A new code for this page and email, replacing any earlier one (and its used-up tries). */
export async function putCode(db: D1Database, pageId: string, key: string, hash: string, expiresAt: number, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO access_codes (page_id, email_key, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)
       ON CONFLICT (page_id, email_key) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`,
    )
    .bind(pageId, key, hash, expiresAt, now)
    .run();
}

/**
 * Try a code. First one try is reserved (attempts + 1, only while the code
 * is live and has tries left), then a right code deletes the row. Both are
 * single statements, so parallel guesses can't take more than maxAttempts
 * tries between them, and a code works once even if sent twice at once.
 */
export async function useCode(
  db: D1Database,
  pageId: string,
  key: string,
  hash: string,
  now: number,
  maxAttempts: number,
): Promise<boolean> {
  const reserved = await db
    .prepare("UPDATE access_codes SET attempts = attempts + 1 WHERE page_id = ? AND email_key = ? AND expires_at > ? AND attempts < ? RETURNING attempts")
    .bind(pageId, key, now, maxAttempts)
    .first<{ attempts: number }>();
  if (reserved === null) return false;
  const used = await db
    .prepare("DELETE FROM access_codes WHERE page_id = ? AND email_key = ? AND code_hash = ? AND expires_at > ? RETURNING page_id")
    .bind(pageId, key, hash, now)
    .first<{ page_id: string }>();
  return used !== null;
}

/** A listed person opened the page: first visit adds them, later ones count. */
export async function recordVisit(db: D1Database, pageId: string, ownerId: number, email: string, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO access_log (page_id, email, owner_id, first_at, last_at, views) VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT (page_id, email) DO UPDATE SET last_at = excluded.last_at, views = access_log.views + 1`,
    )
    .bind(pageId, email, ownerId, now, now)
    .run();
}

export type Visitor = { email: string; firstAt: number; lastAt: number; views: number };

/** Who opened the page, most recent first. Owner only: the route checks. */
export async function listVisitors(db: D1Database, pageId: string, ownerId: number, max = 500): Promise<Visitor[]> {
  const res = await db
    .prepare("SELECT email, first_at, last_at, views FROM access_log WHERE page_id = ? AND owner_id = ? ORDER BY last_at DESC LIMIT ?")
    .bind(pageId, ownerId, max)
    .all<{ email: string; first_at: number; last_at: number; views: number }>();
  return (res.results ?? []).map((r) => ({ email: r.email, firstAt: r.first_at, lastAt: r.last_at, views: r.views }));
}

/** A page is deleted: its list, codes and visit log go with it. */
export async function deletePageAccessData(db: D1Database, pageId: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM page_access WHERE page_id = ?").bind(pageId),
    db.prepare("DELETE FROM access_codes WHERE page_id = ?").bind(pageId),
    db.prepare("DELETE FROM access_log WHERE page_id = ?").bind(pageId),
  ]);
}

/** Account deletion: statements for its batch (lib/billing/forget.ts). */
export function accountAccessDeletes(db: D1Database, uid: number): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM access_codes WHERE page_id IN (SELECT page_id FROM page_access WHERE owner_id = ?)").bind(uid),
    db.prepare("DELETE FROM page_access WHERE owner_id = ?").bind(uid),
    db.prepare("DELETE FROM access_log WHERE owner_id = ?").bind(uid),
  ];
}

/**
 * Housekeeping: codes past their expiry, and lists, codes and logs of pages
 * that are deleted, expired or have changed owner. Returns how many rows went.
 */
export async function pruneAccessData(db: D1Database, nowMs: number): Promise<number> {
  const gone = `SELECT id FROM pages WHERE deleted_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at <= ?)`;
  const results = await db.batch([
    db.prepare("DELETE FROM access_codes WHERE expires_at <= ?").bind(nowMs),
    db.prepare(`DELETE FROM access_codes WHERE page_id IN (${gone})`).bind(nowMs),
    db.prepare(`DELETE FROM page_access WHERE page_id IN (${gone})`).bind(nowMs),
    db.prepare(`DELETE FROM access_log WHERE page_id IN (${gone})`).bind(nowMs),
    db.prepare("DELETE FROM page_access WHERE page_id IN (SELECT a.page_id FROM page_access a JOIN pages p ON p.id = a.page_id WHERE p.owner_id IS NULL OR p.owner_id <> a.owner_id)"),
    db.prepare("DELETE FROM access_log WHERE page_id IN (SELECT l.page_id FROM access_log l JOIN pages p ON p.id = l.page_id WHERE p.owner_id IS NULL OR p.owner_id <> l.owner_id)"),
  ]);
  return results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
}
