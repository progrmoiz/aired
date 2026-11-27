import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { blocksAccountDeletion, deleteAccountRows } from "../src/lib/billing/forget.ts";
import { resolveWebhookUid } from "../src/lib/billing/webhook-plan.ts";

const migration = (f: string) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8");

/** Enough of D1 over node:sqlite to run the real statements, batch included. */
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(migration("0001_accounts_billing.sql"));
  db.exec(migration("0002_billing_customers.sql"));
  db.exec(migration("0006_api_keys.sql"));
  db.exec(migration("0010_pages.sql"));
  db.exec(migration("0014_collect.sql"));
  db.exec(migration("0016_page_access.sql"));
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
  raw.prepare("INSERT INTO api_keys (id, user_id, name, prefix, key_hash, created_at) VALUES (?, ?, 'ci', 'aired_sk_x', ?, 1)").run(`key_${uid}`, uid, `hash_${uid}`);
  // What a viewer saved on one of their pages, and its live data.
  raw.prepare("INSERT INTO responses (id, page_id, owner_id, viewer, data, size, created_at, updated_at) VALUES (?, ?, ?, 'v', '{}', 2, 1, 1)").run(`r_${uid}`, `page${uid}`, uid);
  raw.prepare("INSERT INTO page_data (page_id, owner_id, data, updated_at) VALUES (?, ?, '[]', 1)").run(`page${uid}`, uid);
  // An "only these people" list, a live code and who opened the page.
  raw.prepare("INSERT INTO page_access (page_id, entry, owner_id, created_at) VALUES (?, 'client@example.com', ?, 1)").run(`page${uid}`, uid);
  raw.prepare("INSERT INTO access_codes (page_id, email_key, code_hash, expires_at, attempts, created_at) VALUES (?, 'k', 'h', 9999999999999, 0, 1)").run(`page${uid}`);
  raw.prepare("INSERT INTO access_log (page_id, email, owner_id, first_at, last_at, views) VALUES (?, 'client@example.com', ?, 1, 1, 1)").run(`page${uid}`, uid);
}

const OWNER_COLUMN: Record<string, string> = { users: "id", responses: "owner_id", page_data: "owner_id", page_access: "owner_id", access_log: "owner_id" };
const count = (raw: DatabaseSync, table: string, uid: number) =>
  (raw.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${OWNER_COLUMN[table] ?? "user_id"} = ?`).get(uid) as { n: number }).n;

test("account deletion removes the user's billing, sign-in and response rows, and only theirs", async () => {
  const { raw, d1: db } = d1();
  seed(raw, 1, "cus_1");
  seed(raw, 2, "cus_2");
  await deleteAccountRows(db, 1);
  for (const table of ["subscriptions", "billing_customers", "identities", "users", "api_keys", "responses", "page_data", "page_access", "access_log"]) {
    assert.equal(count(raw, table, 1), 0, table);
    assert.equal(count(raw, table, 2), 1, table);
  }
  // The deleted owner's live codes go too; the other owner's stay.
  const codes = (page: string) => (raw.prepare("SELECT count(*) AS n FROM access_codes WHERE page_id = ?").get(page) as { n: number }).n;
  assert.equal(codes("page1"), 0);
  assert.equal(codes("page2"), 1);
});

test("deleting an account with no billing rows is a no-op, not an error", async () => {
  const { d1: db } = d1();
  await deleteAccountRows(db, 99);
});

test("a webhook for a deleted account is refused, whichever way it finds the user", () => {
  // No customer row any more (deleted), metadata names the deleted user.
  assert.deepEqual(resolveWebhookUid(null, 4242, false), { uid: null, conflict: false, deletedUser: true });
  // A webhook already in flight still found our row: refused too.
  assert.deepEqual(resolveWebhookUid(4242, null, false), { uid: null, conflict: false, deletedUser: true });
  assert.deepEqual(resolveWebhookUid(7, 4242, false), { uid: null, conflict: true, deletedUser: true });
  // The account exists: our row wins, metadata is the fallback, as before.
  assert.deepEqual(resolveWebhookUid(null, 4242, true), { uid: 4242, conflict: false, deletedUser: false });
  assert.deepEqual(resolveWebhookUid(7, 4242, true), { uid: 7, conflict: true, deletedUser: false });
  assert.deepEqual(resolveWebhookUid(null, null, false), { uid: null, conflict: false, deletedUser: false });
});

test("only a subscription that will renew blocks account deletion", () => {
  assert.equal(blocksAccountDeletion([]), false);
  assert.equal(blocksAccountDeletion([{ cancelAtPeriodEnd: true }]), false);
  assert.equal(blocksAccountDeletion([{ cancelAtPeriodEnd: true }, { cancelAtPeriodEnd: false }]), true);
});

test("me.ts deletes the D1 rows before responding, refusing on failure, and asks Stripe when D1 has no subscription", () => {
  const code = readFileSync(new URL("../src/routes/me.ts", import.meta.url), "utf8");
  const del = code.indexOf("await deleteAccountRows(c.env.DB, userId, ");
  assert.ok(del > 0);
  assert.ok(del < code.indexOf("const response = c.json("), "D1 delete must run before the response");
  assert.ok(del < code.indexOf("c.executionCtx.waitUntil("), "D1 delete must not be in the background sweep");
  assert.match(code, /Could not delete your account records/);
  assert.match(code, /PAGES_KV\.delete\(`ent:\$\{userId\}`\)/);
  // Stripe is asked whenever a customer is known (a stored row or billing_customers), and a missing customer counts as none.
  assert.match(code, /const customerId = sub\?\.customerId \?\? \(await getCustomerId\(c\.env\.DB, userId\)\);/);
  assert.match(code, /live = await listActiveSubscriptions\(c\.env, customerId\);/);
  assert.match(code, /if \(!isMissingCustomer\(err\)\) throw err;/);
  assert.match(code, /if \(blocksAccountDeletion\(live\)\) return blocked;/);
  const billing = readFileSync(new URL("../src/routes/billing.ts", import.meta.url), "utf8");
  assert.match(billing, /const candidate = dbUid \?\? metadataUid;/);
  assert.match(billing, /userRowExists\(c\.env\.DB, candidate\)/);
});
