import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

// The middleware imports its siblings as ./x.js and @aired/core; point those
// at the .ts sources so these tests run the real auth code.
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
const { Hono } = await import("hono");
const { authMiddleware, requireAuth, requireWebSession } = await import("../src/middleware/auth.ts");
const { signSession, verifySession } = await import("../src/lib/jwt.ts");
const { SignJWT } = await import("jose");
const { authDevice, pollNativeDevice } = await import("../src/routes/auth-device.ts");
const { insertKey } = await import("../src/lib/api-keys.ts");
const { revokeAllSessions, sessionsValidSinceKey } = await import("../src/lib/revocation.ts");
const { parseUserRecord } = await import("../src/lib/user-record.ts");
// Same construction as withMcpOAuthUser in routes/mcp-oauth.ts (which needs the Workers runtime to import).
const withMcpOAuthUser = (env: object, userId: number) => Object.create(env, { AIRED_MCP_OAUTH_USER: { value: userId, enumerable: false } });
const { generateApiKey, hashToHex, apiKeyDisplayPrefix } = await import("../../../packages/core/src/index.ts");

const SECRET = "test-secret-for-caller-auth-0123456789";

function d1(): D1Database {
  const db = new DatabaseSync(":memory:");
  for (const f of ["0001_accounts_billing.sql", "0006_api_keys.sql", "0007_auth.sql"]) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
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

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

function setup() {
  const env = { DB: d1(), PAGES_KV: kv(), SESSION_SECRET: SECRET, SESSION_VALID_SINCE: "1970-01-01T00:00:00Z" } as Record<string, unknown> & { PAGES_KV: KVNamespace & { m: Map<string, string> }; DB: D1Database };
  env.PAGES_KV.m.set("user:42", JSON.stringify({ id: 42, login: "kim", email: "kim@example.com", name: "Kim", createdAt: "2026-01-01T00:00:00Z" }));
  const app = new Hono();
  app.use("*", authMiddleware as never);
  app.get("/who", (c) => c.json({ user: (c.get as (k: string) => unknown)("user"), via: (c.get as (k: string) => unknown)("via") }));
  app.get("/signed-in", requireAuth as never, (c) => c.json({ ok: true }));
  app.get("/web-only", requireWebSession as never, (c) => c.json({ ok: true }));
  app.route("/auth", authDevice as never);
  app.post("/auth/device/poll", async (c) => pollNativeDevice(c as never, ((await c.req.json()) as { device_code: string }).device_code));
  const call = (path: string, headers: Record<string, string> = {}, e: unknown = env) => app.request(path, { headers }, e as never, ctx);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }, env as never, ctx);
  return { env, call, post };
}

async function who(res: Response) {
  return (await res.json()) as { user: { id: number; login: string } | null; via: string | null };
}

const session = () => signSession({ sub: 42, login: "kim", email: "kim@example.com", name: "Kim" }, SECRET);

async function key(env: { DB: D1Database }, createdAt = Date.now()) {
  const k = generateApiKey();
  await insertKey(env.DB, { id: `k${Math.random()}`, userId: 42, name: "ci", prefix: apiKeyDisplayPrefix(k), keyHash: await hashToHex(k), createdAt });
  return k;
}

test("the website's cookie signs in as 'cookie' and may manage the account", async () => {
  const { call } = setup();
  const cookie = `aired_session=${await session()}`;
  assert.deepEqual(await who(await call("/who", { Cookie: cookie })), { user: { id: 42, login: "kim", email: "kim@example.com", name: "Kim" }, via: "cookie" });
  assert.equal((await call("/web-only", { Cookie: cookie })).status, 200);
});

test("a CLI token signs in as 'cli' and can't manage keys, billing or the account", async () => {
  const { call } = setup();
  const header = { "aired-Session": await session() };
  assert.equal((await who(await call("/who", header))).via, "cli");
  assert.equal((await call("/signed-in", header)).status, 200);
  const res = await call("/web-only", header);
  assert.equal(res.status, 403);
  assert.match(((await res.json()) as { error: string }).error, /Sign in on the aired website/);
});

test("an API key signs in as 'key'; a bad or revoked key is a 401, never anonymous", async () => {
  const { env, call } = setup();
  const k = await key(env);
  const auth = { Authorization: `Bearer ${k}` };
  assert.equal((await who(await call("/who", auth))).via, "key");
  assert.equal((await call("/web-only", auth)).status, 403);
  assert.equal((await call("/who", { Authorization: `Bearer ${k.slice(0, -1)}X` })).status, 401);
  env.PAGES_KV.m.delete("user:42"); // the account is gone
  assert.equal((await call("/who", auth)).status, 401);
});

test("an MCP OAuth call signs in as 'oauth' (in-process only) and can't manage the account", async () => {
  const { env, call } = setup();
  const inProcess = withMcpOAuthUser(env, 42);
  assert.equal((await who(await call("/who", {}, inProcess))).via, "oauth");
  assert.equal((await call("/web-only", {}, inProcess)).status, 403);
  // The same marker can't arrive as a string var.
  assert.equal((await who(await call("/who", {}, { ...env, AIRED_MCP_OAUTH_USER: "42" }))).user, null);
  env.PAGES_KV.m.delete("user:42");
  assert.equal((await call("/who", {}, inProcess)).status, 401);
});

test("account deletion and sign-out-everywhere retire every earlier session, cookie and CLI alike", async () => {
  const { env, call } = setup();
  const before = await session();
  // Marker one second ahead of the tokens just minted.
  await revokeAllSessions(env.PAGES_KV, 42, Date.now() + 1000);
  assert.ok(env.PAGES_KV.m.has(sessionsValidSinceKey(42)));
  assert.equal((await who(await call("/who", { Cookie: `aired_session=${before}` }))).user, null);
  assert.equal((await call("/signed-in", { "aired-Session": before })).status, 401);
  // A session minted after the marker works.
  env.PAGES_KV.m.set(sessionsValidSinceKey(42), String(Math.floor(Date.now() / 1000) - 5));
  assert.equal((await who(await call("/who", { "aired-Session": await session() }))).via, "cli");
  // API keys are listed and revoked one by one; signing out everywhere leaves them.
  await revokeAllSessions(env.PAGES_KV, 42, Date.now() + 1000);
  assert.equal((await who(await call("/who", { Authorization: `Bearer ${await key(env)}` }))).via, "key");
});

test("a revoked session id and the global SESSION_VALID_SINCE still sign nobody in", async () => {
  const { env, call } = setup();
  const t = await session();
  const jti = JSON.parse(Buffer.from(t.split(".")[1]!, "base64url").toString()).jti;
  env.PAGES_KV.m.set(`revoked_jti:${jti}`, "1");
  assert.equal((await who(await call("/who", { "aired-Session": t }))).user, null);
  const t2 = await session();
  assert.equal((await who(await call("/who", { "aired-Session": t2 }, { ...env, SESSION_VALID_SINCE: "2999-01-01T00:00:00Z" }))).user, null);
});

test("the user record is read in one place and rejects anything that isn't an account", () => {
  assert.equal(parseUserRecord(1, null), null);
  assert.equal(parseUserRecord(1, "not json"), null);
  assert.equal(parseUserRecord(1, '{"login":""}'), null);
  assert.equal(parseUserRecord(1, "[1]"), null);
  assert.deepEqual(parseUserRecord(7, '{"login":"a","email":5,"name":"N","createdAt":"x"}'), { id: 7, login: "a", email: null, name: "N", createdAt: "x" });
  // No hand-rolled user:<id> parsing left in the routes that sign people in.
  for (const f of ["src/index.ts", "src/middleware/auth.ts", "src/routes/auth-device.ts", "src/routes/mcp-oauth.ts", "src/lib/resolve-user.ts"]) {
    const code = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.ok(!/PAGES_KV\.get\(kvKeys\.user\(/.test(code), f);
  }
});

test("guards: keys, account deletion, billing, device approval and MCP consent all use the website-only rule", () => {
  const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  assert.match(src("routes/keys.ts"), /keys\.use\('\*', requireWebSession\);/);
  assert.match(src("routes/me.ts"), /me\.delete\('\/', requireWebSession, requireCsrfHeader,/);
  assert.match(src("routes/me.ts"), /me\.post\('\/sign-out-everywhere', requireWebSession, requireCsrfHeader,/);
  assert.match(src("routes/me.ts"), /await revokeAllSessions\(c\.env\.PAGES_KV, userId\);/);
  assert.match(src("routes/billing.ts"), /billing\.post\('\/checkout', requireWebSession, requireCsrfHeader,/);
  assert.match(src("routes/billing.ts"), /billing\.post\('\/portal', requireWebSession, requireCsrfHeader,/);
  assert.match(src("routes/billing.ts"), /if \(c\.get\('via'\) !== 'cookie'\) \{/);
  assert.match(src("routes/auth-device.ts"), /'\/device\/approve',\s*requireAuth,\s*requireWebSession,\s*requireCsrfHeader,/);
  assert.match(src("routes/mcp-oauth.ts"), /if \(user === null \|\| c\.get\('via'\) !== 'cookie'\) return null;/);
  assert.match(src("routes/mcp-oauth.ts"), /return Object\.create\(env, \{ AIRED_MCP_OAUTH_USER: \{ value: userId, enumerable: false \} \}\) as Env;/);
  assert.ok(!/requireSession\b|authMethod/.test(Object.values({ a: src("middleware/auth.ts"), b: src("routes/me.ts"), c: src("routes/billing.ts"), d: src("index.ts") }).join("\n")));
});

const nowS = () => Math.floor(Date.now() / 1000);
/** A token as older code minted it: no kind or auth_time claims. */
async function legacyToken(lifetimeSeconds: number, iat = nowS()) {
  return new SignJWT({ sub: "42", login: "kim", email: null, name: "Kim", jti: crypto.randomUUID(), v: 1 })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt(iat).setExpirationTime(iat + lifetimeSeconds).sign(new TextEncoder().encode(SECRET));
}

test("a CLI token sent as the session cookie is still a CLI caller: no keys, billing or account", async () => {
  const { call } = setup();
  const cli = await signSession({ sub: 42, login: "kim", email: null, name: "Kim" }, SECRET, 365 * 86400);
  const cookie = { Cookie: `aired_session=${cli}`, "X-Aired-Request": "1" };
  assert.equal((await who(await call("/who", cookie))).via, "cli");
  assert.equal((await call("/web-only", cookie)).status, 403);
  // Tokens from before the kind claim: a CLI lifetime means CLI, a web lifetime means the website.
  assert.equal((await who(await call("/who", { Cookie: `aired_session=${await legacyToken(365 * 86400)}` }))).via, "cli");
  assert.equal((await who(await call("/who", { Cookie: `aired_session=${await legacyToken(30 * 86400)}` }))).via, "cookie");
});

test("signing out everywhere compares with when the person signed in, so a reissued or freshly minted token can't escape", async () => {
  const { env, call } = setup();
  const signedIn = nowS() - 100;
  // Minted just now, but for a sign-in 100 seconds ago (a reissue, or a token minted during the propagation window).
  const t = await signSession({ sub: 42, login: "kim", email: null, name: "Kim" }, SECRET, undefined, { kind: "web", authTime: signedIn });
  env.PAGES_KV.m.set(sessionsValidSinceKey(42), String(signedIn + 10));
  assert.equal((await who(await call("/who", { Cookie: `aired_session=${t}` }))).user, null);
});

test("a reissued web session keeps its kind and its original sign-in time", async () => {
  const { call } = setup();
  const signedIn = nowS() - 8 * 86400;
  const old = await new SignJWT({ sub: "42", login: "kim", email: null, name: "Kim", jti: crypto.randomUUID(), v: 1, kind: "web", auth_time: signedIn })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt(signedIn).setExpirationTime(signedIn + 30 * 86400).sign(new TextEncoder().encode(SECRET));
  const res = await call("/who", { Cookie: `aired_session=${old}` });
  assert.equal((await who(res)).via, "cookie");
  const fresh = res.headers.get("set-cookie")?.match(/aired_session=([^;]+)/)?.[1];
  assert.ok(fresh, "reissued");
  const v = await verifySession(fresh, SECRET);
  assert.ok(v.ok);
  if (v.ok) {
    assert.equal(v.claims.kind, "web");
    assert.equal(v.claims.authTime, signedIn);
    assert.ok(v.claims.iat > signedIn);
  }
  // A CLI token is never reissued as a web session, even from the cookie.
  const oldCli = await legacyToken(365 * 86400, nowS() - 8 * 86400);
  assert.equal((await call("/who", { Cookie: `aired_session=${oldCli}` })).headers.get("set-cookie"), null);
});

test("a device code approved before signing out everywhere yields no CLI token afterwards", async () => {
  const { env, post } = setup();
  const web = { Cookie: `aired_session=${await session()}`, "X-Aired-Request": "1" };
  // A CLI token can't approve codes at all.
  const start2 = (await (await post("/auth/device", {})).json()) as { user_code: string };
  assert.equal((await post("/auth/device/approve", { user_code: start2.user_code }, { "aired-Session": await session() })).status, 403);
  // Approved but not collected...
  const start = (await (await post("/auth/device", {})).json()) as { device_code: string; user_code: string };
  assert.equal((await post("/auth/device/approve", { user_code: start.user_code }, web)).status, 200);
  // ...then the owner signs out everywhere.
  await revokeAllSessions(env.PAGES_KV, 42, Date.now() + 1000);
  const late = await post("/auth/device/poll", { device_code: start.device_code });
  assert.equal(late.status, 400);
  assert.deepEqual(await late.json(), { error: "access_denied" });
});

test("a collected device code makes a CLI token that inherits the approver's sign-in time", async () => {
  const { env, post } = setup();
  env.PAGES_KV.m.delete(sessionsValidSinceKey(42));
  const signedIn = nowS() - 1000;
  const approver = await signSession({ sub: 42, login: "kim", email: null, name: "Kim" }, SECRET, undefined, { kind: "web", authTime: signedIn });
  const web = { Cookie: `aired_session=${approver}`, "X-Aired-Request": "1" };
  const start = (await (await post("/auth/device", {})).json()) as { device_code: string; user_code: string };
  await post("/auth/device/approve", { user_code: start.user_code }, web);
  const got = (await (await post("/auth/device/poll", { device_code: start.device_code })).json()) as { jwt: string };
  const v = await verifySession(got.jwt, SECRET);
  assert.ok(v.ok);
  if (v.ok) {
    assert.equal(v.claims.kind, "cli");
    assert.equal(v.claims.authTime, signedIn, "exactly the approver's sign-in time");
  }
});

test("account deletion writes the revocation marker before deleting, and refuses if it can't", () => {
  const me = readFileSync(new URL("../src/routes/me.ts", import.meta.url), "utf8");
  const marker = me.indexOf("await revokeAllSessions(c.env.PAGES_KV, userId);\n  } catch (err) {\n    console.error('Failed to set the revocation marker during account deletion:', err);\n    return c.json(");
  assert.ok(marker > 0, "fails closed");
  assert.ok(marker < me.indexOf("await deleteAccountRows(c.env.DB, userId, "), "marker first");
});
