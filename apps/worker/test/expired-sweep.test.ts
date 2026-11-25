import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONFIRM_AFTER_MS,
  pageIdFromKey,
  sweepExpiredPages,
  SWEEP_BATCH,
  SWEEP_MIN_AGE_MS,
  type Candidate,
  type SweepDeps,
} from "../src/lib/expired-sweep.ts";

const NOW = Date.parse("2026-11-25T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const old = new Date(NOW - 10 * DAY);
const file = (id: string, etag = `e_${id}`, uploaded = old) => ({ key: `pages/${id}/index.html`, uploaded, etag });

function fake(objects: Array<{ key: string; uploaded: Date; etag: string }>, live: Set<string>, opts: {
  kvThrows?: Set<string>; truncated?: boolean; cursor?: string | null; candidates?: Map<string, Candidate>;
} = {}) {
  const state = {
    cursor: opts.cursor ?? (null as string | null),
    passDone: null as boolean | null,
    deleted: [] as string[],
    candidates: new Map(opts.candidates ?? []),
    listedWith: [] as Array<[string | null, number]>,
  };
  const deps: SweepDeps = {
    list: async (cursor, limit) => { state.listedWith.push([cursor, limit]); return { objects, truncated: opts.truncated ?? false, cursor: opts.truncated ? "next" : null }; },
    pageExists: async (id) => { if (opts.kvThrows?.has(id)) throw new Error("kv down"); return live.has(id); },
    deleteKeys: async (keys) => { state.deleted.push(...keys); },
    loadCursor: async () => state.cursor,
    saveCursor: async (c, done) => { state.cursor = c; state.passDone = done; },
    loadCandidates: async (keys) => new Map(keys.flatMap((k) => (state.candidates.has(k) ? [[k, state.candidates.get(k)!] as const] : []))),
    saveCandidates: async (put, drop) => { for (const [k, c] of put) state.candidates.set(k, c); for (const k of drop) state.candidates.delete(k); },
  };
  return { deps, state };
}

test("pageIdFromKey only matches page files", () => {
  assert.equal(pageIdFromKey("pages/abcDEF_-12/index.html"), "abcDEF_-12");
  assert.equal(pageIdFromKey("pages/abc/other.png"), null);
  assert.equal(pageIdFromKey("pages/abc/index.html.bak"), null);
  assert.equal(pageIdFromKey("og/abc.png"), null);
  assert.equal(pageIdFromKey("pages//index.html"), null);
  assert.equal(pageIdFromKey("pages/a/b/index.html"), null);
});

test("a missing KV record only marks the file the first time; nothing is deleted", async () => {
  const f = fake([file("gone"), file("live")], new Set(["live"]));
  const out = await sweepExpiredPages(f.deps, NOW);
  assert.deepEqual(out, { scanned: 2, deleted: [], marked: 1 });
  assert.deepEqual([...f.state.candidates], [["pages/gone/index.html", { etag: "e_gone", firstSeen: NOW }]]);
});

test("a file goes only when seen missing again a day later, unchanged", async () => {
  const candidates = new Map([["pages/gone/index.html", { etag: "e_gone", firstSeen: NOW - CONFIRM_AFTER_MS }]]);
  const f = fake([file("gone")], new Set(), { candidates });
  assert.deepEqual((await sweepExpiredPages(f.deps, NOW)).deleted, ["pages/gone/index.html"]);
  assert.deepEqual(f.state.deleted, ["pages/gone/index.html"]);
  assert.equal(f.state.candidates.size, 0);
});

test("seen again too soon: kept, and the first sighting isn't reset", async () => {
  const first = NOW - CONFIRM_AFTER_MS + 1;
  const f = fake([file("gone")], new Set(), { candidates: new Map([["pages/gone/index.html", { etag: "e_gone", firstSeen: first }]]) });
  assert.deepEqual((await sweepExpiredPages(f.deps, NOW)).deleted, []);
  assert.equal(f.state.candidates.get("pages/gone/index.html")?.firstSeen, first);
});

test("a file rewritten since it was marked starts over", async () => {
  const f = fake([file("gone", "e_new")], new Set(), { candidates: new Map([["pages/gone/index.html", { etag: "e_old", firstSeen: NOW - 5 * DAY }]]) });
  assert.deepEqual((await sweepExpiredPages(f.deps, NOW)).deleted, []);
  assert.deepEqual(f.state.candidates.get("pages/gone/index.html"), { etag: "e_new", firstSeen: NOW });
});

test("a page that turns out to be live is unmarked", async () => {
  const f = fake([file("back")], new Set(["back"]), { candidates: new Map([["pages/back/index.html", { etag: "e_back", firstSeen: NOW - 5 * DAY }]]) });
  assert.deepEqual((await sweepExpiredPages(f.deps, NOW)).deleted, []);
  assert.equal(f.state.candidates.size, 0);
});

test("a KV error keeps the file and its mark as they are", async () => {
  const mark = { etag: "e_flaky", firstSeen: NOW - 5 * DAY };
  const f = fake([file("flaky")], new Set(), { kvThrows: new Set(["flaky"]), candidates: new Map([["pages/flaky/index.html", mark]]) });
  assert.deepEqual((await sweepExpiredPages(f.deps, NOW)).deleted, []);
  assert.deepEqual(f.state.candidates.get("pages/flaky/index.html"), mark);
});

test("files written in the last day and non-page keys aren't looked at", async () => {
  let kvReads = 0;
  const f = fake([file("young", "e", new Date(NOW - SWEEP_MIN_AGE_MS + 1)), { key: "pages/x/thumb.png", uploaded: old, etag: "t" }], new Set());
  const exists = f.deps.pageExists;
  f.deps.pageExists = async (id) => { kvReads++; return exists(id); };
  assert.deepEqual(await sweepExpiredPages(f.deps, NOW), { scanned: 2, deleted: [], marked: 0 });
  assert.equal(kvReads, 0);
});

test("continues from the saved cursor in batches, and reports the end of a pass", async () => {
  const mid = fake([], new Set(), { cursor: "c1", truncated: true });
  await sweepExpiredPages(mid.deps, NOW);
  assert.deepEqual(mid.state.listedWith, [["c1", SWEEP_BATCH]]);
  assert.deepEqual([mid.state.cursor, mid.state.passDone], ["next", false]);
  const end = fake([], new Set(), { cursor: "c9", truncated: false });
  await sweepExpiredPages(end.deps, NOW);
  assert.deepEqual([end.state.cursor, end.state.passDone], [null, true]);
});

test("a failing delete leaves the cursor and marks unsaved, so the batch is retried", async () => {
  const candidates = new Map([["pages/gone/index.html", { etag: "e_gone", firstSeen: NOW - 2 * DAY }]]);
  const f = fake([file("gone")], new Set(), { cursor: "c1", truncated: true, candidates });
  f.deps.deleteKeys = async () => { throw new Error("r2 down"); };
  await assert.rejects(sweepExpiredPages(f.deps, NOW), /r2 down/);
  assert.equal(f.state.cursor, "c1");
  assert.equal(f.state.candidates.size, 1);
});

test("index.ts wires the cron to the sweep through kvKeys.page and the pages/ prefix", () => {
  const code = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(code, /scheduled\(_controller: ScheduledController, env: Env, ctx: ExecutionContext\) \{\s*ctx\.waitUntil\(runExpiredSweep\(env\)\)/);
  assert.match(code, /PAGES_KV\.get\(kvKeys\.page\(id\)\)\) !== null/);
  assert.match(code, /PAGES_BUCKET\.list\(\{ prefix: "pages\/"/);
  assert.match(code, /etag: o\.etag/);
  assert.match(code, /fetch: app\.fetch/);
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /\[triggers\]\s*\ncrons = \["\*\/5 \* \* \* \*"\]/);
});
