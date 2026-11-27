import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeD1 } from "./helpers/d1.ts";
import { BILLING_EVENTS_KEEP_DAYS, pruneBillingEvents, pruneRateLimits, takeDurableSlot } from "../src/lib/durable-limit.ts";

const HOUR = { limit: 5, windowSeconds: 3600 };
const T0 = 1_800_000_000_000 - (1_800_000_000_000 % 3_600_000); // start of an hour window

async function take(db: D1Database, n: number, at: number, bucket = "rl:ip:a", tier = HOUR): Promise<boolean[]> {
  const out: boolean[] = [];
  for (let i = 0; i < n; i++) out.push(await takeDurableSlot(db, bucket, tier, at));
  return out;
}

test("allows up to the limit in a window, then refuses", async () => {
  const { db } = fakeD1();
  assert.deepEqual(await take(db, 7, T0 + 1000), [true, true, true, true, true, false, false]);
});

test("a refused request isn't counted", async () => {
  const { db, raw } = fakeD1();
  await take(db, 9, T0 + 1000);
  const row = raw.prepare("SELECT count FROM rate_limits WHERE bucket = 'rl:ip:a'").get() as { count: number };
  assert.equal(row.count, 5);
});

test("buckets are separate", async () => {
  const { db } = fakeD1();
  await take(db, 5, T0);
  assert.deepEqual(await take(db, 1, T0, "rl:ip:b"), [true]);
  assert.deepEqual(await take(db, 1, T0, "rl:ip:a"), [false]);
});

test("the count is shared by every caller of the same database (not per isolate)", async () => {
  const { db } = fakeD1();
  // Two "isolates" with nothing in common but D1.
  const results = await Promise.all([take(db, 3, T0 + 5), take(db, 3, T0 + 5)]);
  assert.equal(results.flat().filter(Boolean).length, 5);
});

test("the previous window still counts, fading out: no doubling up at a boundary", async () => {
  const { db } = fakeD1();
  await take(db, 5, T0 + 3_599_000); // 5 at the very end of window 1
  // Right after the boundary, the previous window weighs ~1: nothing left.
  assert.deepEqual(await take(db, 1, T0 + 3_601_000), [false]);
  // Half-way through window 2, it weighs 0.5: 2.5 used, so 2 more fit.
  assert.deepEqual(await take(db, 3, T0 + 3_600_000 + 1_800_000), [true, true, false]);
  // Two windows later the old one is gone.
  assert.deepEqual(await take(db, 5, T0 + 3 * 3_600_000 + 1000), [true, true, true, true, true]);
});

test("a daily Pro window works the same way", async () => {
  const { db } = fakeD1();
  const day = { limit: 500, windowSeconds: 86400 };
  const start = 1_800_000_000_000 - (1_800_000_000_000 % 86_400_000);
  let allowed = 0;
  for (let i = 0; i < 510; i++) if (await takeDurableSlot(db, "rl:pro:7", day, start + i)) allowed++;
  assert.equal(allowed, 500);
});

test("a D1 error throws, so the caller can fall back", async () => {
  const d = fakeD1();
  d.fail(/rate_limits/);
  await assert.rejects(takeDurableSlot(d.db, "rl:ip:a", HOUR, T0), /injected failure/);
});

test("pruneRateLimits deletes only rows past their expiry", async () => {
  const { db, raw } = fakeD1();
  await take(db, 1, T0);
  await take(db, 1, T0 + 2 * 3_600_000, "rl:ip:b");
  assert.equal(await pruneRateLimits(db, T0 + 2 * 3_600_000 + 1000), 1);
  const left = raw.prepare("SELECT bucket FROM rate_limits").all() as Array<{ bucket: string }>;
  assert.deepEqual(left.map((r) => r.bucket), ["rl:ip:b"]);
});

test("pruneBillingEvents keeps the last 30 days of webhook ids", async () => {
  const { db, raw } = fakeD1();
  const now = Date.parse("2026-11-27T00:00:00Z");
  const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();
  raw.prepare("INSERT INTO billing_events (event_id, type, received_at) VALUES (?, ?, ?)").run("old", "x", iso(BILLING_EVENTS_KEEP_DAYS + 1));
  raw.prepare("INSERT INTO billing_events (event_id, type, received_at) VALUES (?, ?, ?)").run("new", "x", iso(2));
  assert.equal(await pruneBillingEvents(db, now), 1);
  const left = raw.prepare("SELECT event_id FROM billing_events").all() as Array<{ event_id: string }>;
  assert.deepEqual(left.map((r) => r.event_id), ["new"]);
});
