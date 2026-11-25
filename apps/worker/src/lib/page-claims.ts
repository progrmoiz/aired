import type { ClaimRecord } from './claim-decision.js';

/**
 * D1 `page_claims`: the owner and current token hash of every claimed page
 * (migrations/0003_page_claims.sql). KV page records are a cache of this for
 * claimed pages; every token check reads here first.
 */

type ClaimRow = {
  owner_id: number;
  token_hash: string;
  prev_token_hash: string;
  claimed_at: number;
};

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

/** First claim wins: returns false if the page already has a claim row. */
export async function insertClaim(
  db: D1Database,
  pageId: string,
  record: ClaimRecord,
): Promise<boolean> {
  const result = await db
    .prepare(
      'INSERT INTO page_claims (page_id, owner_id, token_hash, prev_token_hash, claimed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (page_id) DO NOTHING',
    )
    .bind(pageId, record.ownerId, record.tokenHash, record.prevTokenHash, record.claimedAt)
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

export async function deleteClaim(db: D1Database, pageId: string): Promise<void> {
  await db.prepare('DELETE FROM page_claims WHERE page_id = ?').bind(pageId).run();
}

export async function deleteClaimsForOwner(db: D1Database, ownerId: number): Promise<void> {
  await db.prepare('DELETE FROM page_claims WHERE owner_id = ?').bind(ownerId).run();
}

/** Which of these page ids this owner has claimed. */
export async function claimedIds(
  db: D1Database,
  ownerId: number,
  pageIds: string[],
): Promise<Set<string>> {
  if (pageIds.length === 0) return new Set();
  const placeholders = pageIds.map(() => '?').join(', ');
  const { results } = await db
    .prepare(`SELECT page_id FROM page_claims WHERE owner_id = ? AND page_id IN (${placeholders})`)
    .bind(ownerId, ...pageIds)
    .all<{ page_id: string }>();
  return new Set(results.map((r) => r.page_id));
}
