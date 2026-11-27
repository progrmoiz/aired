import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeD1 } from "./helpers/d1.ts";
import { BILLING_EVENTS_KEEP_DAYS, pruneBillingEvents, pruneRateLimits, takeDurableSlot } from "../src/lib/durable-limit.ts";

const HOUR = { limit: 5, windowSeconds: 3600 };
const T0 = 1_800_000_000_000;
const HOUR_MS = 3_600_000;

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

test("the window starts at the first request and the whole quota comes back one window later", async () => {
  const { db } = fakeD1();
  // A CI job using the whole quota at once, then again an hour later.
  assert.deepEqual(await take(db, 6, T0), [true, true, true, true, true, false]);
  assert.deepEqual(await take(db, 1, T0 + HOUR_MS - 1), [false]);
  assert.deepEqual(await take(db, 6, T0 + HOUR_MS), [true, true, true, true, true, false]);
});

test("the window is anchored to its first request, not to the clock hour", async () => {
  const { db } = fakeD1();
  await take(db, 1, T0 + 50 * 60_000); // first publish at :50
  await take(db, 4, T0 + 59 * 60_000);
  // At :10 the next hour, the window that began at :50 is still open.
  assert.deepEqual(await take(db, 1, T0 + 70 * 60_000), [false]);
  assert.deepEqual(await take(db, 1, T0 + 110 * 60_000), [true]);
});

test("a daily Pro window works the same way", async () => {
  const { db } = fakeD1();
  const day = { limit: 500, windowSeconds: 86400 };
  let allowed = 0;
  for (let i = 0; i < 510; i++) if (await takeDurableSlot(db, "rl:pro:7", day, T0 + i)) allowed++;
  assert.equal(allowed, 500);
  // A daily batch at 00:10 works again at 00:10 the next day.
  assert.equal(await takeDurableSlot(db, "rl:pro:7", day, T0 + 86_400_000), true);
});

test("a D1 error throws, so the caller can fall back", async () => {
  const d = fakeD1();
  d.fail(/rate_limits/);
  await assert.rejects(takeDurableSlot(d.db, "rl:ip:a", HOUR, T0), /injected failure/);
});

test("pruneRateLimits deletes only rows whose window has ended", async () => {
  const { db, raw } = fakeD1();
  await take(db, 1, T0);
  await take(db, 1, T0 + 2 * HOUR_MS, "rl:ip:b");
  assert.equal(await pruneRateLimits(db, T0 + 2 * HOUR_MS + 1000), 1);
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
