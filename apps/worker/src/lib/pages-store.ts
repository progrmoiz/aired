import type { PageMetadata } from '@aired/core';
import type { ClaimRecord } from './claim-decision.ts';
import { DELETED_TOKEN_HASH, getClaim } from './page-claims.ts';

/**
 * D1 `pages` (migrations/0010_pages.sql): the source of truth for a page's
 * facts, owner and update token. Every write path writes here first; the KV
 * record `page:<id>` is the viewer's read cache (and still holds the view
 * count), and owner lists and project counts are queries here, not KV
 * indexes.
 *
 * Pages from before this table get their row the first time anything
 * touches them (resolvePage → ensurePageRow), built from the KV record and
 * any `page_claims` row, and the backfill (lib/pages-backfill.ts) inserts the
 * rest. Both only ever INSERT OR IGNORE: a row that exists always wins, so a
 * stale KV record can't overwrite it.
 *
 * No runtime imports beyond page-claims.ts (itself import-free), so tests
 * run the real SQL over node:sqlite.
 */

export type PageRow = {
  id: string;
  ownerId: number | null;
  workspaceId: number | null;
  project: string | null;
  title: string | null;
  size: number;
  tokenHash: string;
  prevTokenHash: string | null;
  /** Unix ms of the claim that gave the page its owner, or null. */
  claimedAt: number | null;
  pin: string | null;
  reads: number | null;
  permanent: boolean;
  /** Unix ms. */
  createdAt: number;
  expiresAt: number | null;
  deletedAt: number | null;
  updatedAt: number;
  /** 'people': only the listed people may open it (migrations/0016_page_access.sql). Null: public or PIN. */
  access: 'people' | null;
};

type DbRow = {
  id: string;
  owner_id: number | null;
  workspace_id: number | null;
  project: string | null;
  title: string | null;
  size: number;
  token_hash: string;
  prev_token_hash: string | null;
  claimed_at: number | null;
  pin: string | null;
  reads: number | null;
  permanent: number;
  created_at: number;
  expires_at: number | null;
  deleted_at: number | null;
  updated_at: number;
  access: string | null;
};

const COLUMNS =
  'id, owner_id, workspace_id, project, title, size, token_hash, prev_token_hash, claimed_at, pin, reads, permanent, created_at, expires_at, deleted_at, updated_at, access';

function fromDb(r: DbRow): PageRow {
  return {
    id: r.id,
    ownerId: r.owner_id,
    workspaceId: r.workspace_id,
    project: r.project,
    title: r.title,
    size: r.size,
    tokenHash: r.token_hash,
    prevTokenHash: r.prev_token_hash,
    claimedAt: r.claimed_at,
    pin: r.pin,
    reads: r.reads,
    permanent: r.permanent === 1,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    deletedAt: r.deleted_at,
    updatedAt: r.updated_at,
    access: r.access === 'people' ? 'people' : null,
  };
}

function toDb(row: PageRow): DbRow {
  return {
    id: row.id,
    owner_id: row.ownerId,
    workspace_id: row.workspaceId,
    project: row.project,
    title: row.title,
    size: row.size,
    token_hash: row.tokenHash,
    prev_token_hash: row.prevTokenHash,
    claimed_at: row.claimedAt,
    pin: row.pin,
    reads: row.reads,
    permanent: row.permanent ? 1 : 0,
    created_at: row.createdAt,
    expires_at: row.expiresAt,
    deleted_at: row.deletedAt,
    updated_at: row.updatedAt,
    access: row.access,
  };
}

const parseTime = (iso: string | null): number | null => {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
};
const isoOrNull = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/**
 * The row for a page that only has a KV record so far. A `page_claims` row,
 * when there is one, decides the owner and token (as it did before this
 * table), and a tombstoned claim makes the row a deleted one.
 */
export function rowFromMetadata(meta: PageMetadata, claim: ClaimRecord | null, now: number): PageRow {
  const tombstoned = claim !== null && claim.tokenHash === DELETED_TOKEN_HASH;
  return {
    id: meta.id,
    ownerId: claim !== null ? claim.ownerId : meta.ownerId,
    workspaceId: null,
    project: meta.project,
    title: meta.title,
    size: meta.size,
    tokenHash: claim !== null ? claim.tokenHash : meta.tokenHash,
    prevTokenHash: claim !== null && !tombstoned ? claim.prevTokenHash : null,
    claimedAt: claim !== null && !tombstoned ? claim.claimedAt : null,
    pin: meta.pin,
    reads: meta.reads,
    permanent: meta.permanent,
    createdAt: parseTime(meta.createdAt) ?? now,
    expiresAt: meta.permanent ? null : parseTime(meta.expiresAt),
    deletedAt: tombstoned ? now : null,
    updatedAt: now,
    access: meta.access === 'people' ? 'people' : null,
  };
}

/** A KV cache record for a row: when the cache entry is missing, or to refresh it. */
export function metadataFromRow(row: PageRow, readCount: number): PageMetadata {
  return {
    id: row.id,
    title: row.title,
    size: row.size,
    tokenHash: row.tokenHash,
    pin: row.pin,
    reads: row.reads,
    readCount,
    permanent: row.permanent,
    createdAt: new Date(row.createdAt).toISOString(),
    expiresAt: isoOrNull(row.expiresAt),
    ownerId: row.ownerId,
    project: row.project,
    access: row.access,
  };
}

/** Not deleted and not past its expiry. */
export function isLive(row: PageRow, now: number): boolean {
  return row.deletedAt === null && (row.expiresAt === null || row.expiresAt > now);
}

export async function getPageRow(db: D1Database, id: string): Promise<PageRow | null> {
  const r = await db.prepare(`SELECT ${COLUMNS} FROM pages WHERE id = ?`).bind(id).first<DbRow>();
  return r === null ? null : fromDb(r);
}

/** Insert a new page. False if the id already has a row (which is kept). */
export async function insertPageRow(db: D1Database, row: PageRow): Promise<boolean> {
  const v = toDb(row);
  const result = await db
    .prepare(`INSERT OR IGNORE INTO pages (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(v.id, v.owner_id, v.workspace_id, v.project, v.title, v.size, v.token_hash, v.prev_token_hash, v.claimed_at, v.pin, v.reads, v.permanent, v.created_at, v.expires_at, v.deleted_at, v.updated_at, v.access)
    .run();
  return result.meta.changes === 1;
}

/** Undo a create whose KV write failed: the page was never visible. */
export async function removePageRow(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM pages WHERE id = ?').bind(id).run();
}

/**
 * The row for a page that has a KV record but no row yet: built from the
 * record and its `page_claims` row, inserted unless someone else got there
 * first, in which case theirs is returned.
 */
export async function ensurePageRow(db: D1Database, meta: PageMetadata, now: number): Promise<PageRow | null> {
  const row = rowFromMetadata(meta, await getClaim(db, meta.id), now);
  if (await insertPageRow(db, row)) return row;
  return getPageRow(db, meta.id);
}

/**
 * A page's row, creating it from the KV record if it has none yet. Null when
 * neither exists. Throws on a D1 error: callers fail closed rather than fall
 * back to a KV record that may be stale.
 */
export async function resolvePage(db: D1Database, id: string, kvMeta: PageMetadata | null, now: number): Promise<PageRow | null> {
  const row = await getPageRow(db, id);
  if (row !== null || kvMeta === null || kvMeta.id !== id) return row;
  return ensurePageRow(db, kvMeta, now);
}

/** New HTML: title, size and expiry. False if the page is deleted. */
export async function updatePageContent(
  db: D1Database,
  id: string,
  change: { title: string | null; size: number; expiresAt: number | null },
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE pages SET title = ?, size = ?, expires_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .bind(change.title, change.size, change.expiresAt, now, id)
    .run();
  return result.meta.changes === 1;
}

/** The settings columns set_options may write; absent ones are left alone. */
export type PageOptionsColumns = {
  title?: string | null;
  pin?: string | null;
  reads?: number | null;
  permanent?: boolean;
  expiresAt?: number | null;
  access?: 'people' | null;
};

/**
 * New settings for a live page (set_options): only the columns given, so
 * concurrent changes to different settings don't undo each other. False if
 * the page is deleted or has expired in the meantime, so a dead page can't
 * be brought back by giving it a new expiry.
 */
export async function updatePageOptions(
  db: D1Database,
  id: string,
  change: PageOptionsColumns,
  now: number,
): Promise<boolean> {
  const sets: string[] = [];
  const args: unknown[] = [];
  const col = (name: string, v: unknown) => {
    sets.push(`${name} = ?`);
    args.push(v);
  };
  if (change.title !== undefined) col('title', change.title);
  if (change.pin !== undefined) col('pin', change.pin);
  if (change.reads !== undefined) col('reads', change.reads);
  if (change.permanent !== undefined) col('permanent', change.permanent ? 1 : 0);
  if (change.expiresAt !== undefined) col('expires_at', change.expiresAt);
  if (change.access !== undefined) col('access', change.access);
  col('updated_at', now);
  const result = await db
    .prepare(`UPDATE pages SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`)
    .bind(...args, id, now)
    .run();
  return result.meta.changes === 1;
}

/** Deleted: no token matches it again, and it leaves every list. */
export async function markPageDeleted(db: D1Database, id: string, now: number): Promise<void> {
  await db
    .prepare('UPDATE pages SET deleted_at = ?, token_hash = ?, prev_token_hash = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .bind(now, DELETED_TOKEN_HASH, now, id)
    .run();
}

/**
 * A claim: an unowned live page whose token hash is still `checkedHash` (the
 * one the token was verified against) becomes this owner's, with a new
 * token. False if the row changed in between: the first claim wins.
 */
export async function claimPageRow(
  db: D1Database,
  id: string,
  claim: { ownerId: number; tokenHash: string; prevTokenHash: string; claimedAt: number },
  checkedHash: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE pages SET owner_id = ?, token_hash = ?, prev_token_hash = ?, claimed_at = ?, updated_at = ?
       WHERE id = ? AND owner_id IS NULL AND deleted_at IS NULL AND token_hash = ? AND token_hash <> ?`,
    )
    .bind(claim.ownerId, claim.tokenHash, claim.prevTokenHash, claim.claimedAt, claim.claimedAt, id, checkedHash, DELETED_TOKEN_HASH)
    .run();
  return result.meta.changes === 1;
}

/** Replace the token of a live page this owner holds. False if they don't. */
export async function replacePageToken(db: D1Database, id: string, ownerId: number, tokenHash: string, now: number): Promise<boolean> {
  const result = await db
    .prepare('UPDATE pages SET token_hash = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL')
    .bind(tokenHash, now, id, ownerId)
    .run();
  return result.meta.changes === 1;
}

/**
 * Account deletion: every page of this owner becomes anonymous, keeping its
 * token. A statement, so it can run in the same batch as the account's own
 * rows (lib/billing/forget.ts deleteAccountRows): both commit or neither.
 * Read its result with releasedRows.
 */
export function releaseOwnerPagesStatement(db: D1Database, ownerId: number, now: number): D1PreparedStatement {
  return db.prepare(`UPDATE pages SET owner_id = NULL, updated_at = ? WHERE owner_id = ? RETURNING ${COLUMNS}`).bind(now, ownerId);
}

/** The live pages a release statement returned, as they are now, for refreshing their KV records. */
export function releasedRows(result: D1Result | undefined, now: number): PageRow[] {
  return ((result?.results ?? []) as DbRow[]).map(fromDb).filter((r) => isLive(r, now));
}

/** releaseOwnerPagesStatement on its own. */
export async function releaseOwnerPages(db: D1Database, ownerId: number, now: number): Promise<PageRow[]> {
  return releasedRows(await releaseOwnerPagesStatement(db, ownerId, now).all(), now);
}

/** Release one page of this owner (pages found only through the old KV index). */
export async function releaseOwnerPage(db: D1Database, id: string, ownerId: number, now: number): Promise<void> {
  await db.prepare('UPDATE pages SET owner_id = NULL, updated_at = ? WHERE id = ? AND owner_id = ?').bind(now, id, ownerId).run();
}

/** A PIN rehashed from its pre-hashing form; only if it's still the old value. */
export async function updatePagePin(db: D1Database, id: string, from: string, to: string, now: number): Promise<void> {
  await db.prepare('UPDATE pages SET pin = ?, updated_at = ? WHERE id = ? AND pin = ?').bind(to, now, id, from).run();
}

// --- Owner lists --------------------------------------------------------------

/** `all`: every page; `unsorted`: pages with no project; else one project. */
export type ProjectFilter = { kind: 'all' } | { kind: 'unsorted' } | { kind: 'project'; name: string };

/** Opaque to clients: the last row's created_at and id. */
export function encodeCursor(row: Pick<PageRow, 'createdAt' | 'id'>): string {
  return `${row.createdAt}.${row.id}`;
}

export function decodeCursor(cursor: string | undefined): { createdAt: number; id: string } | null {
  if (cursor === undefined) return null;
  const m = /^(\d{1,16})\.([A-Za-z0-9_-]{1,64})$/.exec(cursor);
  return m === null ? null : { createdAt: Number(m[1]), id: m[2]! };
}

/** One owner's live pages, newest first, a page of `limit` at a time. */
export async function listOwnerPages(
  db: D1Database,
  ownerId: number,
  filter: ProjectFilter,
  cursor: string | undefined,
  limit: number,
  now: number,
): Promise<{ rows: PageRow[]; cursor: string | null }> {
  const where = ['owner_id = ?', 'deleted_at IS NULL', '(expires_at IS NULL OR expires_at > ?)'];
  const args: unknown[] = [ownerId, now];
  if (filter.kind === 'unsorted') where.push('project IS NULL');
  if (filter.kind === 'project') {
    where.push('project = ?');
    args.push(filter.name);
  }
  const after = decodeCursor(cursor);
  if (after !== null) {
    where.push('(created_at < ? OR (created_at = ? AND id < ?))');
    args.push(after.createdAt, after.createdAt, after.id);
  }
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM pages WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(...args, limit + 1)
    .all<DbRow>();
  const rows = results.slice(0, limit).map(fromDb);
  return { rows, cursor: results.length > limit ? encodeCursor(rows[rows.length - 1]!) : null };
}

/** An owner's projects with their live page counts: most pages first, then by name. */
export async function listOwnerProjects(
  db: D1Database,
  ownerId: number,
  now: number,
): Promise<Array<{ name: string; count: number }>> {
  const { results } = await db
    .prepare(
      `SELECT project AS name, COUNT(*) AS count FROM pages
       WHERE owner_id = ? AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?) AND project IS NOT NULL
       GROUP BY project ORDER BY count DESC, name ASC`,
    )
    .bind(ownerId, now)
    .all<{ name: string; count: number }>();
  return results.map((r) => ({ name: r.name, count: Number(r.count) }));
}

// --- Batches (sweep, backfill) -------------------------------------------------
// One JSON parameter through json_each, so a batch is one query whatever its
// size (D1 allows 100 bound parameters per query).

/** Which of these ids have a live row. */
export async function livePageIds(db: D1Database, ids: string[], now: number): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { results } = await db
    .prepare(
      `SELECT id FROM pages WHERE id IN (SELECT value FROM json_each(?))
       AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .bind(JSON.stringify(ids), now)
    .all<{ id: string }>();
  return new Set(results.map((r) => r.id));
}

/** Rows for these ids (deleted ones included). */
export async function pageRowsFor(db: D1Database, ids: string[]): Promise<Map<string, PageRow>> {
  if (ids.length === 0) return new Map();
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM pages WHERE id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(ids))
    .all<DbRow>();
  return new Map(results.map((r) => [r.id, fromDb(r)]));
}

/** `page_claims` rows for these ids. */
export async function claimsFor(db: D1Database, ids: string[]): Promise<Map<string, ClaimRecord>> {
  if (ids.length === 0) return new Map();
  const { results } = await db
    .prepare(
      'SELECT page_id, owner_id, token_hash, prev_token_hash, claimed_at FROM page_claims WHERE page_id IN (SELECT value FROM json_each(?))',
    )
    .bind(JSON.stringify(ids))
    .all<{ page_id: string; owner_id: number | null; token_hash: string; prev_token_hash: string; claimed_at: number }>();
  return new Map(
    results.map((r) => [r.page_id, { ownerId: r.owner_id, tokenHash: r.token_hash, prevTokenHash: r.prev_token_hash, claimedAt: r.claimed_at }]),
  );
}

/** Insert rows that don't exist yet, in one query. Returns how many went in. */
export async function insertPageRows(db: D1Database, rows: PageRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const cols = COLUMNS.split(', ');
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO pages (${COLUMNS})
       SELECT ${cols.map((c) => `json_extract(value, '$.${c}')`).join(', ')} FROM json_each(?)`,
    )
    .bind(JSON.stringify(rows.map(toDb)))
    .run();
  return result.meta.changes;
}
