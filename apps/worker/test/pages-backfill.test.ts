import { test } from "node:test";
import assert from "node:assert/strict";
import type { PageMetadata } from "@aired/core";
import { fakeD1 } from "./helpers/d1.ts";
import { backfillBatch, emptyCounts, mergeReports, type BackfillDeps, type BackfillReport } from "../src/lib/pages-backfill.ts";
import { getPageRow, insertPageRow, listOwnerPages, rowFromMetadata } from "../src/lib/pages-store.ts";
import { tombstoneClaim, upsertClaim } from "../src/lib/page-claims.ts";

const NOW = Date.parse("2026-11-27T12:00:00Z");
const HOUR = 3_600_000;

function meta(id: string, over: Partial<PageMetadata> = {}): PageMetadata {
  return {
    id, title: id, size: 10, tokenHash: `h_${id}`, pin: null, reads: null, readCount: 0, permanent: false,
    createdAt: new Date(NOW - HOUR).toISOString(), expiresAt: new Date(NOW + HOUR).toISOString(), ownerId: null, project: null, ...over,
  };
}

/** KV as a sorted map; cursor = index. `parse` is JSON with the id check the real parseMetadata implies. */
function deps(kv: Map<string, string>, db: D1Database): BackfillDeps & { gets: number[] } {
  const gets: number[] = [];
  return {
    db,
    gets,
    kvList: async (cursor, limit) => {
      const keys = [...kv.keys()].filter((k) => k.startsWith("page:")).sort();
      const start = cursor === null ? 0 : Number(cursor);
      return { keys: keys.slice(start, start + limit), cursor: start + limit < keys.length ? String(start + limit) : null };
    },
    kvGetMany: async (keys) => { gets.push(keys.length); return new Map(keys.map((k) => [k, kv.get(k) ?? null])); },
    parse: (raw) => { try { const m = JSON.parse(raw); return typeof m?.id === "string" && typeof m.tokenHash === "string" ? m : null; } catch { return null; } },
  };
}

async function runAll(d: BackfillDeps, dryRun: boolean, limit = 2) {
  let total: BackfillReport = { dryRun, counts: emptyCounts(), samples: { corrupt: [], differs: [], claimOverridesKv: [], tombstoned: [] }, cursor: null };
  let cursor: string | null = null;
  let batches = 0;
  do {
    const r = await backfillBatch(d, { cursor, limit, dryRun, now: NOW });
    total = mergeReports(total, r);
    cursor = r.cursor;
    batches++;
  } while (cursor !== null);
  return { total, batches };
}

function world() {
  const { db } = fakeD1();
  const kv = new Map<string, string>();
  const put = (m: PageMetadata) => kv.set(`page:${m.id}`, JSON.stringify(m));
  put(meta("anon"));
  put(meta("owned", { ownerId: 1, project: "docs", permanent: true, expiresAt: null }));
  put(meta("claimed", { ownerId: null, tokenHash: "h_stale" })); // KV written back stale
  put(meta("deleted"));
  put(meta("old", { expiresAt: new Date(NOW - 1).toISOString() }));
  put(meta("already", { ownerId: 2 }));
  kv.set("page:broken", "{not json");
  kv.set("user:1", "{}"); // not a page
  return { db, kv, put };
}

test("dry run counts everything and writes nothing", async () => {
  const { db, kv } = world();
  await upsertClaim(db, "claimed", { ownerId: 3, tokenHash: "h_new", prevTokenHash: "h_stale", claimedAt: 1 }, "h_stale");
  await tombstoneClaim(db, "deleted", 1);
  await insertPageRow(db, rowFromMetadata(meta("already", { ownerId: 4 }), null, NOW)); // claimed since, say
  const { total } = await runAll(deps(kv, db), true);
  assert.deepEqual(
    { ...total.counts },
    { ...emptyCounts(), scanned: 7, corrupt: 1, alreadyInD1: 1, differs: 1, toInsert: 5, owned: 2, anonymous: 3, fromClaim: 2, claimOverridesKv: 1, tombstoned: 1, expired: 1, withProject: 1, permanent: 1 },
  );
  assert.deepEqual(total.samples.corrupt, ["broken"]);
  assert.deepEqual(total.samples.claimOverridesKv, ["claimed"]);
  assert.equal(await getPageRow(db, "anon"), null, "nothing written");
});

test("a real run inserts the rows, with claim rows deciding owner and token, and is idempotent", async () => {
  const { db, kv } = world();
  await upsertClaim(db, "claimed", { ownerId: 3, tokenHash: "h_new", prevTokenHash: "h_stale", claimedAt: 1 }, "h_stale");
  await tombstoneClaim(db, "deleted", 1);
  const existing = rowFromMetadata(meta("already", { ownerId: 4, title: "newer" }), null, NOW);
  await insertPageRow(db, existing);

  const d = deps(kv, db);
  const first = await runAll(d, false);
  assert.equal(first.total.counts.inserted, 5);
  assert.ok(d.gets.every((n) => n <= 100));

  const claimed = (await getPageRow(db, "claimed"))!;
  assert.deepEqual([claimed.ownerId, claimed.tokenHash, claimed.prevTokenHash], [3, "h_new", "h_stale"]);
  assert.notEqual((await getPageRow(db, "deleted"))!.deletedAt, null);
  assert.deepEqual(await getPageRow(db, "already"), existing, "an existing row is never touched");
  assert.equal(await getPageRow(db, "broken"), null);

  const owned = await listOwnerPages(db, 1, { kind: "all" }, undefined, 20, NOW);
  assert.deepEqual(owned.rows.map((r) => r.id), ["owned"]);

  const again = await runAll(deps(kv, db), false, 100);
  assert.equal(again.total.counts.inserted, 0);
  assert.equal(again.total.counts.alreadyInD1, 6);
  assert.equal(again.batches, 1);
});

test("resumes from any cursor and caps the batch size", async () => {
  const { db } = fakeD1();
  const kv = new Map<string, string>();
  for (let i = 0; i < 1200; i++) kv.set(`page:p${String(i).padStart(4, "0")}`, JSON.stringify(meta(`p${String(i).padStart(4, "0")}`)));
  const d = deps(kv, db);
  const r1 = await backfillBatch(d, { cursor: null, limit: 10_000, dryRun: false, now: NOW });
  assert.equal(r1.counts.scanned, 500, "capped at BACKFILL_MAX_LIMIT");
  const r2 = await backfillBatch(d, { cursor: r1.cursor, limit: 500, dryRun: false, now: NOW });
  const r3 = await backfillBatch(d, { cursor: r2.cursor, limit: 500, dryRun: false, now: NOW });
  assert.equal(r3.cursor, null);
  assert.equal(r1.counts.inserted + r2.counts.inserted + r3.counts.inserted, 1200);
});
