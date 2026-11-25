import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { generateDeviceCode, generateUserCode, isNativeDeviceCode, normalizeUserCode } from "../src/lib/device-code.ts";
import { approveDeviceAuth, consumeDeviceAuth, createDeviceAuth, readDeviceAuth } from "../src/lib/device-auth.ts";

test("device codes carry the aired prefix; user codes are 8 unambiguous letters", () => {
  const d = generateDeviceCode();
  assert.match(d, /^aired_dc_[0-9A-Za-z]{40}$/);
  assert.equal(isNativeDeviceCode(d), true);
  assert.equal(isNativeDeviceCode("3584d83530557fdd1f46af8289938c8ef79f9dc5"), false, "GitHub's");
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const u = generateUserCode();
    assert.match(u, /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    seen.add(u);
  }
  assert.ok(seen.size > 190, "random");
  assert.notEqual(generateDeviceCode(), d);
});

test("typed user codes are normalized; anything else is refused", () => {
  assert.equal(normalizeUserCode("bcdf-ghjk"), "BCDF-GHJK");
  assert.equal(normalizeUserCode(" bcdf ghjk "), "BCDF-GHJK");
  assert.equal(normalizeUserCode("BCDFGHJK"), "BCDF-GHJK");
  assert.equal(normalizeUserCode("BCDF-GHJA"), null, "vowel");
  assert.equal(normalizeUserCode("BCDF-GHJ"), null);
  assert.equal(normalizeUserCode("BCDF-GHJK1"), null);
  assert.equal(normalizeUserCode(12345678), null);
});

function d1(): D1Database {
  const db = new DatabaseSync(":memory:");
  for (const f of ["0001_accounts_billing.sql", "0007_auth.sql"]) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { args = a; return stmt; },
      async first() { const r = db.prepare(sql).get(...(args as never[])); return r ? { ...(r as object) } : null; },
      async run() { const r = db.prepare(sql).run(...(args as never[])); return { meta: { changes: Number(r.changes) } }; },
      async all() { return { results: db.prepare(sql).all(...(args as never[])) }; },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}

test("a code is approved once, collected once, and dies when it expires", async () => {
  const db = d1();
  const T = 1_000_000;
  assert.equal(await createDeviceAuth(db, { deviceHash: "h1", userCode: "BCDF-GHJK", now: T, expiresAt: T + 600_000 }), true);
  // Not approved yet: nothing to collect.
  assert.equal(await consumeDeviceAuth(db, "h1", T + 1), null);
  assert.equal((await readDeviceAuth(db, "h1"))?.approved_user_id, null);
  assert.equal(await approveDeviceAuth(db, "BCDF-GHJK", 42, T + 2), true);
  // A second approval (someone else guessing the code) changes nothing.
  assert.equal(await approveDeviceAuth(db, "BCDF-GHJK", 99, T + 3), false);
  assert.equal(await consumeDeviceAuth(db, "h1", T + 4), 42);
  assert.equal(await consumeDeviceAuth(db, "h1", T + 5), null, "once");
  assert.notEqual((await readDeviceAuth(db, "h1"))?.consumed_at, null);

  await createDeviceAuth(db, { deviceHash: "h2", userCode: "LMNP-QRST", now: T, expiresAt: T + 600_000 });
  assert.equal(await approveDeviceAuth(db, "LMNP-QRST", 42, T + 600_001), false, "expired codes can't be approved");
  await createDeviceAuth(db, { deviceHash: "h3", userCode: "VWXZ-BCDF", now: T, expiresAt: T + 600_000 });
  await approveDeviceAuth(db, "VWXZ-BCDF", 42, T + 10);
  assert.equal(await consumeDeviceAuth(db, "h3", T + 600_001), null, "or collected after expiry");
});

test("a taken user code is reported so the caller picks another; expired rows are cleared", async () => {
  const db = d1();
  const T = 1_000_000;
  assert.equal(await createDeviceAuth(db, { deviceHash: "a", userCode: "BCDF-GHJK", now: T, expiresAt: T + 10 }), true);
  assert.equal(await createDeviceAuth(db, { deviceHash: "b", userCode: "BCDF-GHJK", now: T + 1, expiresAt: T + 600_000 }), false);
  // Later, once "a" has expired, the same user code is free again.
  assert.equal(await createDeviceAuth(db, { deviceHash: "c", userCode: "BCDF-GHJK", now: T + 11, expiresAt: T + 600_000 }), true);
  assert.equal(await readDeviceAuth(db, "a"), null);
});

test("wiring: the poll route sends aired codes to the native flow; approving needs a signed-in session and the CSRF header", () => {
  const auth = readFileSync(new URL("../src/routes/auth.ts", import.meta.url), "utf8");
  assert.match(auth, /if \(isNativeDeviceCode\(device_code\)\) return pollNativeDevice\(c, device_code\);\s*const limited = await githubPollLimit\(c, async \(\) => \{\}\);/);
  const device = readFileSync(new URL("../src/routes/auth-device.ts", import.meta.url), "utf8");
  assert.match(device, /'\/device\/approve',\s*requireAuth,\s*requireSession,\s*requireCsrfHeader,/);
  assert.match(device, /CLI_SESSION_MAX_AGE_SECONDS/);
  const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.ok(index.includes('app.route("/auth", authDevice);'));
});
