import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PIN_FAILURE_WINDOW_MS, PIN_MAX_FAILURES, pinEntryLocked, recordPinFailure } from "../src/lib/pin-failures.ts";

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

test("PIN entry locks after the maximum wrong entries in one window", async () => {
  const db = d1();
  for (let i = 0; i < PIN_MAX_FAILURES - 1; i++) await recordPinFailure(db, "p1", T0 + i);
  assert.equal(await pinEntryLocked(db, "p1", T0 + 100), false);
  await recordPinFailure(db, "p1", T0 + 200);
  assert.equal(await pinEntryLocked(db, "p1", T0 + 300), true);
  // Other pages aren't affected.
  assert.equal(await pinEntryLocked(db, "p2", T0 + 300), false);
});

test("the lock lifts when the window ends, and a new window starts counting from one", async () => {
  const db = d1();
  for (let i = 0; i < PIN_MAX_FAILURES; i++) await recordPinFailure(db, "p1", T0);
  assert.equal(await pinEntryLocked(db, "p1", T0 + PIN_FAILURE_WINDOW_MS - 1), true);
  assert.equal(await pinEntryLocked(db, "p1", T0 + PIN_FAILURE_WINDOW_MS), false);
  await recordPinFailure(db, "p1", T0 + PIN_FAILURE_WINDOW_MS + 5);
  assert.equal(await pinEntryLocked(db, "p1", T0 + PIN_FAILURE_WINDOW_MS + 10), false);
});

test("verify-pin checks the lock before hashing and counts only wrong entries", () => {
  const viewer = readFileSync(new URL("../src/routes/viewer.ts", import.meta.url), "utf8");
  const lock = viewer.indexOf("await pinEntryLocked(c.env.DB, id, now)");
  assert.ok(lock > 0 && lock < viewer.indexOf("await verifyPin(pin, metadata.pin)"));
  assert.match(viewer, /if \(!check\.ok\) \{\s*c\.executionCtx\.waitUntil\(\s*recordPinFailure\(c\.env\.DB, id, now\)/);
});
