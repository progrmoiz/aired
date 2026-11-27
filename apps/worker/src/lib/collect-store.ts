/**
 * D1 for the data layer (migrations/0014_collect.sql): viewer entries in
 * `responses`, and per-page settings, counters and live data in `page_data`.
 *
 * A save reserves room first: one UPDATE on the page's page_data row that
 * adds the entry to its counters only while the page is open and under its
 * plan's caps (entries this month, entries held, bytes held). Only then is
 * the entry written; if that write fails, the reservation is given back.
 * So caps hold under parallel saves without counting rows on every save.
 *
 * No runtime imports, so tests load it directly.
 */

import type { CollectLimits } from "./collect-limits.ts";

export type Entry = {
  id: string;
  viewer: string;
  key: string | null;
  data: unknown;
  createdAt: number;
  updatedAt: number;
};

export type PageDataRow = {
  publicResults: boolean;
  closed: boolean;
  dataVersion: number;
  dataSize: number;
  entries: number;
  bytes: number;
  month: string;
  monthCount: number;
  updatedAt: number;
};

type DbEntry = { id: string; viewer: string; entry_key: string | null; data: string; created_at: number; updated_at: number };
type DbPageData = {
  public_results: number; closed: number; data_version: number; data_size: number; entries: number; bytes: number;
  month: string; month_count: number; updated_at: number;
};

const ENTRY_COLUMNS = "id, viewer, entry_key, data, created_at, updated_at";
const PAGE_DATA_COLUMNS = "public_results, closed, data_version, data_size, entries, bytes, month, month_count, updated_at";

function parseData(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const toEntry = (r: DbEntry): Entry => ({
  id: r.id,
  viewer: r.viewer,
  key: r.entry_key,
  data: parseData(r.data),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toPageData = (r: DbPageData): PageDataRow => ({
  publicResults: r.public_results === 1,
  closed: r.closed === 1,
  dataVersion: r.data_version,
  dataSize: r.data_size,
  entries: r.entries,
  bytes: r.bytes,
  month: r.month,
  monthCount: r.month_count,
  updatedAt: r.updated_at,
});

/** "2026-11" for a time, in UTC. */
export function utcMonth(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}

export function newEntryId(): string {
  const b = crypto.getRandomValues(new Uint8Array(9));
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return "r_" + btoa(s).replace(/\+/g, "-").replace(/\//g, "_");
}

/** The page's settings and counters; null if it has never collected or been given data. */
export async function getPageData(db: D1Database, pageId: string): Promise<PageDataRow | null> {
  const row = await db.prepare(`SELECT ${PAGE_DATA_COLUMNS} FROM page_data WHERE page_id = ?`).bind(pageId).first<DbPageData>();
  return row === null ? null : toPageData(row);
}

const ensureRow = (db: D1Database, pageId: string, ownerId: number, now: number) =>
  db.prepare("INSERT INTO page_data (page_id, owner_id, updated_at) VALUES (?, ?, ?) ON CONFLICT (page_id) DO NOTHING").bind(pageId, ownerId, now);

export type SaveInput = {
  pageId: string;
  ownerId: number;
  viewer: string;
  key: string | null;
  json: string;
  size: number;
  limits: CollectLimits;
  now: number;
};

export type SaveResult =
  | { ok: true; entry: Entry; replaced: boolean }
  | { ok: false; reason: "closed" | "monthly" | "stored" | "bytes" };

/** Why a reservation was refused, from the row as it is now. */
async function refusal(db: D1Database, input: SaveInput, month: string, extraBytes: number): Promise<Exclude<SaveResult, { ok: true }>> {
  const row = await getPageData(db, input.pageId);
  if (row?.closed) return { ok: false, reason: "closed" };
  if (row && row.month === month && row.monthCount >= input.limits.responsesPerMonth) return { ok: false, reason: "monthly" };
  if (row && row.entries >= input.limits.storedResponses) return { ok: false, reason: "stored" };
  if (row && row.bytes + extraBytes > input.limits.storedBytes) return { ok: false, reason: "bytes" };
  return { ok: false, reason: "stored" };
}

/** Add room for one new entry to the counters, if the caps allow it. True if reserved. */
async function reserveNew(db: D1Database, input: SaveInput, month: string): Promise<boolean> {
  const { pageId, ownerId, size, limits, now } = input;
  const [, reserved] = await db.batch([
    ensureRow(db, pageId, ownerId, now),
    db
      .prepare(
        `UPDATE page_data SET
           entries = entries + 1,
           bytes = bytes + ?,
           month_count = CASE WHEN month = ? THEN month_count + 1 ELSE 1 END,
           month = ?,
           updated_at = ?
         WHERE page_id = ? AND closed = 0
           AND entries < ?
           AND bytes + ? <= ?
           AND (month <> ? OR month_count < ?)
         RETURNING entries`,
      )
      .bind(size, month, month, now, pageId, limits.storedResponses, size, limits.storedBytes, month, limits.responsesPerMonth),
  ]);
  return ((reserved as D1Result | undefined)?.results?.length ?? 0) > 0;
}

/** Give back what reserveNew took, after the entry couldn't be written. */
async function releaseNew(db: D1Database, pageId: string, size: number, month: string): Promise<void> {
  await db
    .prepare(
      `UPDATE page_data SET entries = MAX(entries - 1, 0), bytes = MAX(bytes - ?, 0),
         month_count = CASE WHEN month = ? THEN MAX(month_count - 1, 0) ELSE month_count END
       WHERE page_id = ?`,
    )
    .bind(size, month, pageId)
    .run();
}

/** Change the byte count by delta (a keyed entry replaced), if it fits and the page is open. */
async function reserveDelta(db: D1Database, input: SaveInput, delta: number): Promise<boolean> {
  const row = await db
    .prepare("UPDATE page_data SET bytes = MAX(bytes + ?, 0), updated_at = ? WHERE page_id = ? AND closed = 0 AND bytes + ? <= ? RETURNING bytes")
    .bind(delta, input.now, input.pageId, delta, input.limits.storedBytes)
    .first();
  return row !== null;
}

async function findKeyed(db: D1Database, pageId: string, viewer: string, key: string) {
  return db
    .prepare(`SELECT ${ENTRY_COLUMNS}, size FROM responses WHERE page_id = ? AND viewer = ? AND entry_key = ?`)
    .bind(pageId, viewer, key)
    .first<DbEntry & { size: number }>();
}

/**
 * Save one entry. With a key, an entry this viewer already saved under it
 * is replaced (counts once toward the month); without one, a new entry is
 * added.
 */
export async function saveEntry(db: D1Database, input: SaveInput): Promise<SaveResult> {
  const { pageId, ownerId, viewer, key, json, size, limits, now } = input;
  const month = utcMonth(now);
  const expiresAt = limits.retentionDays === null ? null : now + limits.retentionDays * 86_400_000;

  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = key === null ? null : await findKeyed(db, pageId, viewer, key);
    if (existing !== null) {
      const delta = size - existing.size;
      if (!(await reserveDelta(db, input, delta))) return refusal(db, input, month, delta);
      const updated = await db
        .prepare(`UPDATE responses SET data = ?, size = ?, updated_at = ?, expires_at = ? WHERE id = ? AND size = ? RETURNING ${ENTRY_COLUMNS}`)
        .bind(json, size, now, expiresAt, existing.id, existing.size)
        .first<DbEntry>();
      if (updated !== null) return { ok: true, entry: toEntry(updated), replaced: true };
      // Changed or removed in between: undo and look again.
      await db.prepare("UPDATE page_data SET bytes = MAX(bytes - ?, 0) WHERE page_id = ?").bind(delta, pageId).run();
      continue;
    }

    if (!(await reserveNew(db, input, month))) return refusal(db, input, month, size);
    const id = newEntryId();
    try {
      const row = await db
        .prepare(
          `INSERT INTO responses (id, page_id, owner_id, viewer, entry_key, data, size, created_at, updated_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${ENTRY_COLUMNS}`,
        )
        .bind(id, pageId, ownerId, viewer, key, json, size, now, now, expiresAt)
        .first<DbEntry>();
      if (row !== null) return { ok: true, entry: toEntry(row), replaced: false };
      await releaseNew(db, pageId, size, month);
      throw new Error("entry insert returned nothing");
    } catch (err) {
      await releaseNew(db, pageId, size, month);
      // Another save with the same key won the race: replace that one instead.
      if (key !== null && /UNIQUE/i.test(String(err))) continue;
      throw err;
    }
  }
  throw new Error("entry save kept racing");
}

export type Cursor = { createdAt: number; id: string };

export function encodeEntryCursor(e: Pick<Entry, "createdAt" | "id">): string {
  return btoa(`${e.createdAt}:${e.id}`).replace(/=+$/, "");
}

export function decodeEntryCursor(s: string | undefined | null): Cursor | null {
  if (!s || s.length > 100) return null;
  try {
    const m = /^(\d{1,15}):(r_[A-Za-z0-9_-]{12})$/.exec(atob(s));
    return m ? { createdAt: Number(m[1]), id: m[2]! } : null;
  } catch {
    return null;
  }
}

/**
 * Entries newest first, one page of `limit`, after `cursor`. `viewer`
 * narrows to one viewer's own entries (mine); null lists everyone's (the
 * owner, or all() when results are public).
 */
export async function listEntries(
  db: D1Database,
  pageId: string,
  opts: { viewer: string | null; limit: number; cursor: Cursor | null },
): Promise<{ entries: Entry[]; cursor: string | null }> {
  const where = ["page_id = ?"];
  const args: unknown[] = [pageId];
  if (opts.viewer !== null) {
    where.push("viewer = ?");
    args.push(opts.viewer);
  }
  if (opts.cursor !== null) {
    where.push("(created_at < ? OR (created_at = ? AND id < ?))");
    args.push(opts.cursor.createdAt, opts.cursor.createdAt, opts.cursor.id);
  }
  const rows = await db
    .prepare(`SELECT ${ENTRY_COLUMNS} FROM responses WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(...args, opts.limit + 1)
    .all<DbEntry>();
  const list = (rows.results ?? []).map(toEntry);
  const more = list.length > opts.limit;
  const entries = more ? list.slice(0, opts.limit) : list;
  return { entries, cursor: more ? encodeEntryCursor(entries[entries.length - 1]!) : null };
}

/** Take deleted rows off the page's counters. */
async function subtract(db: D1Database, pageId: string, rows: { size: number; created_at: number }[], nowMs: number): Promise<void> {
  if (rows.length === 0) return;
  const bytes = rows.reduce((n, r) => n + r.size, 0);
  const month = utcMonth(nowMs);
  const thisMonth = rows.filter((r) => utcMonth(r.created_at) === month).length;
  await db
    .prepare(
      `UPDATE page_data SET entries = MAX(entries - ?, 0), bytes = MAX(bytes - ?, 0),
         month_count = CASE WHEN month = ? THEN MAX(month_count - ?, 0) ELSE month_count END
       WHERE page_id = ?`,
    )
    .bind(rows.length, bytes, month, thisMonth, pageId)
    .run();
}

/** A viewer deletes one of their own entries, by id or by key. True if one went. */
export async function removeOwnEntry(db: D1Database, pageId: string, viewer: string, idOrKey: string, nowMs: number): Promise<boolean> {
  const res = await db
    .prepare("DELETE FROM responses WHERE page_id = ? AND viewer = ? AND (id = ? OR entry_key = ?) RETURNING size, created_at")
    .bind(pageId, viewer, idOrKey, idOrKey)
    .all<{ size: number; created_at: number }>();
  const rows = res.results ?? [];
  await subtract(db, pageId, rows, nowMs);
  return rows.length > 0;
}

/** The owner deletes entries: the ids given, or every entry when ids is null. Returns how many went. */
export async function deleteEntries(db: D1Database, pageId: string, ids: string[] | null, nowMs: number): Promise<number> {
  if (ids === null) {
    const res = await db.prepare("DELETE FROM responses WHERE page_id = ?").bind(pageId).run();
    await db.prepare("UPDATE page_data SET entries = 0, bytes = 0, month_count = 0 WHERE page_id = ?").bind(pageId).run();
    return res.meta.changes ?? 0;
  }
  let total = 0;
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const res = await db
      .prepare(`DELETE FROM responses WHERE page_id = ? AND id IN (${chunk.map(() => "?").join(", ")}) RETURNING size, created_at`)
      .bind(pageId, ...chunk)
      .all<{ size: number; created_at: number }>();
    const rows = res.results ?? [];
    await subtract(db, pageId, rows, nowMs);
    total += rows.length;
  }
  return total;
}

/** Change whether everyone sees all entries, and whether the page takes new ones. */
export async function setCollectSettings(
  db: D1Database,
  pageId: string,
  ownerId: number,
  change: { publicResults?: boolean; closed?: boolean },
  now: number,
): Promise<PageDataRow> {
  const sets: string[] = ["updated_at = ?"];
  const args: unknown[] = [now];
  if (change.publicResults !== undefined) {
    sets.push("public_results = ?");
    args.push(change.publicResults ? 1 : 0);
  }
  if (change.closed !== undefined) {
    sets.push("closed = ?");
    args.push(change.closed ? 1 : 0);
  }
  const [, updated] = await db.batch([
    ensureRow(db, pageId, ownerId, now),
    db.prepare(`UPDATE page_data SET ${sets.join(", ")} WHERE page_id = ? RETURNING ${PAGE_DATA_COLUMNS}`).bind(...args, pageId),
  ]);
  const row = ((updated as D1Result<DbPageData> | undefined)?.results ?? [])[0];
  if (!row) throw new Error("page_data update returned nothing");
  return toPageData(row);
}

/** Replace the page's live data. Returns the new version. */
export async function putLiveData(db: D1Database, pageId: string, ownerId: number, json: string, size: number, now: number): Promise<number> {
  const [, updated] = await db.batch([
    ensureRow(db, pageId, ownerId, now),
    db
      .prepare("UPDATE page_data SET data = ?, data_size = ?, data_version = data_version + 1, updated_at = ? WHERE page_id = ? RETURNING data_version")
      .bind(json, size, now, pageId),
  ]);
  const row = ((updated as D1Result<{ data_version: number }> | undefined)?.results ?? [])[0];
  if (!row) throw new Error("page_data update returned nothing");
  return row.data_version;
}

/** The live data and its version, or null data at version 0 when nothing was pushed. */
export async function getLiveData(db: D1Database, pageId: string): Promise<{ version: number; data: unknown; updatedAt: number | null }> {
  const row = await db
    .prepare("SELECT data, data_version, updated_at FROM page_data WHERE page_id = ?")
    .bind(pageId)
    .first<{ data: string | null; data_version: number; updated_at: number }>();
  if (row === null || row.data === null) return { version: row?.data_version ?? 0, data: null, updatedAt: null };
  return { version: row.data_version, data: parseData(row.data), updatedAt: row.updated_at };
}

/** Just the version, for the poll: one small row read. */
export async function liveDataVersion(db: D1Database, pageId: string): Promise<number> {
  const row = await db.prepare("SELECT data_version FROM page_data WHERE page_id = ?").bind(pageId).first<{ data_version: number }>();
  return row?.data_version ?? 0;
}

/** A page is deleted: its entries and data go with it. */
export async function deletePageCollectData(db: D1Database, pageId: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM responses WHERE page_id = ?").bind(pageId),
    db.prepare("DELETE FROM page_data WHERE page_id = ?").bind(pageId),
  ]);
}

/**
 * Housekeeping: delete entries past their retention, and entries and data
 * of pages that are deleted, expired or no longer owned. Up to `max` rows a
 * run; the counters of each page touched are recounted. Returns how many went.
 */
export async function pruneCollectData(db: D1Database, nowMs: number, max = 2_000): Promise<number> {
  const expired = await db
    .prepare(
      `DELETE FROM responses WHERE id IN (
         SELECT id FROM responses WHERE expires_at IS NOT NULL AND expires_at <= ?
         UNION ALL
         SELECT r.id FROM responses r JOIN pages p ON p.id = r.page_id
           WHERE p.deleted_at IS NOT NULL OR p.owner_id IS NULL OR p.owner_id <> r.owner_id OR (p.expires_at IS NOT NULL AND p.expires_at <= ?)
         LIMIT ?
       ) RETURNING page_id`,
    )
    .bind(nowMs, nowMs, max)
    .all<{ page_id: string }>();
  const pages = [...new Set((expired.results ?? []).map((r) => r.page_id))];
  await db
    .prepare(
      `DELETE FROM page_data WHERE page_id IN (
         SELECT d.page_id FROM page_data d JOIN pages p ON p.id = d.page_id
           WHERE p.deleted_at IS NOT NULL OR p.owner_id IS NULL OR p.owner_id <> d.owner_id OR (p.expires_at IS NOT NULL AND p.expires_at <= ?)
         LIMIT 500)`,
    )
    .bind(nowMs)
    .run();
  for (let i = 0; i < pages.length; i += 90) {
    const chunk = pages.slice(i, i + 90);
    await db
      .prepare(
        `UPDATE page_data SET
           entries = (SELECT COUNT(*) FROM responses r WHERE r.page_id = page_data.page_id),
           bytes = (SELECT COALESCE(SUM(size), 0) FROM responses r WHERE r.page_id = page_data.page_id)
         WHERE page_id IN (${chunk.map(() => "?").join(", ")})`,
      )
      .bind(...chunk)
      .run();
  }
  return (expired.results ?? []).length;
}
