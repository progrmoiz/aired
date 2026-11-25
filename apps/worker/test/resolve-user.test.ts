import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

// resolve-user.ts imports its siblings as ./x.js and @aired/core; point those
// at the .ts sources so this test runs the real orchestration.
register(
  "data:text/javascript," +
    encodeURIComponent(`
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const core = new URL("../../../packages/core/src/index.ts", ${JSON.stringify(import.meta.url)}).href;
export async function resolve(spec, ctx, next) {
  if (spec === "@aired/core") return next(core, ctx);
  if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL && ctx.parentURL.endsWith(".ts")) {
    const ts = new URL(spec.slice(0, -3) + ".ts", ctx.parentURL);
    if (existsSync(fileURLToPath(ts))) return next(ts.href, ctx);
  }
  return next(spec, ctx);
}`),
);
const { resolveWorkosUser, resolveGithubSignIn } = await import("../src/lib/resolve-user.ts");
const { ensureUserRow, linkIdentity, findIdentityUser } = await import("../src/lib/users.ts");

function d1(): D1Database {
  const db = new DatabaseSync(":memory:");
  for (const f of ["0001_accounts_billing.sql", "0007_auth.sql"]) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { args = a; return stmt; },
      async first() { const r = db.prepare(sql).get(...(args as never[])); return r ? { ...(r as object) } : null; },
      async run() { const r = db.prepare(sql).run(...(args as never[])); return { meta: { changes: Number(r.changes) } }; },
      async all() { return { results: db.prepare(sql).all(...(args as never[])).map((r) => ({ ...(r as object) })) }; },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}

function kv() {
  const m = new Map<string, string>();
  return {
    m,
    async get(k: string) { return m.get(k) ?? null; },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
  } as unknown as KVNamespace & { m: Map<string, string> };
}

function env() {
  return { DB: d1(), PAGES_KV: kv() } as { DB: D1Database; PAGES_KV: KVNamespace & { m: Map<string, string> } };
}

const NOW = "2026-11-25T00:00:00Z";
const profile = (over: Partial<Parameters<typeof resolveWorkosUser>[1]> = {}) => ({
  workosUserId: "user_01",
  email: "kim@example.com",
  emailVerified: true,
  firstName: "Kim",
  lastName: null,
  githubId: null,
  ...over,
});
const githubEra = (e: ReturnType<typeof env>, id: number, email: string | null) =>
  e.PAGES_KV.m.set(`user:${id}`, JSON.stringify({ id, login: `gh${id}`, email, name: "GH" }));

test("a first WorkOS sign-in with no match gets a new account from 10^12, and the same one next time", async () => {
  const e = env();
  const a = await resolveWorkosUser(e, profile());
  assert.ok(a.id >= 1_000_000_000_000);
  assert.equal(a.login, "kim");
  assert.equal(e.PAGES_KV.m.get("email:kim@example.com"), String(a.id));
  const again = await resolveWorkosUser(e, profile());
  assert.equal(again.id, a.id);
});

test("a verified email links to the GitHub-era account the KV index and its record agree on", async () => {
  const e = env();
  githubEra(e, 4242, "Kim@Example.com");
  e.PAGES_KV.m.set("email:kim@example.com", "4242");
  const u = await resolveWorkosUser(e, profile());
  assert.equal(u.id, 4242);
  assert.equal(u.login, "gh4242", "keeps the GitHub login");
});

test("a stale index entry doesn't link: the account's record holds another email, or the account is gone", async () => {
  const e = env();
  githubEra(e, 4242, "new@example.com");
  e.PAGES_KV.m.set("email:kim@example.com", "4242");
  e.PAGES_KV.m.set("email:old@example.com", "5555"); // user:5555 was deleted
  assert.ok((await resolveWorkosUser(e, profile())).id >= 1_000_000_000_000);
  assert.ok((await resolveWorkosUser(e, profile({ workosUserId: "user_02", email: "old@example.com" }))).id >= 1_000_000_000_000);
  assert.equal(e.PAGES_KV.m.has("user:5555"), false, "a deleted account isn't brought back");
});

test("an index entry for an account D1 knows under other emails doesn't link", async () => {
  const e = env();
  githubEra(e, 4242, "kim@example.com");
  e.PAGES_KV.m.set("email:kim@example.com", "4242");
  await ensureUserRow(e.DB, { id: 4242, login: "gh4242", email: null, name: null }, NOW);
  await linkIdentity(e.DB, { provider: "github", subject: "4242", userId: 4242, email: "elsewhere@example.com", emailVerified: true }, NOW);
  assert.ok((await resolveWorkosUser(e, profile())).id >= 1_000_000_000_000);
});

test("two accounts holding the email in D1: no link, even with a KV index entry", async () => {
  const e = env();
  // The GitHub-era account the index names hasn't signed in since D1 learned identities.
  githubEra(e, 4242, "kim@example.com");
  e.PAGES_KV.m.set("email:kim@example.com", "4242");
  const b = await resolveWorkosUser(e, profile({ workosUserId: "user_b", email: "b@example.com" }));
  const d = await resolveWorkosUser(e, profile({ workosUserId: "user_d", email: "d@example.com" }));
  await linkIdentity(e.DB, { provider: "github", subject: "998", userId: b.id, email: "kim@example.com", emailVerified: true }, NOW);
  await linkIdentity(e.DB, { provider: "github", subject: "999", userId: d.id, email: "kim@example.com", emailVerified: true }, NOW);
  const c = await resolveWorkosUser(e, profile({ workosUserId: "user_c" }));
  assert.ok(![4242, b.id, d.id].includes(c.id), String(c.id));
});

test("an unverified email never links and isn't stored as the account's email", async () => {
  const e = env();
  githubEra(e, 4242, "kim@example.com");
  e.PAGES_KV.m.set("email:kim@example.com", "4242");
  const u = await resolveWorkosUser(e, profile({ emailVerified: false }));
  assert.ok(u.id >= 1_000_000_000_000);
  assert.equal(u.email, null);
  assert.equal(e.PAGES_KV.m.get("email:kim@example.com"), "4242", "the index is untouched");
});

test("linking an existing account keeps its email unless the new one is verified", async () => {
  const e = env();
  githubEra(e, 4242, "kim@example.com");
  // GitHub through WorkOS, with an unverified WorkOS email.
  const u = await resolveWorkosUser(e, profile({ email: "other@example.com", emailVerified: false, githubId: 4242 }));
  assert.equal(u.id, 4242);
  assert.equal(u.email, "kim@example.com");
  assert.equal(JSON.parse(e.PAGES_KV.m.get("user:4242")!).email, "kim@example.com");
});

test("GitHub through WorkOS links to the GitHub-era account, and the GitHub id must be a real one", async () => {
  const e = env();
  githubEra(e, 4242, null);
  assert.equal((await resolveWorkosUser(e, profile({ email: null, emailVerified: false, githubId: 4242 }))).id, 4242);
  // An id in the new-account range is ignored, not used as an account id.
  const first = await resolveWorkosUser(e, profile({ workosUserId: "user_x", email: "x@example.com" }));
  const spoof = await resolveWorkosUser(e, profile({ workosUserId: "user_y", email: null, emailVerified: false, githubId: first.id }));
  assert.notEqual(spoof.id, first.id);
});

test("a GitHub identity first seen through WorkOS keeps signing in as that account the legacy way", async () => {
  const e = env();
  const n = await resolveWorkosUser(e, profile({ email: null, emailVerified: false, githubId: 777, firstName: "Lee" }));
  assert.ok(n.id >= 1_000_000_000_000);
  assert.equal(await findIdentityUser(e.DB, "github", "777"), n.id);
  // The old CLI / GitHub sign-in now resolves to the same account, not user:777.
  const legacy = await resolveGithubSignIn(e, { id: 777, login: "lee-gh", email: null, name: "Lee" });
  assert.equal(legacy.id, n.id);
  assert.equal(e.PAGES_KV.m.has("user:777"), false);
  // And a second WorkOS identity with the same GitHub id lands there too.
  assert.equal((await resolveWorkosUser(e, profile({ workosUserId: "user_02", email: null, emailVerified: false, githubId: 777 }))).id, n.id);
});

test("the legacy GitHub sign-in stores the email lower-cased, so a later WorkOS sign-in finds it in D1", async () => {
  const e = env();
  const gh = await resolveGithubSignIn(e, { id: 4242, login: "kim-gh", email: "Kim@Example.com", name: "Kim" });
  assert.equal(gh.id, 4242);
  assert.equal(e.PAGES_KV.m.get("email:kim@example.com"), "4242");
  assert.equal((await resolveWorkosUser(e, profile())).id, 4242);
});

test("the legacy GitHub sign-in still works when D1 is down", async () => {
  const e = env();
  const broken = { prepare() { throw new Error("D1 down"); } } as unknown as D1Database;
  const u = await resolveGithubSignIn({ DB: broken, PAGES_KV: e.PAGES_KV }, { id: 4242, login: "kim-gh", email: null, name: null });
  assert.equal(u.id, 4242);
  assert.ok(e.PAGES_KV.m.has("user:4242"));
});

test("account deletion clears only email index entries that still point at the account", () => {
  const me = readFileSync(new URL("../src/routes/me.ts", import.meta.url), "utf8");
  assert.match(me, /linkedEmails = await identityEmails\(c\.env\.DB, userId\);[\s\S]*await deleteAccountRows\(c\.env\.DB, userId\);/);
  assert.match(me, /if \(\(await c\.env\.PAGES_KV\.get\(kvKeys\.emailIndex\(email\)\)\) === String\(userId\)\) \{/);
});
