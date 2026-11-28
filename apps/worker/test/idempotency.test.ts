import { setupApi, errorOf } from "./helpers/api-app.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

const { pruneIdempotencyKeys, IDEMPOTENCY_TTL_MS } = await import("../src/lib/idempotency.ts");

const html = (n: number | string = 1) => `<h1>Report ${n}</h1>`;
const publish = async (s: ReturnType<typeof setupApi>, key: string | null, body: Record<string, unknown> = { html: html() }, headers: Record<string, string> = {}) => {
  const res = await s.post("/api/publish", body, { ...(key !== null ? { "Idempotency-Key": key } : {}), ...headers });
  return { res, body: (await res.json()) as Record<string, any> };
};
const pageCount = (s: ReturnType<typeof setupApi>) => (s.raw.prepare("SELECT count(*) AS n FROM pages").get() as { n: number }).n;

test("a repeat with the same key and body answers the first response and makes no second page", async () => {
  const s = setupApi();
  const first = await publish(s, "k-1");
  assert.equal(first.res.status, 200);
  assert.equal(first.res.headers.get("Idempotent-Replayed"), null);
  const again = await publish(s, "k-1");
  assert.equal(again.res.status, 200);
  assert.equal(again.res.headers.get("Idempotent-Replayed"), "true");
  assert.deepEqual(again.body, first.body);
  assert.equal(pageCount(s), 1);
  // Without a key, every publish is a new page, as before.
  await publish(s, null);
  await publish(s, null);
  assert.equal(pageCount(s), 3);
});

test("the same key with a different body is a 422 and makes nothing", async () => {
  const s = setupApi();
  await publish(s, "k-2");
  const other = await s.post("/api/publish", { html: html(2) }, { "Idempotency-Key": "k-2" });
  assert.equal(other.status, 422);
  assert.equal((await errorOf(other)).code, "idempotency_key_reused");
  assert.equal(pageCount(s), 1);
});

test("keys belong to one account (or, anonymously, one network): the same key elsewhere is a new publish", async () => {
  const s = setupApi();
  const a = await publish(s, "shared", { html: html() }, { "X-Test-User": "1" });
  const b = await publish(s, "shared", { html: html() }, { "X-Test-User": "2" });
  const anon = await publish(s, "shared");
  const otherNet = await publish(s, "shared", { html: html() }, { "CF-Connecting-IP": "198.51.100.4" });
  assert.equal(new Set([a.body.id, b.body.id, anon.body.id, otherNet.body.id]).size, 4);
});

test("after 24 hours a key is forgotten and the same request publishes again", async () => {
  const s = setupApi();
  const first = await publish(s, "k-3");
  s.raw.prepare("UPDATE idempotency_keys SET created_at = created_at - ?").run(IDEMPOTENCY_TTL_MS + 1000);
  const later = await publish(s, "k-3");
  assert.equal(later.res.status, 200);
  assert.notEqual(later.body.id, first.body.id);
  assert.equal(later.res.headers.get("Idempotent-Replayed"), null);
  // And the key now replays the new answer.
  assert.equal((await publish(s, "k-3")).body.id, later.body.id);
});

test("a request that failed doesn't hold its key: fixing it and retrying with the same key works", async () => {
  const s = setupApi();
  const bad = await s.post("/api/publish", "{nope", { "Idempotency-Key": "k-4" });
  assert.equal(bad.status, 400);
  const good = await publish(s, "k-4");
  assert.equal(good.res.status, 200);
  assert.equal(pageCount(s), 1);
});

test("a key whose first request hasn't finished is a 409", async () => {
  const s = setupApi();
  await publish(s, "k-5");
  // The first request still running: its row has no answer yet.
  s.raw.prepare("UPDATE idempotency_keys SET status = NULL, response = NULL").run();
  const res = await publish(s, "k-5");
  assert.equal(res.res.status, 409);
  assert.equal(res.body.error.code, "idempotency_in_progress");
});

test("a key over 255 characters, or blank, is a 400", async () => {
  const s = setupApi();
  for (const key of ["x".repeat(256), " "]) {
    const res = await s.post("/api/publish", { html: html() }, { "Idempotency-Key": key });
    assert.equal(res.status, 400);
    assert.equal((await errorOf(res)).code, "invalid_idempotency_key");
  }
  assert.equal(pageCount(s), 0);
});

test("the stored answer is encrypted with the key: D1 never holds the update token", async () => {
  const s = setupApi();
  const { body } = await publish(s, "k-6");
  const rows = s.raw.prepare("SELECT * FROM idempotency_keys").all() as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  const dump = JSON.stringify(rows);
  assert.ok(!dump.includes(String(body.update_token)));
  assert.ok(!dump.includes("k-6"));
});

test("replays don't use up the publish limit", async () => {
  const s = setupApi();
  const ip = { "CF-Connecting-IP": "198.51.100.77" };
  for (let i = 0; i < 8; i++) assert.equal((await publish(s, "k-7", { html: html() }, ip)).res.status, 200);
  const row = s.raw.prepare("SELECT count FROM rate_limits WHERE bucket LIKE 'rl:ip:%'").get() as { count: number };
  assert.equal(row.count, 1);
});

test("housekeeping drops keys older than 24 hours", async () => {
  const s = setupApi();
  await publish(s, "old");
  await publish(s, "new");
  s.raw.prepare("UPDATE idempotency_keys SET created_at = created_at - ? WHERE rowid = 1").run(IDEMPOTENCY_TTL_MS + 1);
  assert.equal(await pruneIdempotencyKeys(s.env.DB, Date.now()), 1);
  assert.equal((s.raw.prepare("SELECT count(*) AS n FROM idempotency_keys").get() as { n: number }).n, 1);
});
