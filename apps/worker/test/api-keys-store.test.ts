import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  findActiveKey,
  insertKey,
  lastUsedDue,
  LAST_USED_EVERY_MS,
  listKeys,
  MAX_ACTIVE_KEYS,
  normalizeKeyName,
  revokeKey,
  touchKey,
} from "../src/lib/api-keys.ts";
import { bearerToken, readUpdateToken } from "../src/lib/page-token.ts";
import { csrfHeaderRequired } from "../src/lib/csrf-rule.ts";

function d1(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0006_api_keys.sql", import.meta.url), "utf8"));
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { args = a; return stmt; },
      async first() { return (db.prepare(sql).get(...(args as never[])) as unknown) ?? null; },
      async run() { const r = db.prepare(sql).run(...(args as never[])); return { meta: { changes: Number(r.changes) } }; },
      async all() { return { results: db.prepare(sql).all(...(args as never[])) }; },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}

const key = (n: number, userId = 1) => ({ id: `key_${n}`, userId, name: `k${n}`, prefix: `aired_sk_${n}`, keyHash: `h${userId}_${n}`, createdAt: 1000 + n });

test("a stored key is found by hash until it's revoked", async () => {
  const db = d1();
  assert.equal(await insertKey(db, key(1)), true);
  assert.deepEqual(await findActiveKey(db, "h1_1"), { id: "key_1", userId: 1, createdAt: 1001, lastUsedAt: null });
  assert.equal(await findActiveKey(db, "nope"), null);
  assert.equal(await revokeKey(db, 2, "key_1", 5000), false, "another user can't revoke it");
  assert.equal(await revokeKey(db, 1, "key_1", 5000), true);
  assert.equal(await findActiveKey(db, "h1_1"), null);
  assert.equal(await revokeKey(db, 1, "key_1", 6000), false, "already revoked");
});

test("at most five active keys per user, counted in the same statement as the insert", async () => {
  const db = d1();
  const results = await Promise.all(Array.from({ length: MAX_ACTIVE_KEYS + 3 }, (_, i) => insertKey(db, key(i))));
  assert.equal(results.filter(Boolean).length, MAX_ACTIVE_KEYS);
  assert.equal(await insertKey(db, key(99, 2)), true, "other users have their own limit");
  await revokeKey(db, 1, "key_0", 9000);
  assert.equal(await insertKey(db, key(50)), true, "a revoked key frees a slot");
});

test("the list shows only active keys, newest first, and never the hash", async () => {
  const db = d1();
  for (const n of [1, 2, 3]) await insertKey(db, key(n));
  await revokeKey(db, 1, "key_2", 9000);
  const list = await listKeys(db, 1);
  assert.deepEqual(list.map((k) => k.id), ["key_3", "key_1"]);
  assert.deepEqual(Object.keys(list[0]!).sort(), ["createdAt", "id", "lastUsedAt", "name", "prefix"]);
});

test("last used is written at most hourly", async () => {
  const db = d1();
  await insertKey(db, key(1));
  assert.equal(lastUsedDue(null, 5000), true);
  await touchKey(db, "key_1", 5000);
  assert.equal((await findActiveKey(db, "h1_1"))?.lastUsedAt, 5000);
  assert.equal(lastUsedDue(5000, 5000 + LAST_USED_EVERY_MS - 1), false);
  assert.equal(lastUsedDue(5000, 5000 + LAST_USED_EVERY_MS), true);
});

test("key names are trimmed and limited", () => {
  assert.equal(normalizeKeyName("  CI deploy  "), "CI deploy");
  assert.equal(normalizeKeyName(""), null);
  assert.equal(normalizeKeyName("   "), null);
  assert.equal(normalizeKeyName("x".repeat(61)), null);
  assert.equal(normalizeKeyName("x".repeat(60)), "x".repeat(60));
  assert.equal(normalizeKeyName("bad\nname"), null);
  assert.equal(normalizeKeyName(42), null);
});

test("an API key in the Authorization header is never read as an update token", () => {
  assert.equal(readUpdateToken(undefined, "Bearer aired_sk_000000000000000000000000000000002wjyrI"), null);
  assert.equal(readUpdateToken("at_body", "Bearer aired_sk_x"), "at_body");
  assert.equal(readUpdateToken(undefined, "Bearer at_abc"), "at_abc");
});

test("key-authenticated writes need no CSRF header (no session cookie)", () => {
  assert.equal(csrfHeaderRequired("POST", false), false);
  assert.equal(csrfHeaderRequired("DELETE", false), false);
});

test("wiring: keys are checked before sessions; keys can't manage keys, billing or the account", () => {
  const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  const auth = src("middleware/auth.ts");
  assert.ok(auth.indexOf("return keyAuth(c, next,") < auth.indexOf("const cookieValue = readSessionCookie(c);"));
  assert.match(auth, /if \(!parsed\.ok\) return c\.json\(\{ error: 'Invalid API key' \}, 401\);/);
  assert.match(auth, /if \(found === null\) return c\.json\(\{ error: 'Invalid or revoked API key' \}, 401\);/);
  assert.match(src("routes/keys.ts"), /keys\.use\('\*', requireSession\);/);
  assert.match(src("routes/me.ts"), /me\.delete\('\/', requireSession, requireCsrfHeader,/);
  const billing = src("routes/billing.ts");
  assert.match(billing, /billing\.post\('\/checkout', requireSession,/);
  assert.match(billing, /billing\.post\('\/portal', requireSession,/);
  assert.match(src("lib/billing/forget.ts"), /DELETE FROM api_keys WHERE user_id = \?/);
  const index = src("index.ts");
  assert.ok(index.indexOf('app.route("/api/me/keys", keys)') < index.indexOf('app.route("/api/me", me)'));
});

test("Bearer parsing is case-insensitive and tolerates spacing, so a key is never dropped to anonymous", () => {
  const key = "aired_sk_000000000000000000000000000000002wjyrI";
  for (const h of [`Bearer ${key}`, `bearer ${key}`, `BEARER  ${key}`, `  Bearer ${key}  `]) {
    assert.equal(bearerToken(h), key, h);
    assert.equal(readUpdateToken(undefined, h), null, h);
  }
  assert.equal(bearerToken("Basic abc"), null);
  assert.equal(bearerToken("Bearer"), null);
  assert.equal(bearerToken("Bearer a b"), null);
  assert.equal(bearerToken(undefined), null);
  assert.equal(readUpdateToken(undefined, "bearer at_x"), "at_x");
});

test("wiring: keys can't use /upgrade, can't sit in the session header, die with SESSION_VALID_SINCE, and key responses aren't stored", () => {
  const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  const auth = src("middleware/auth.ts");
  assert.match(auth, /const bearer = bearerToken\(c\.req\.header\('Authorization'\)\);\s*if \(bearer\?\.startsWith\(API_KEY_PREFIX\)\)/);
  assert.match(auth, /if \(headerValue\?\.trim\(\)\.startsWith\(API_KEY_PREFIX\)\) \{\s*return c\.json/);
  assert.match(auth, /if \(!isNaN\(validSince\) && found\.createdAt < validSince\) \{/);
  assert.match(src("routes/billing.ts"), /if \(c\.get\('authMethod'\) !== 'session'\) \{\s*return c\.json\(\{ error: 'Sign in to buy Pro/);
  assert.match(src("routes/keys.ts"), /c\.header\('Cache-Control', 'no-store'\);/);
});
