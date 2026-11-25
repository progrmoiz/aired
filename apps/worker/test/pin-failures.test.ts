import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PIN_FAILURE_WINDOW_MS, PIN_MAX_FAILURES, releasePinAttempt, reservePinAttempt } from "../src/lib/pin-failures.ts";

function d1(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0005_pin_failures.sql", import.meta.url), "utf8"));
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { args = a; return stmt; },
      async first() { return (db.prepare(sql).get(...(args as never[])) as unknown) ?? null; },
      async run() { db.prepare(sql).run(...(args as never[])); return { meta: {} }; },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}

const T0 = 1_800_000_000_000;

test("at most the maximum attempts are admitted per window, even if none are released yet (a parallel burst)", async () => {
  const db = d1();
  const results = await Promise.all(Array.from({ length: PIN_MAX_FAILURES + 5 }, (_, i) => reservePinAttempt(db, "p1", T0 + i)));
  assert.equal(results.filter(Boolean).length, PIN_MAX_FAILURES);
  assert.equal(await reservePinAttempt(db, "p2", T0), true, "other pages aren't affected");
});

test("correct PINs give their slot back, so only wrong ones use the budget", async () => {
  const db = d1();
  for (let i = 0; i < 100; i++) {
    assert.equal(await reservePinAttempt(db, "p1", T0 + i), true, `entry ${i}`);
    await releasePinAttempt(db, "p1");
  }
});

test("the lock lifts when the window ends, and a new window counts from one", async () => {
  const db = d1();
  for (let i = 0; i < PIN_MAX_FAILURES; i++) await reservePinAttempt(db, "p1", T0);
  assert.equal(await reservePinAttempt(db, "p1", T0 + PIN_FAILURE_WINDOW_MS - 1), false);
  assert.equal(await reservePinAttempt(db, "p1", T0 + PIN_FAILURE_WINDOW_MS), true);
  for (let i = 1; i < PIN_MAX_FAILURES; i++) assert.equal(await reservePinAttempt(db, "p1", T0 + PIN_FAILURE_WINDOW_MS + i), true);
  assert.equal(await reservePinAttempt(db, "p1", T0 + PIN_FAILURE_WINDOW_MS + 100), false);
});

test("release never goes below zero and ignores unknown pages", async () => {
  const db = d1();
  await releasePinAttempt(db, "nobody");
  await reservePinAttempt(db, "p1", T0);
  await releasePinAttempt(db, "p1");
  await releasePinAttempt(db, "p1");
  for (let i = 0; i < PIN_MAX_FAILURES; i++) assert.equal(await reservePinAttempt(db, "p1", T0 + 1), true);
  assert.equal(await reservePinAttempt(db, "p1", T0 + 2), false);
});

test("verify-pin reserves before hashing and releases only after a correct PIN", () => {
  const viewer = readFileSync(new URL("../src/routes/viewer.ts", import.meta.url), "utf8");
  const reserve = viewer.indexOf("await reservePinAttempt(c.env.DB, id, Date.now())");
  const verify = viewer.indexOf("await verifyPin(pin, metadata.pin)");
  const release = viewer.indexOf("releasePinAttempt(c.env.DB, id)");
  assert.ok(reserve > 0 && reserve < verify && verify < release);
  assert.match(viewer, /if \(!check\.ok\) \{\s*return c\.json\(\{ error: "Incorrect PIN" \}, 403\);\s*\}/);
});
