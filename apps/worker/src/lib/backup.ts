/**
 * Nightly snapshots of KV and D1 into the backup R2 bucket (BACKUP_BUCKET).
 * docs/backups.md has the restore steps.
 *
 * A snapshot is written a chunk at a time, a few chunks per cron run, so it
 * stays inside the per-invocation limits (KV operations, D1 queries, CPU)
 * whatever the Workers plan. Progress lives in `state.json` in the backup
 * bucket itself, so a snapshot keeps going while D1 is down and needs no
 * migration. A chunk's file name depends only on its position, so a run cut
 * short just writes the same chunk again.
 *
 * Layout in the bucket:
 *   state.json                                  progress of the latest snapshot
 *   snapshots/<YYYY-MM-DD>/kv/<prefix>/<n>.json  KV entries, in `wrangler kv bulk put` format
 *   snapshots/<YYYY-MM-DD>/d1/<table>/<n>.json   D1 rows: { table, columns, rows }
 *   snapshots/<YYYY-MM-DD>/manifest.json         written last: every file and count
 *   trash/pages/<id>/<file>                       files the expired-page sweep removed
 *
 * Retention is a bucket lifecycle rule, not code: snapshots/ 30 days,
 * trash/ 14 days (docs/backups.md). No runtime imports, so tests run it with fakes.
 */

/**
 * The KV keys worth restoring. Everything else in the namespace is short-lived
 * (sign-in state, device codes, rate-limit counters) or the MCP OAuth store,
 * whose grants users can simply reconnect. `svs:` (sign-out-everywhere
 * markers) is kept so a restore can't revive sessions that were ended.
 */
export const BACKUP_KV_PREFIXES = [
  'page:',
  'user:',
  'email:',
  'ent:',
  'svs:',
  'projects_by_owner:',
  'pages_by_owner:',
  'pages_by_owner_project:',
] as const;

/** Tables that only hold short-lived working state; restoring them is pointless. */
export const BACKUP_SKIP_TABLES = new Set(['d1_migrations', 'sweep_candidates', '_cf_KV', '_cf_METADATA']);

/** KV keys per list call (KV's maximum) and per bulk get (KV's maximum). */
export const KV_CHUNK = 1000;
export const KV_GET_BATCH = 100;
/** D1 rows per chunk. */
export const D1_CHUNK = 1000;
/** Chunks written per cron run. */
export const CHUNKS_PER_RUN = 4;
/** A new snapshot starts once a day, at or after this UTC hour. */
export const BACKUP_HOUR_UTC = 3;

export const STATE_KEY = 'state.json';

/** An unfinished snapshot older than this is reported as backup_stale. */
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

/** Where the expired-page sweep keeps a copy of a file before deleting it. */
export function trashKey(pageFileKey: string): string {
  return `trash/${pageFileKey}`;
}

export type BackupStep = { kind: 'kv'; prefix: string } | { kind: 'd1'; table: string };

export type BackupFile = { key: string; count: number } & BackupStep;

export type BackupState = {
  /** Snapshot id: the UTC date it started on. */
  id: string;
  startedAt: number;
  finishedAt: number | null;
  plan: BackupStep[];
  /** Index into plan of the step in progress. */
  step: number;
  /** KV list cursor, or the last D1 rowid written, for the step in progress. */
  cursor: string | null;
  /** Chunk number within the step in progress. */
  chunk: number;
  files: BackupFile[];
};

export type KvEntry = { key: string; value: string; expiration?: number };

export type BackupDeps = {
  loadState: () => Promise<BackupState | null>;
  saveState: (state: BackupState) => Promise<void>;
  /** Write one snapshot file (JSON text). */
  writeFile: (key: string, body: string) => Promise<void>;
  kvList: (prefix: string, cursor: string | null, limit: number) => Promise<{
    keys: Array<{ name: string; expiration?: number }>;
    cursor: string | null;
  }>;
  /** Values for these keys (at most KV_GET_BATCH); a missing key maps to null. */
  kvGetMany: (keys: string[]) => Promise<Map<string, string | null>>;
  /** User tables in the database. */
  listTables: () => Promise<string[]>;
  /** Rows with rowid > after, in rowid order, each with its rowid as `__rowid`. */
  d1Rows: (table: string, after: number, limit: number) => Promise<Array<Record<string, unknown>>>;
  log?: (entry: Record<string, unknown>) => void;
};

/** UTC date of a timestamp, YYYY-MM-DD. */
export function snapshotId(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Whether a new snapshot should start now, given the latest one. */
export function snapshotDue(latest: BackupState | null, now: number): boolean {
  if (latest === null) return true;
  if (latest.finishedAt === null) return false; // finish it first
  return latest.id < snapshotId(now) && new Date(now).getUTCHours() >= BACKUP_HOUR_UTC;
}

/** A KV prefix or table name as one safe path segment. */
function segment(name: string): string {
  return name.replace(/:$/, '').replace(/[^A-Za-z0-9_-]/g, '_');
}

function fileKey(id: string, step: BackupStep, chunk: number): string {
  const where = step.kind === 'kv' ? `kv/${segment(step.prefix)}` : `d1/${segment(step.table)}`;
  return `snapshots/${id}/${where}/${String(chunk).padStart(4, '0')}.json`;
}

export function manifestKey(id: string): string {
  return `snapshots/${id}/manifest.json`;
}

async function kvChunk(deps: BackupDeps, prefix: string, cursor: string | null) {
  const page = await deps.kvList(prefix, cursor, KV_CHUNK);
  const entries: KvEntry[] = [];
  for (let i = 0; i < page.keys.length; i += KV_GET_BATCH) {
    const batch = page.keys.slice(i, i + KV_GET_BATCH);
    const values = await deps.kvGetMany(batch.map((k) => k.name));
    for (const k of batch) {
      const value = values.get(k.name);
      if (value === null || value === undefined) continue; // expired since the list
      entries.push(k.expiration !== undefined ? { key: k.name, value, expiration: k.expiration } : { key: k.name, value });
    }
  }
  return { body: JSON.stringify(entries), count: entries.length, next: page.cursor };
}

async function d1Chunk(deps: BackupDeps, table: string, cursor: string | null) {
  const after = cursor === null ? 0 : Number(cursor);
  const rows = await deps.d1Rows(table, after, D1_CHUNK);
  const columns = rows.length > 0 ? Object.keys(rows[0]!).filter((c) => c !== '__rowid') : [];
  const body = JSON.stringify({ table, columns, rows: rows.map((r) => columns.map((c) => r[c] ?? null)) });
  const last = rows.length > 0 ? Number(rows[rows.length - 1]!['__rowid']) : after;
  return { body, count: rows.length, next: rows.length < D1_CHUNK ? null : String(last) };
}

/**
 * One cron run's share of the backup: start today's snapshot if one is due,
 * then write up to CHUNKS_PER_RUN chunks of it, saving progress after each.
 */
export async function runBackupStep(
  deps: BackupDeps,
  now: number,
): Promise<{ status: 'idle' | 'progress' | 'done'; id: string | null; chunks: number }> {
  let state: BackupState | null = await deps.loadState();
  if (snapshotDue(state, now)) {
    const tables = (await deps.listTables()).filter((t) => !BACKUP_SKIP_TABLES.has(t) && !t.startsWith('sqlite_') && !t.startsWith('_cf_')).sort();
    state = {
      id: snapshotId(now),
      startedAt: now,
      finishedAt: null,
      plan: [
        ...BACKUP_KV_PREFIXES.map((prefix) => ({ kind: 'kv' as const, prefix })),
        ...tables.map((table) => ({ kind: 'd1' as const, table })),
      ],
      step: 0,
      cursor: null,
      chunk: 0,
      files: [],
    };
    await deps.saveState(state);
    deps.log?.({ event: 'backup_started', id: state.id, steps: state.plan.length });
  }
  if (state === null || state.finishedAt !== null) return { status: 'idle', id: state?.id ?? null, chunks: 0 };
  if (now - state.startedAt > STALE_AFTER_MS) {
    deps.log?.({ level: 'error', event: 'backup_stale', id: state.id, step: state.step, steps: state.plan.length });
  }

  let chunks = 0;
  while (chunks < CHUNKS_PER_RUN && state.step < state.plan.length) {
    const step: BackupStep = state.plan[state.step]!;
    const out: { body: string; count: number; next: string | null } = step.kind === 'kv' ? await kvChunk(deps, step.prefix, state.cursor) : await d1Chunk(deps, step.table, state.cursor);
    // An empty last chunk after a full one is skipped: its file would say nothing.
    if (out.count > 0 || state.chunk === 0) {
      const key = fileKey(state.id, step, state.chunk);
      await deps.writeFile(key, out.body);
      state.files = [...state.files.filter((f) => f.key !== key), { key, count: out.count, ...step }];
    }
    chunks++;
    if (out.next === null) {
      state = { ...state, step: state.step + 1, cursor: null, chunk: 0 };
    } else {
      state = { ...state, cursor: out.next, chunk: state.chunk + 1 };
    }
    await deps.saveState(state);
  }

  if (state.step < state.plan.length) return { status: 'progress', id: state.id, chunks };

  const counts: Record<string, number> = {};
  for (const f of state.files) {
    const name = f.kind === 'kv' ? `kv:${f.prefix}` : `d1:${f.table}`;
    counts[name] = (counts[name] ?? 0) + f.count;
  }
  const finishedAt = now;
  await deps.writeFile(
    manifestKey(state.id),
    JSON.stringify({ id: state.id, startedAt: state.startedAt, finishedAt, counts, files: state.files }, null, 2),
  );
  await deps.saveState({ ...state, finishedAt });
  deps.log?.({ event: 'backup_done', id: state.id, minutes: Math.round((finishedAt - state.startedAt) / 60_000), counts });
  return { status: 'done', id: state.id, chunks };
}

/** Parse state.json; null for anything that isn't one. */
export function parseBackupState(raw: string | null): BackupState | null {
  if (raw === null) return null;
  try {
    const s = JSON.parse(raw) as BackupState;
    if (typeof s?.id !== 'string' || !Array.isArray(s.plan) || typeof s.step !== 'number') return null;
    return s;
  } catch {
    return null;
  }
}

// --- Restore helpers (scripts/backup-restore.ts) ----------------------------

/** KV's minimum TTL: an entry expiring sooner than this can't be written. */
const KV_MIN_TTL_SEC = 60;

/**
 * Entries from KV snapshot files, ready for `wrangler kv bulk put`: entries
 * that have expired (or are about to) are dropped, since KV refuses them and
 * they'd be gone anyway.
 */
export function kvRestoreEntries(files: KvEntry[][], nowMs: number): KvEntry[] {
  const minExp = Math.floor(nowMs / 1000) + KV_MIN_TTL_SEC;
  return files.flat().filter((e) => e.expiration === undefined || e.expiration >= minExp);
}

/** A value as a SQLite literal. */
export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`can't restore number ${v}`);
    return String(v);
  }
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
  throw new Error(`can't restore a ${typeof v} value`);
}

function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * SQL that puts D1 snapshot rows back: INSERT OR REPLACE, so it can run over
 * a database that still has some of them. Run it against a database that
 * already has the migrations applied.
 */
export function d1RestoreSql(chunks: Array<{ table: string; columns: string[]; rows: unknown[][] }>): string {
  const lines: string[] = [];
  for (const { table, columns, rows } of chunks) {
    if (columns.length === 0) continue;
    const cols = columns.map(ident).join(', ');
    for (const row of rows) {
      lines.push(`INSERT OR REPLACE INTO ${ident(table)} (${cols}) VALUES (${row.map(sqlLiteral).join(', ')});`);
    }
  }
  return lines.join('\n') + (lines.length > 0 ? '\n' : '');
}
