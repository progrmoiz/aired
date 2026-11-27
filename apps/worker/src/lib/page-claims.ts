import type { ClaimRecord } from './claim-decision.js';

/**
 * D1 `page_claims`: the owner and current token hash of pages claimed before
 * D1 `pages` (migrations/0003_page_claims.sql). Retired: `pages` holds the
 * owner and token now, and nothing writes here any more. It's still read
 * for a page that somehow has no `pages` row yet (lib/pages-store.ts
 * ensurePageRow) and to find such pages on account deletion. The write
 * helpers left below are for tests that build that old state. Only type
 * imports here, so tests can load it.
 *
 * Every query fails if migration 0003 isn't applied, and token checks then
 * fail closed. `npm run deploy` applies migrations before deploying.
 */

type ClaimRow = {
  owner_id: number | null;
  token_hash: string;
  prev_token_hash: string;
  claimed_at: number;
};

/** Hash stored for a deleted page. hashToken returns hex, so nothing matches it. */
export const DELETED_TOKEN_HASH = 'deleted';

export async function getClaim(db: D1Database, pageId: string): Promise<ClaimRecord | null> {
  const row = await db
    .prepare('SELECT owner_id, token_hash, prev_token_hash, claimed_at FROM page_claims WHERE page_id = ?')
    .bind(pageId)
    .first<ClaimRow>();
  if (row === null) return null;
  return {
    ownerId: row.owner_id,
    tokenHash: row.token_hash,
    prevTokenHash: row.prev_token_hash,
    claimedAt: row.claimed_at,
  };
}

/**
 * Record a claim. Inserts a row, or takes over a released one (owner_id
 * NULL) whose hash is still `checkedHash`, the hash the token was verified
 * against. Returns false if the row changed or someone holds the page: the
 * first claim wins.
 */
export async function upsertClaim(
  db: D1Database,
  pageId: string,
  record: ClaimRecord & { ownerId: number },
  checkedHash: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO page_claims (page_id, owner_id, token_hash, prev_token_hash, claimed_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (page_id) DO UPDATE SET
         owner_id = excluded.owner_id,
         token_hash = excluded.token_hash,
         prev_token_hash = excluded.prev_token_hash,
         claimed_at = excluded.claimed_at
       WHERE page_claims.owner_id IS NULL
         AND page_claims.token_hash = ?
         AND page_claims.token_hash <> ?`,
    )
    .bind(pageId, record.ownerId, record.tokenHash, record.prevTokenHash, record.claimedAt, checkedHash, DELETED_TOKEN_HASH)
    .run();
  return result.meta.changes === 1;
}

/** Replace the token of a page this owner holds. False if they don't hold it. */
export async function replaceClaimToken(
  db: D1Database,
  pageId: string,
  ownerId: number,
  tokenHash: string,
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE page_claims SET token_hash = ? WHERE page_id = ? AND owner_id = ?')
    .bind(tokenHash, pageId, ownerId)
    .run();
  return result.meta.changes === 1;
}

/**
 * Every deleted page, claimed or not, keeps a row that no token and no owner
 * matches, so a stale KV copy can't be updated or claimed back to life.
 */
export async function tombstoneClaim(db: D1Database, pageId: string, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO page_claims (page_id, owner_id, token_hash, prev_token_hash, claimed_at)
       VALUES (?, NULL, ?, ?, ?)
       ON CONFLICT (page_id) DO UPDATE SET owner_id = NULL, token_hash = excluded.token_hash, prev_token_hash = excluded.prev_token_hash`,
    )
    .bind(pageId, DELETED_TOKEN_HASH, DELETED_TOKEN_HASH, now)
    .run();
}

/**
 * The pages page_claims says this owner claimed: on account deletion, the
 * way to find a page from before D1 `pages` that has no row there yet. Reads
 * only; the page's `pages` row is what gets released.
 */
export async function claimedPageIds(db: D1Database, ownerId: number): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT page_id FROM page_claims WHERE owner_id = ?')
    .bind(ownerId)
    .all<{ page_id: string }>();
  return results.map((r) => r.page_id);
}

/** D1 allows 100 bound parameters per query; one goes to the owner id. */
const IDS_PER_QUERY = 90;

/** Which of these page ids this owner has claimed. */
export async function claimedIds(
  db: D1Database,
  ownerId: number,
  pageIds: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < pageIds.length; i += IDS_PER_QUERY) {
    const chunk = pageIds.slice(i, i + IDS_PER_QUERY);
    const placeholders = chunk.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT page_id FROM page_claims WHERE owner_id = ? AND page_id IN (${placeholders})`)
      .bind(ownerId, ...chunk)
      .all<{ page_id: string }>();
    for (const r of results) found.add(r.page_id);
  }
  return found;
}
