import type { ClaimRecord } from './claim-decision.js';

/**
 * D1 `page_claims`: the owner and current token hash of every claimed page
 * (migrations/0003_page_claims.sql). KV page records are a cache of this for
 * claimed pages; every token check reads here first. Rows are released or
 * tombstoned, never deleted. Only type imports here, so tests can load it.
 */

type ClaimRow = {
  owner_id: number | null;
  token_hash: string;
  prev_token_hash: string;
  claimed_at: number;
};

/** Hash stored for a deleted page. hashToken returns hex, so nothing matches it. */
export const DELETED_TOKEN_HASH = 'deleted';

/**
 * Before migration 0003 is applied there is no table, and so no claims: read
 * paths treat that as "no row" instead of failing every update. Writes still
 * fail, so nothing can be claimed until the migration is in.
 */
function isMissingTable(err: unknown): boolean {
  return err instanceof Error && /no such table: page_claims/.test(err.message);
}

export async function getClaim(db: D1Database, pageId: string): Promise<ClaimRecord | null> {
  let row: ClaimRow | null;
  try {
    row = await db
      .prepare('SELECT owner_id, token_hash, prev_token_hash, claimed_at FROM page_claims WHERE page_id = ?')
      .bind(pageId)
      .first<ClaimRow>();
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
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
 * NULL). Returns false if someone holds the page: the first claim wins.
 */
export async function upsertClaim(
  db: D1Database,
  pageId: string,
  record: ClaimRecord & { ownerId: number },
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
       WHERE page_claims.owner_id IS NULL AND page_claims.token_hash <> ?`,
    )
    .bind(pageId, record.ownerId, record.tokenHash, record.prevTokenHash, record.claimedAt, DELETED_TOKEN_HASH)
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

/** A deleted page keeps a row that no token and no owner matches. */
export async function tombstoneClaim(db: D1Database, pageId: string): Promise<void> {
  try {
    await db
      .prepare('UPDATE page_claims SET owner_id = NULL, token_hash = ?, prev_token_hash = ? WHERE page_id = ?')
      .bind(DELETED_TOKEN_HASH, DELETED_TOKEN_HASH, pageId)
      .run();
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }
}

/**
 * Account deletion: the owner's claimed pages become anonymous, keeping their
 * rotated token hash. Returns page id → token hash, for mirroring into KV.
 */
export async function releaseClaimsForOwner(
  db: D1Database,
  ownerId: number,
): Promise<Map<string, string>> {
  try {
    const { results } = await db
      .prepare('UPDATE page_claims SET owner_id = NULL WHERE owner_id = ? RETURNING page_id, token_hash')
      .bind(ownerId)
      .all<{ page_id: string; token_hash: string }>();
    return new Map(results.map((r) => [r.page_id, r.token_hash]));
  } catch (err) {
    if (isMissingTable(err)) return new Map();
    throw err;
  }
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
  try {
    for (let i = 0; i < pageIds.length; i += IDS_PER_QUERY) {
      const chunk = pageIds.slice(i, i + IDS_PER_QUERY);
      const placeholders = chunk.map(() => '?').join(', ');
      const { results } = await db
        .prepare(`SELECT page_id FROM page_claims WHERE owner_id = ? AND page_id IN (${placeholders})`)
        .bind(ownerId, ...chunk)
        .all<{ page_id: string }>();
      for (const r of results) found.add(r.page_id);
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }
  return found;
}
