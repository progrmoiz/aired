import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  BACKUP_HOUR_UTC,
  BACKUP_KV_PREFIXES,
  CHUNKS_PER_RUN,
  KV_CHUNK,
  KV_GET_BATCH,
  d1RestoreSql,
  kvRestoreEntries,
  manifestKey,
  parseBackupState,
  runBackupStep,
  snapshotDue,
  sqlLiteral,
  type BackupDeps,
  type BackupState,
  type KvEntry,
} from "../src/lib/backup.ts";

const DAY = 24 * 60 * 60 * 1000;
const NIGHT = Date.parse("2026-11-27T04:00:00Z");

/** A fake KV (sorted keys, cursor = index), a real SQLite and an in-memory bucket. */
function world(kv: Record<string, { value: string; expiration?: number }>, sql = "") {
  const db = new DatabaseSync(":memory:");
  if (sql) db.exec(sql);
  const files = new Map<string, string>();
  let state: string | null = null;
  const calls = { list: 0, get: 0, maxGet: 0 };
  const deps: BackupDeps = {
    loadState: async () => parseBackupState(state),
    saveState: async (s) => { state = JSON.stringify(s); },
    writeFile: async (key, body) => { files.set(key, body); },
    kvList: async (prefix, cursor, limit) => {
      calls.list++;
      const all = Object.keys(kv).filter((k) => k.startsWith(prefix)).sort();
      const start = cursor === null ? 0 : Number(cursor);
      const keys = all.slice(start, start + limit).map((name) => ({ name, ...(kv[name]!.expiration ? { expiration: kv[name]!.expiration } : {}) }));
      return { keys, cursor: start + limit < all.length ? String(start + limit) : null };
    },
    kvGetMany: async (keys) => {
      calls.get++;
      calls.maxGet = Math.max(calls.maxGet, keys.length);
      return new Map(keys.map((k) => [k, kv[k]?.value ?? null]));
    },
    listTables: async () => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name),
    d1Rows: async (table, after, limit) =>
      db.prepare(`SELECT rowid AS __rowid, * FROM "${table}" WHERE rowid > ? ORDER BY rowid LIMIT ?`).all(after, limit) as Array<Record<string, unknown>>,
  };
  return { deps, files, calls, db, state: () => parseBackupState(state) };
}

async function runToEnd(w: ReturnType<typeof world>, now: number) {
  let runs = 0;
  for (;;) {
    runs++;
    const r = await runBackupStep(w.deps, now);
    if (r.status !== "progress") return { last: r, runs };
    assert.ok(runs < 100, "backup never finished");
  }
}

test("snapshotDue: first ever, then once per UTC day from the backup hour", () => {
  assert.equal(snapshotDue(null, NIGHT), true);
  const done = { id: "2026-11-26", finishedAt: 1 } as BackupState;
  assert.equal(snapshotDue(done, NIGHT), true);
  assert.equal(snapshotDue({ ...done, id: "2026-11-27" }, NIGHT), false);
  const early = Date.parse(`2026-11-27T0${BACKUP_HOUR_UTC - 1}:59:00Z`);
  assert.equal(snapshotDue(done, early), false);
  assert.equal(snapshotDue({ ...done, finishedAt: null }, NIGHT + DAY), false, "an unfinished snapshot is finished first");
});

test("a snapshot covers every backed-up KV prefix and D1 table, then writes a manifest", async () => {
  const w = world(
    {
      "page:a": { value: '{"id":"a"}', expiration: 2_000_000_000 },
      "page:b": { value: '{"id":"b"}' },
      "user:1": { value: '{"id":1}' },
      "auth_state:x": { value: "skip me" },
      "pages_by_owner:1:0001:a": { value: "{}" },
    },
    `CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);
     INSERT INTO users VALUES (1, 'a@example.com'), (2, 'o''neil@example.com');
     CREATE TABLE sweep_candidates (key TEXT PRIMARY KEY);
     INSERT INTO sweep_candidates VALUES ('x');`,
  );
  const { last } = await runToEnd(w, NIGHT);
  assert.equal(last.status, "done");
  assert.equal(last.id, "2026-11-27");

  const pages = JSON.parse(w.files.get("snapshots/2026-11-27/kv/page/0000.json")!) as KvEntry[];
  assert.deepEqual(pages, [
    { key: "page:a", value: '{"id":"a"}', expiration: 2_000_000_000 },
    { key: "page:b", value: '{"id":"b"}' },
  ]);
  const all = [...w.files.values()].join("\n");
  assert.ok(!all.includes("auth_state:x"), "short-lived keys are not backed up");
  assert.ok(![...w.files.keys()].some((k) => k.includes("sweep_candidates")), "working tables are skipped");

  const users = JSON.parse(w.files.get("snapshots/2026-11-27/d1/users/0000.json")!);
  assert.deepEqual(users, { table: "users", columns: ["id", "email"], rows: [[1, "a@example.com"], [2, "o'neil@example.com"]] });

  const manifest = JSON.parse(w.files.get(manifestKey("2026-11-27"))!);
  assert.equal(manifest.counts["kv:page:"], 2);
  assert.equal(manifest.counts["kv:user:"], 1);
  assert.equal(manifest.counts["kv:pages_by_owner:"], 1);
  assert.equal(manifest.counts["d1:users"], 2);
  assert.equal(w.state()!.finishedAt, NIGHT);

  // Same day again: nothing to do.
  assert.equal((await runBackupStep(w.deps, NIGHT + 60_000)).status, "idle");
});

test("large prefixes are written in chunks across runs, and bulk gets stay within KV's limit", async () => {
  const kv: Record<string, { value: string }> = {};
  const n = KV_CHUNK * 2 + 5;
  for (let i = 0; i < n; i++) kv[`page:${String(i).padStart(6, "0")}`] = { value: `v${i}` };
  const w = world(kv);
  const first = await runBackupStep(w.deps, NIGHT);
  assert.equal(first.status, "progress");
  assert.equal(first.chunks, CHUNKS_PER_RUN);
  const { last } = await runToEnd(w, NIGHT);
  assert.equal(last.status, "done");
  assert.ok(w.calls.maxGet <= KV_GET_BATCH);

  const restored = [0, 1, 2].flatMap((c) => JSON.parse(w.files.get(`snapshots/2026-11-27/kv/page/000${c}.json`)!) as KvEntry[]);
  assert.equal(restored.length, n);
  assert.equal(new Set(restored.map((e) => e.key)).size, n, "no key twice");
});

test("a run cut short rewrites the same chunk, so nothing is lost or doubled", async () => {
  const kv: Record<string, { value: string }> = {};
  for (let i = 0; i < KV_CHUNK + 10; i++) kv[`user:${String(i).padStart(5, "0")}`] = { value: `u${i}` };
  const w = world(kv);
  let saves = 0;
  const realSave = w.deps.saveState;
  // Crash on the save after the first chunk is written.
  w.deps.saveState = async (s) => { saves++; if (saves === 2) throw new Error("R2 blip"); await realSave(s); };
  await assert.rejects(runBackupStep(w.deps, NIGHT));
  w.deps.saveState = realSave;
  await runToEnd(w, NIGHT);
  const users = [0, 1].flatMap((c) => JSON.parse(w.files.get(`snapshots/2026-11-27/kv/user/000${c}.json`) ?? "[]") as KvEntry[]);
  assert.equal(users.length, KV_CHUNK + 10);
  const manifest = JSON.parse(w.files.get(manifestKey("2026-11-27"))!);
  assert.equal(manifest.counts["kv:user:"], KV_CHUNK + 10);
});

test("an unfinished snapshot a day and a half old is reported as stale", async () => {
  const kv: Record<string, { value: string }> = {};
  for (let i = 0; i < KV_CHUNK * (CHUNKS_PER_RUN + 1); i++) kv[`page:${String(i).padStart(6, "0")}`] = { value: "v" };
  const w = world(kv);
  const logs: Array<Record<string, unknown>> = [];
  w.deps.log = (e) => logs.push(e);
  await runBackupStep(w.deps, NIGHT);
  assert.ok(!logs.some((e) => e.event === "backup_stale"));
  await runBackupStep(w.deps, NIGHT + 2 * DAY);
  assert.ok(logs.some((e) => e.event === "backup_stale" && e.level === "error"));
});

test("D1 tables page by rowid", async () => {
  const w = world({}, "CREATE TABLE t (k TEXT PRIMARY KEY, n INTEGER);");
  const insert = w.db.prepare("INSERT INTO t VALUES (?, ?)");
  for (let i = 0; i < 2500; i++) insert.run(`k${i}`, i);
  await runToEnd(w, NIGHT);
  const manifest = JSON.parse(w.files.get(manifestKey("2026-11-27"))!);
  assert.equal(manifest.counts["d1:t"], 2500);
  const chunks = manifest.files.filter((f: { table?: string }) => f.table === "t");
  assert.equal(chunks.length, 3);
});

test("every prefix in the plan is listed: page records and accounts at least", () => {
  assert.ok(BACKUP_KV_PREFIXES.includes("page:"));
  assert.ok(BACKUP_KV_PREFIXES.includes("user:"));
  assert.ok(BACKUP_KV_PREFIXES.includes("svs:"), "sign-out markers survive a restore");
});

test("kvRestoreEntries drops entries that have expired or are about to", () => {
  const now = 1_000_000 * 1000;
  const out = kvRestoreEntries(
    [[{ key: "a", value: "1" }, { key: "b", value: "2", expiration: 1_000_030 }], [{ key: "c", value: "3", expiration: 1_000_100 }]],
    now,
  );
  assert.deepEqual(out.map((e) => e.key), ["a", "c"]);
});

test("d1RestoreSql quotes values and round-trips through SQLite", () => {
  assert.equal(sqlLiteral("it's"), "'it''s'");
  assert.equal(sqlLiteral(null), "NULL");
  assert.equal(sqlLiteral(42), "42");
  assert.throws(() => sqlLiteral({}));
  const sql = d1RestoreSql([{ table: "users", columns: ["id", "email"], rows: [[1, "o'neil@example.com"], [2, null]] }]);
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT); INSERT INTO users VALUES (1, 'old');");
  db.exec(sql);
  assert.deepEqual(db.prepare("SELECT id, email FROM users ORDER BY id").all().map((r) => ({ ...r })), [
    { id: 1, email: "o'neil@example.com" },
    { id: 2, email: null },
  ]);
});
