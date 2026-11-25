import { test } from "node:test";
import assert from "node:assert/strict";
import { pageIdFromKey, sweepExpiredPages, SWEEP_BATCH, SWEEP_GRACE_MS, type SweepDeps } from "../src/lib/expired-sweep.ts";

const NOW = Date.parse("2026-11-25T12:00:00Z");
const old = new Date(NOW - SWEEP_GRACE_MS - 1000);
const fresh = new Date(NOW - SWEEP_GRACE_MS + 60_000);

function fake(objects: Array<{ key: string; uploaded: Date }>, live: Set<string>, opts: { kvThrows?: Set<string>; truncated?: boolean; cursor?: string | null } = {}) {
  const state = { cursor: opts.cursor ?? null as string | null, deleted: [] as string[], listedWith: [] as Array<[string | null, number]> };
  const deps: SweepDeps = {
    list: async (cursor, limit) => { state.listedWith.push([cursor, limit]); return { objects, truncated: opts.truncated ?? false, cursor: opts.truncated ? "next" : null }; },
    pageExists: async (id) => { if (opts.kvThrows?.has(id)) throw new Error("kv down"); return live.has(id); },
    deleteKeys: async (keys) => { state.deleted.push(...keys); },
    loadCursor: async () => state.cursor,
    saveCursor: async (c) => { state.cursor = c; },
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

test("deletes old files whose KV page record is gone, and nothing else", async () => {
  const f = fake(
    [
      { key: "pages/gone/index.html", uploaded: old },
      { key: "pages/live/index.html", uploaded: old },
      { key: "pages/newgone/index.html", uploaded: fresh }, // KV may just be lagging
      { key: "pages/x/thumb.png", uploaded: old },
    ],
    new Set(["live"]),
  );
  const out = await sweepExpiredPages(f.deps, NOW);
  assert.deepEqual(out, { scanned: 4, deleted: ["pages/gone/index.html"] });
  assert.deepEqual(f.state.deleted, ["pages/gone/index.html"]);
});

test("a KV error keeps the file", async () => {
  const f = fake([{ key: "pages/flaky/index.html", uploaded: old }], new Set(), { kvThrows: new Set(["flaky"]) });
  assert.deepEqual((await sweepExpiredPages(f.deps, NOW)).deleted, []);
  assert.deepEqual(f.state.deleted, []);
});

test("the grace period is exact: just under is kept, just over can go", async () => {
  const at = (ms: number) => fake([{ key: "pages/p/index.html", uploaded: new Date(NOW - ms) }], new Set());
  assert.deepEqual((await sweepExpiredPages(at(SWEEP_GRACE_MS - 1).deps, NOW)).deleted, []);
  assert.deepEqual((await sweepExpiredPages(at(SWEEP_GRACE_MS).deps, NOW)).deleted, ["pages/p/index.html"]);
});

test("continues from the saved cursor in batches, and starts over at the end", async () => {
  const mid = fake([], new Set(), { cursor: "c1", truncated: true });
  await sweepExpiredPages(mid.deps, NOW);
  assert.deepEqual(mid.state.listedWith, [["c1", SWEEP_BATCH]]);
  assert.equal(mid.state.cursor, "next");
  const end = fake([], new Set(), { cursor: "c9", truncated: false });
  await sweepExpiredPages(end.deps, NOW);
  assert.equal(end.state.cursor, null);
});

test("no delete call when there is nothing to delete", async () => {
  let calls = 0;
  const f = fake([{ key: "pages/live/index.html", uploaded: old }], new Set(["live"]));
  f.deps.deleteKeys = async () => { calls++; };
  await sweepExpiredPages(f.deps, NOW);
  assert.equal(calls, 0);
});

test("index.ts wires the cron to the sweep with page:<id> lookups and the pages/ prefix", async () => {
  const { readFileSync } = await import("node:fs");
  const code = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(code, /scheduled\(_controller: ScheduledController, env: Env, ctx: ExecutionContext\) \{\s*ctx\.waitUntil\(runExpiredSweep\(env\)\)/);
  assert.match(code, /PAGES_KV\.get\(`page:\$\{id\}`\)\) !== null/);
  assert.match(code, /PAGES_BUCKET\.list\(\{ prefix: "pages\/"/);
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /\[triggers\]\s*\ncrons = \["\*\/30 \* \* \* \*"\]/);
});
