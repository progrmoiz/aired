import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { decideLink, isGithubId, isGithubNoreply, loginFor, normalizeEmail, type LinkInput } from "../src/lib/user-link.ts";
import { createUser, ensureUserRow, findIdentityUser, findVerifiedEmailOwner, identityEmails, linkIdentity, userHasIdentities } from "../src/lib/users.ts";

const base: LinkInput = { workosIdentityUserId: null, githubAccountUserId: null, email: null, emailVerified: false, verifiedEmailOwner: null };

test("a known WorkOS identity wins over everything", () => {
  assert.deepEqual(decideLink({ ...base, workosIdentityUserId: 5, githubAccountUserId: 9, email: "a@b.co", emailVerified: true, verifiedEmailOwner: 7 }), { kind: "existing", userId: 5, via: "workos" });
});

test("a GitHub sign-in links to the account that GitHub id signs in as", () => {
  assert.deepEqual(decideLink({ ...base, githubAccountUserId: 9001 }), { kind: "existing", userId: 9001, via: "github" });
  // Its identity may point at a newer account, not the GitHub id itself.
  assert.deepEqual(decideLink({ ...base, githubAccountUserId: 1_000_000_000_007 }), { kind: "existing", userId: 1_000_000_000_007, via: "github" });
  assert.deepEqual(decideLink({ ...base }), { kind: "new" });
});

test("only plausible GitHub ids count", () => {
  assert.equal(isGithubId(4242), true);
  assert.equal(isGithubId(999_999_999_999), true);
  assert.equal(isGithubId(1_000_000_000_000), false);
  assert.equal(isGithubId(0), false);
  assert.equal(isGithubId(-1), false);
  assert.equal(isGithubId(1.5), false);
  assert.equal(isGithubId("4242"), false);
});

test("a verified email links to the account holding it", () => {
  assert.deepEqual(decideLink({ ...base, email: "kim@example.com", emailVerified: true, verifiedEmailOwner: 42 }), { kind: "existing", userId: 42, via: "email" });
});

test("an unverified email never links", () => {
  assert.deepEqual(decideLink({ ...base, email: "kim@example.com", emailVerified: false, verifiedEmailOwner: 42 }), { kind: "new" });
});

test("a GitHub noreply email never links", () => {
  const email = "123+kim@users.noreply.github.com";
  assert.equal(isGithubNoreply(email), true);
  assert.equal(isGithubNoreply("kim@example.com"), false);
  assert.deepEqual(decideLink({ ...base, email, emailVerified: true, verifiedEmailOwner: 42 }), { kind: "new" });
});

test("no match means a new account", () => {
  assert.deepEqual(decideLink({ ...base, email: "new@example.com", emailVerified: true }), { kind: "new" });
});

test("emails are normalized and logins derived", () => {
  assert.equal(normalizeEmail("  Kim@Example.COM "), "kim@example.com");
  assert.equal(normalizeEmail(""), null);
  assert.equal(loginFor("kim.lee+x@example.com", null), "kim.leex");
  assert.equal(loginFor(null, "Kim Lee"), "Kim-Lee");
  assert.equal(loginFor(null, null), "user");
});

function d1(): D1Database {
  const db = new DatabaseSync(":memory:");
  for (const f of ["0001_accounts_billing.sql", "0007_auth.sql"]) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
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
const NOW = "2026-11-25T00:00:00Z";

test("new WorkOS accounts get ids from 10^12; GitHub-era ids are kept", async () => {
  const db = d1();
  const a = await createUser(db, { login: "kim", email: "kim@example.com", name: null }, NOW);
  const b = await createUser(db, { login: "lee", email: null, name: null }, NOW);
  assert.ok(a >= 1_000_000_000_000, String(a));
  assert.equal(b, a + 1);
  await ensureUserRow(db, { id: 4242, login: "gh", email: null, name: null }, NOW);
  await ensureUserRow(db, { id: 4242, login: "gh", email: null, name: null }, NOW); // idempotent
});

test("identities: link once, find by provider and subject, find verified email owners", async () => {
  const db = d1();
  await ensureUserRow(db, { id: 4242, login: "gh", email: "kim@example.com", name: null }, NOW);
  await linkIdentity(db, { provider: "github", subject: "4242", userId: 4242, email: "kim@example.com", emailVerified: true }, NOW);
  await linkIdentity(db, { provider: "github", subject: "4242", userId: 4242, email: "kim@example.com", emailVerified: true }, NOW);
  assert.equal(await findIdentityUser(db, "github", "4242"), 4242);
  assert.equal(await findIdentityUser(db, "workos", "user_01"), null);
  assert.deepEqual(await findVerifiedEmailOwner(db, "kim@example.com"), { kind: "one", userId: 4242 });
  assert.equal(await userHasIdentities(db, 4242), true);
  // Unverified emails don't count.
  const other = await createUser(db, { login: "x", email: null, name: null }, NOW);
  await linkIdentity(db, { provider: "workos", subject: "user_02", userId: other, email: "spoof@example.com", emailVerified: false }, NOW);
  assert.deepEqual(await findVerifiedEmailOwner(db, "spoof@example.com"), { kind: "none" });
  // Two accounts with the same verified email: ambiguous, its own answer.
  await linkIdentity(db, { provider: "workos", subject: "user_03", userId: other, email: "kim@example.com", emailVerified: true }, NOW);
  assert.deepEqual(await findVerifiedEmailOwner(db, "kim@example.com"), { kind: "ambiguous" });
  assert.deepEqual((await identityEmails(db, other)).sort(), ["kim@example.com", "spoof@example.com"]);
});

test("identities store emails lower-cased, match any case, and report who an identity already belongs to", async () => {
  const db = d1();
  await ensureUserRow(db, { id: 77, login: "gh", email: null, name: null }, NOW);
  assert.equal(await linkIdentity(db, { provider: "github", subject: "77", userId: 77, email: "Kim@Example.COM", emailVerified: true }, NOW), 77);
  assert.deepEqual(await findVerifiedEmailOwner(db, "kim@example.com"), { kind: "one", userId: 77 });
  assert.deepEqual(await findVerifiedEmailOwner(db, "KIM@example.com"), { kind: "one", userId: 77 });
  assert.deepEqual(await identityEmails(db, 77), ["kim@example.com"]);
  // The same identity asked to link to a different account: the stored owner comes back.
  assert.equal(await linkIdentity(db, { provider: "github", subject: "77", userId: 88, email: "kim@example.com", emailVerified: true }, NOW), 77);
  assert.equal(await findIdentityUser(db, "github", "77"), 77);
});

test("migration 0007 adds auth_tokens and users.sessions_valid_since without touching existing rows", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_accounts_billing.sql", import.meta.url), "utf8"));
  db.prepare("INSERT INTO users (id, login, created_at) VALUES (1, 'a', 'x')").run();
  db.exec(readFileSync(new URL("../migrations/0007_auth.sql", import.meta.url), "utf8"));
  assert.deepEqual({ ...(db.prepare("SELECT id, login, sessions_valid_since FROM users").get() as object) }, { id: 1, login: "a", sessions_valid_since: null });
  db.prepare("INSERT INTO auth_tokens (device_hash, user_code, created_at, expires_at) VALUES ('h', 'ABCD-EFGH', 1, 2)").run();
});
