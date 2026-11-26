/**
 * Restore helpers for the nightly backups (src/lib/backup.ts). Run from
 * apps/worker with Node 22.6+:
 *
 *   node --experimental-strip-types scripts/backup-restore.ts <command> ...
 *
 *   status
 *            Print state.json: the latest snapshot and how far it got.
 *   download --date YYYY-MM-DD --out <dir>
 *            Fetch that snapshot's manifest and every file in it.
 *   prepare  --dir <dir>
 *            Turn a downloaded snapshot into kv-bulk-<n>.json files (for
 *            `wrangler kv bulk put`) and d1-restore.sql (for `wrangler d1
 *            execute --file`), and print the commands to apply them.
 *   untrash  --id <pageId>
 *            Copy a page's files back from trash/ into the pages bucket.
 *
 * Nothing here writes to KV or D1: `prepare` prints the commands and you run
 * them yourself, after reading docs/backups.md.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { d1RestoreSql, kvRestoreEntries, manifestKey, STATE_KEY, trashKey, type BackupFile, type KvEntry } from "../src/lib/backup.ts";

/** Production is the only deploy (docs/deploy.md). */
const BUCKETS = { backup: "aired-backups", pages: "aired-pages", d1: "aired" };

/** `wrangler kv bulk put` takes up to 10,000 entries per file. */
const KV_BULK_MAX = 10_000;

function args(): Record<string, string> {
  const out: Record<string, string> = {};
  const argv = process.argv.slice(3);
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!k?.startsWith("--") || v === undefined) die(`bad argument near ${k ?? "(end)"}`);
    out[k.slice(2)] = v;
  }
  return out;
}

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}


function wrangler(argv: string[]): void {
  execFileSync("npx", ["wrangler", ...argv], { stdio: ["ignore", "ignore", "inherit"] });
}

function r2Get(bucket: string, key: string, file: string): boolean {
  mkdirSync(dirname(file), { recursive: true });
  try {
    wrangler(["r2", "object", "get", `${bucket}/${key}`, "--file", file, "--remote"]);
    return existsSync(file);
  } catch {
    return false;
  }
}

const command = process.argv[2];
const a = args();

if (command === "status") {
  const e = BUCKETS;
  const file = join(mkdtempSync(join(tmpdir(), "aired-backup-")), STATE_KEY);
  if (!r2Get(e.backup, STATE_KEY, file)) die("no state.json yet: no snapshot has started");
  const s = JSON.parse(readFileSync(file, "utf8"));
  console.log(JSON.stringify({ id: s.id, startedAt: new Date(s.startedAt).toISOString(), finishedAt: s.finishedAt ? new Date(s.finishedAt).toISOString() : null, step: `${s.step}/${s.plan.length}`, files: s.files.length }, null, 2));
} else if (command === "download") {
  const e = BUCKETS;
  if (!a.date || !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) die("--date YYYY-MM-DD is required");
  if (!a.out) die("--out <dir> is required");
  const manifestFile = join(a.out, "manifest.json");
  if (!r2Get(e.backup, manifestKey(a.date), manifestFile)) die(`no finished snapshot for ${a.date} (manifest missing)`);
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { files: BackupFile[] };
  for (const f of manifest.files) {
    const local = join(a.out, f.key.replace(/^snapshots\/[^/]+\//, ""));
    if (!r2Get(e.backup, f.key, local)) die(`failed to download ${f.key}`);
    console.log(`got ${f.key} (${f.count})`);
  }
  console.log(`\n${manifest.files.length} files in ${a.out}. Next: prepare --dir ${a.out}`);
} else if (command === "prepare") {
  if (!a.dir) die("--dir <dir> is required");
  const manifest = JSON.parse(readFileSync(join(a.dir, "manifest.json"), "utf8")) as { id: string; files: BackupFile[] };
  const local = (f: BackupFile) => join(a.dir!, f.key.replace(/^snapshots\/[^/]+\//, ""));
  const kvFiles = manifest.files.filter((f) => f.kind === "kv").map((f) => JSON.parse(readFileSync(local(f), "utf8")) as KvEntry[]);
  const entries = kvRestoreEntries(kvFiles, Date.now());
  const bulk: string[] = [];
  for (let i = 0; i < entries.length; i += KV_BULK_MAX) {
    const name = join(a.dir, `kv-bulk-${bulk.length}.json`);
    writeFileSync(name, JSON.stringify(entries.slice(i, i + KV_BULK_MAX)));
    bulk.push(name);
  }
  const d1Files = manifest.files.filter((f) => f.kind === "d1").map((f) => JSON.parse(readFileSync(local(f), "utf8")));
  const sqlFile = join(a.dir, "d1-restore.sql");
  writeFileSync(sqlFile, d1RestoreSql(d1Files));
  console.log(`Snapshot ${manifest.id}: ${entries.length} KV entries in ${bulk.length} file(s), ${d1Files.reduce((n, c) => n + c.rows.length, 0)} D1 rows.`);
  console.log("\nTo apply, after reading docs/backups.md (add --local instead of --remote to rehearse on a local copy):");
  for (const f of bulk) console.log(`  npx wrangler kv bulk put ${f} --binding PAGES_KV --remote`);
  console.log(`  npx wrangler d1 execute aired --remote --file ${sqlFile}`);
} else if (command === "untrash") {
  const e = BUCKETS;
  if (!a.id || !/^[A-Za-z0-9_-]{1,64}$/.test(a.id)) die("--id <pageId> is required");
  const dir = mkdtempSync(join(tmpdir(), "aired-untrash-"));
  let restored = 0;
  for (const name of ["index.html", "shot.jpg", "tile.jpg"]) {
    const key = `pages/${a.id}/${name}`;
    const file = join(dir, name);
    if (!r2Get(e.backup, trashKey(key), file)) continue;
    const type = name.endsWith(".html") ? "text/html; charset=utf-8" : "image/jpeg";
    wrangler(["r2", "object", "put", `${e.pages}/${key}`, "--file", file, "--content-type", type, "--remote"]);
    console.log(`restored ${key}`);
    restored++;
  }
  if (restored === 0) die(`nothing in trash for ${a.id}`);
  console.log("\nThe page also needs its KV record back (and, after WP10, its D1 pages row): see docs/backups.md.");
} else {
  die("usage: backup-restore.ts status|download|prepare|untrash ... (see the comment at the top)");
}
