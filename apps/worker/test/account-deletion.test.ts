import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { deleteAccountRows } from "../src/lib/billing/forget.ts";
import { resolveWebhookUid } from "../src/lib/billing/webhook-plan.ts";

const migration = (f: string) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8");

/** Enough of D1 over node:sqlite to run the real statements, batch included. */
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(migration("0001_accounts_billing.sql"));
  db.exec(migration("0002_billing_customers.sql"));
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { args = a; return stmt; },
      run: () => db.prepare(sql).run(...(args as never[])),
    };
    return stmt;
  };
  const batch = async (stmts: Array<{ run: () => unknown }>) => {
    db.exec("BEGIN");
    try { for (const s of stmts) s.run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  return { raw: db, d1: { prepare, batch } as unknown as D1Database };
}

function seed(raw: DatabaseSync, uid: number, cus: string) {
  const now = "2026-11-25T00:00:00Z";
  raw.prepare("INSERT INTO users (id, email, name, login, created_at) VALUES (?, ?, ?, ?, ?)").run(uid, `u${uid}@example.com`, "U", `u${uid}`, now);
  raw.prepare("INSERT INTO identities (provider, subject, user_id, email, created_at) VALUES ('github', ?, ?, ?, ?)").run(String(uid), uid, `u${uid}@example.com`, now);
  raw.prepare("INSERT INTO billing_customers (user_id, customer_id, created_at) VALUES (?, ?, ?)").run(uid, cus, now);
  raw.prepare("INSERT INTO subscriptions (user_id, provider, customer_id, subscription_id, plan, status, updated_at) VALUES (?, 'stripe', ?, ?, 'pro', 'active', ?)").run(uid, cus, `sub_${uid}`, now);
}

const count = (raw: DatabaseSync, table: string, uid: number) =>
  (raw.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${table === "users" ? "id" : "user_id"} = ?`).get(uid) as { n: number }).n;

test("account deletion removes the user's billing and sign-in rows, and only theirs", async () => {
  const { raw, d1: db } = d1();
  seed(raw, 1, "cus_1");
  seed(raw, 2, "cus_2");
  await deleteAccountRows(db, 1);
  for (const table of ["subscriptions", "billing_customers", "identities", "users"]) {
    assert.equal(count(raw, table, 1), 0, table);
    assert.equal(count(raw, table, 2), 1, table);
  }
});

test("deleting an account with no billing rows is a no-op, not an error", async () => {
  const { d1: db } = d1();
  await deleteAccountRows(db, 99);
});

test("a late webhook can't re-create a deleted account's rows through metadata", () => {
  // No customer row any more (deleted), metadata names the deleted user.
  assert.deepEqual(resolveWebhookUid(null, 4242, false), { uid: null, conflict: false, deletedUser: true });
  // The account still exists: metadata is the fallback, as before.
  assert.deepEqual(resolveWebhookUid(null, 4242, true), { uid: 4242, conflict: false, deletedUser: false });
  // Our own customer row always wins.
  assert.deepEqual(resolveWebhookUid(7, 4242, false), { uid: 7, conflict: true, deletedUser: false });
  assert.deepEqual(resolveWebhookUid(null, null, false), { uid: null, conflict: false, deletedUser: false });
});

test("me.ts deletes the D1 rows and the Pro projection during account deletion", () => {
  const code = readFileSync(new URL("../src/routes/me.ts", import.meta.url), "utf8");
  assert.match(code, /deleteAccountRows\(c\.env\.DB, userId\)/);
  assert.match(code, /PAGES_KV\.delete\(`ent:\$\{userId\}`\)/);
});
