import type { PageMetadata } from '@aired/core';
import { DELETED_TOKEN_HASH } from './page-claims.ts';
import { claimsFor, insertPageRows, pageRowsFor, rowFromMetadata, type PageRow } from './pages-store.ts';

/**
 * Backfill D1 `pages` from the KV page records, one batch per call
 * (routes/admin.ts, driven by scripts/pages-backfill.ts).
 *
 * - Idempotent: rows are INSERT OR IGNORE, and a row that exists is never
 *   touched. Every write path makes a page's row before changing it
 *   (lib/page-write.ts loadPage), so an existing row is always at least as
 *   new as the KV record.
 * - Resumable: the KV list cursor comes back with each batch. Starting over
 *   from no cursor is also safe, just slower.
 * - A dry run reads and counts the same way and writes nothing.
 *
 * Owner and token come from `page_claims` when the page has a row there, as
 * the code before `pages` decided them. No runtime imports beyond the
 * import-free stores, so tests run it over node:sqlite.
 */

export const BACKFILL_MAX_LIMIT = 500;
const GET_BATCH = 100;
const SAMPLES = 10;

export type BackfillDeps = {
  db: D1Database;
  kvList: (cursor: string | null, limit: number) => Promise<{ keys: string[]; cursor: string | null }>;
  kvGetMany: (keys: string[]) => Promise<Map<string, string | null>>;
  parse: (raw: string) => PageMetadata | null;
};

export type BackfillCounts = {
  /** KV page records looked at. */
  scanned: number;
  /** Records that don't parse: left alone. */
  corrupt: number;
  /** Records gone between the list and the read (expired). */
  vanished: number;
  /** Pages that already have a row (made by a write since, or an earlier run). */
  alreadyInD1: number;
  /** Of those, rows whose owner or token differ from what KV + page_claims give (expected after a claim or release made since). */
  differs: number;
  /** Rows that would go in (dry run) or went in. */
  toInsert: number;
  inserted: number;
  /** Of toInsert: */
  owned: number;
  anonymous: number;
  /** A page_claims row decides the owner and token. */
  fromClaim: number;
  /** ...and it disagrees with the KV record (a stale KV write-back the claim row corrects). */
  claimOverridesKv: number;
  /** A tombstoned claim: the row goes in as deleted. */
  tombstoned: number;
  /** Past its expiry already (KV hasn't dropped it yet). */
  expired: number;
  withProject: number;
  permanent: number;
};

export type BackfillReport = {
  dryRun: boolean;
  counts: BackfillCounts;
  samples: { corrupt: string[]; differs: string[]; claimOverridesKv: string[]; tombstoned: string[] };
  /** Pass back to continue; null when the whole namespace has been read. */
  cursor: string | null;
};

export function emptyCounts(): BackfillCounts {
  return {
    scanned: 0, corrupt: 0, vanished: 0, alreadyInD1: 0, differs: 0, toInsert: 0, inserted: 0, owned: 0,
    anonymous: 0, fromClaim: 0, claimOverridesKv: 0, tombstoned: 0, expired: 0, withProject: 0, permanent: 0,
  };
}

const sample = (list: string[], id: string) => {
  if (list.length < SAMPLES) list.push(id);
};

export async function backfillBatch(
  deps: BackfillDeps,
  opts: { cursor: string | null; limit: number; dryRun: boolean; now: number },
): Promise<BackfillReport> {
  const limit = Math.max(1, Math.min(Math.floor(opts.limit), BACKFILL_MAX_LIMIT));
  const counts = emptyCounts();
  const samples: BackfillReport['samples'] = { corrupt: [], differs: [], claimOverridesKv: [], tombstoned: [] };

  const listed = await deps.kvList(opts.cursor, limit);
  counts.scanned = listed.keys.length;
  const records: PageMetadata[] = [];
  for (let i = 0; i < listed.keys.length; i += GET_BATCH) {
    const keys = listed.keys.slice(i, i + GET_BATCH);
    const values = await deps.kvGetMany(keys);
    for (const key of keys) {
      const raw = values.get(key);
      if (raw === null || raw === undefined) {
        counts.vanished++;
        continue;
      }
      const meta = deps.parse(raw);
      const id = key.slice('page:'.length);
      if (meta === null || meta.id !== id) {
        counts.corrupt++;
        sample(samples.corrupt, id);
        continue;
      }
      records.push(meta);
    }
  }

  const ids = records.map((m) => m.id);
  const [existing, claims] = await Promise.all([pageRowsFor(deps.db, ids), claimsFor(deps.db, ids)]);
  const rows: PageRow[] = [];
  for (const meta of records) {
    const claim = claims.get(meta.id) ?? null;
    const built = rowFromMetadata(meta, claim, opts.now);
    const have = existing.get(meta.id);
    if (have !== undefined) {
      counts.alreadyInD1++;
      if (have.ownerId !== built.ownerId || have.tokenHash !== built.tokenHash) {
        counts.differs++;
        sample(samples.differs, meta.id);
      }
      continue;
    }
    rows.push(built);
    counts.toInsert++;
    if (built.ownerId !== null) counts.owned++;
    else counts.anonymous++;
    if (claim !== null) {
      counts.fromClaim++;
      if (claim.tokenHash === DELETED_TOKEN_HASH) {
        counts.tombstoned++;
        sample(samples.tombstoned, meta.id);
      } else if (claim.ownerId !== meta.ownerId || claim.tokenHash !== meta.tokenHash) {
        counts.claimOverridesKv++;
        sample(samples.claimOverridesKv, meta.id);
      }
    }
    if (built.expiresAt !== null && built.expiresAt <= opts.now) counts.expired++;
    if (built.project !== null) counts.withProject++;
    if (built.permanent) counts.permanent++;
  }

  if (!opts.dryRun) counts.inserted = await insertPageRows(deps.db, rows);
  return { dryRun: opts.dryRun, counts, samples, cursor: listed.cursor };
}

/** Add one batch's counts and samples into a running total. */
export function mergeReports(total: BackfillReport, next: BackfillReport): BackfillReport {
  const counts = { ...total.counts };
  for (const k of Object.keys(counts) as Array<keyof BackfillCounts>) counts[k] += next.counts[k];
  const samples = { ...total.samples };
  for (const k of Object.keys(samples) as Array<keyof BackfillReport['samples']>) {
    samples[k] = [...samples[k], ...next.samples[k]].slice(0, SAMPLES);
  }
  return { dryRun: total.dryRun, counts, samples, cursor: next.cursor };
}
