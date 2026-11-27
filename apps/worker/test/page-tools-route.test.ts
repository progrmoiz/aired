import { test } from "node:test";
import assert from "node:assert/strict";
import "./helpers/worker-loader.ts";
import { fakeD1 } from "./helpers/d1.ts";

// The real routes, middleware and page store, on fake bindings.
const { Hono } = await import("hono");
const { pageTools } = await import("../src/routes/page-tools.ts");
const { insertPageRow, rowFromMetadata } = await import("../src/lib/pages-store.ts");
const { hashToken } = await import("@aired/core");
const { addSpent, readBudget } = await import("../src/lib/og-shot.ts");

type User = { id: number; login: string; email: null; name: null };

function fakeR2() {
  const objects = new Map<string, { body: Uint8Array; customMetadata?: Record<string, string> }>();
  return {
    objects,
    async get(key: string) {
      const o = objects.get(key);
      if (!o) return null;
      return {
        body: new Blob([o.body]).stream(),
        customMetadata: o.customMetadata,
        etag: "e1",
        async text() { return new TextDecoder().decode(o.body); },
      };
    },
    async head(key: string) { return objects.has(key) ? { etag: "e1" } : null; },
    async put(key: string, v: string | Uint8Array, opts?: { customMetadata?: Record<string, string> }) {
      objects.set(key, { body: typeof v === "string" ? new TextEncoder().encode(v) : v, customMetadata: opts?.customMetadata });
      return { etag: "e1" };
    },
    async delete() {},
  };
}
const fakeKv = () => ({ async get() { return null; }, async put() {}, async delete() {} });

const NOW = Date.now();
const TOKEN = "tok_owner_secret_value";

async function setup(opts: { user?: User | null; browser?: unknown; vars?: Record<string, string> } = {}) {
  const { db } = fakeD1();
  const r2 = fakeR2();
  const page = (id: string, ownerId: number | null, tokenHash: string) => ({
    id, title: `Page ${id}`, size: 40, tokenHash, pin: "pbkdf2$hidden", reads: null, readCount: 0, permanent: true,
    createdAt: new Date(NOW - 1000).toISOString(), expiresAt: null, ownerId, project: null,
  });
  const hash = await hashToken(TOKEN);
  await insertPageRow(db, rowFromMetadata(page("mine", 7, hash), null, NOW));
  await insertPageRow(db, rowFromMetadata(page("theirs", 8, await hashToken("other")), null, NOW));
  await insertPageRow(db, rowFromMetadata(page("anon", null, hash), null, NOW));
  for (const id of ["mine", "theirs", "anon"]) await r2.put(`pages/${id}/index.html`, `<h1>${id}</h1>`);
  const launches: number[] = [];
  const env = {
    DB: db,
    PAGES_BUCKET: r2,
    PAGES_KV: fakeKv(),
    SITE_ORIGIN: "https://aired.test",
    ...(opts.browser !== undefined ? { BROWSER: opts.browser } : {}),
    ...opts.vars,
  };
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user" as never, (opts.user ?? null) as never);
    c.set("via" as never, (opts.user ? "key" : null) as never);
    await next();
  });
  app.route("/api", pageTools);
  const call = (method: string, path: string, body?: unknown, ip = "203.0.113.9") =>
    app.fetch(
      new Request(`https://aired.test${path}`, {
        method,
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      env as never,
      { waitUntil() {}, passThroughOnException() {} } as never,
    );
  return { call, db, r2, launches, env };
}

const kim: User = { id: 7, login: "kim", email: null, name: null };
let ipN = 0;
/** A different IP per call, so the in-memory hourly limit never decides a test. */
const ip = () => `198.51.100.${++ipN}`;

test("check: nobody, a wrong token and another account are refused before any browser time", async () => {
  const browser = { launch: async () => { throw new Error("must not launch"); } };
  const anon = await setup({ browser });
  assert.equal((await anon.call("POST", "/api/pages/mine/check", {}, ip())).status, 401);
  assert.equal((await anon.call("POST", "/api/pages/mine/check", { update_token: "wrong" }, ip())).status, 403);
  const other = await setup({ user: { ...kim, id: 9, login: "ana" }, browser });
  assert.equal((await other.call("POST", "/api/pages/mine/check", {}, ip())).status, 403);
  assert.equal((await other.call("POST", "/api/pages/nope/check", {}, ip())).status, 404);
  assert.equal((await other.call("POST", "/api/pages/mine/check", { viewport: "tablet" }, ip())).status, 400);
  // No budget row was touched by any of that.
  assert.equal(await readBudget(anon.db as never), null);
  assert.equal(await readBudget(other.db as never), null);
});

test("check: the owner (account or update token) gets through to the browser", async () => {
  const signedIn = await setup({ user: kim });
  const res = await signedIn.call("POST", "/api/pages/mine/check", {}, ip());
  assert.equal(res.status, 503, "no BROWSER binding here");
  assert.equal(((await res.json()) as { code: string }).code, "check_unavailable");
  const byToken = await setup({});
  assert.equal((await byToken.call("POST", "/api/pages/anon/check", { update_token: TOKEN }, ip())).status, 503);
});

test("check: a spent daily budget answers 429 with Retry-After and never launches a browser", async () => {
  let launched = 0;
  const { call, db } = await setup({ user: kim, browser: { launch: async () => { launched++; throw new Error("no"); } } });
  await addSpent(db as never, 3 * 60 * 1000, Date.now(), "check");
  const res = await call("POST", "/api/pages/mine/check", {}, ip());
  assert.equal(res.status, 429);
  const body = (await res.json()) as { code: string; error: string };
  assert.equal(body.code, "check_budget");
  assert.match(body.error, /00:00 UTC/);
  assert.ok(Number(res.headers.get("Retry-After")) > 0);
  assert.equal(launched, 0);
});

test("check: Browser Rendering saying 429 blocks later checks and screenshots for a minute", async () => {
  const { call, db } = await setup({ user: kim, browser: { launch: async () => { throw new Error("Unable to create new browser: code: 429: message: Too many browsers"); } } });
  const res = await call("POST", "/api/pages/mine/check", {}, ip());
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as { code: string }).code, "check_busy");
  const row = await readBudget(db as never);
  assert.ok(row !== null && row.blockedUntil > Date.now(), "the shared row is blocked, so link previews wait too");
  const again = await call("POST", "/api/pages/mine/check", {}, ip());
  assert.equal(again.status, 429, "the block now stops the check before launching");
});

test("check: the per-minute guard counts per caller", async () => {
  const keys: string[] = [];
  const burst = { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: keys.length <= 1 }; } };
  const { call, env } = await setup({ user: kim });
  (env as Record<string, unknown>).CHECK_BURST = burst;
  assert.equal((await call("POST", "/api/pages/mine/check", {}, ip())).status, 503);
  const limited = await call("POST", "/api/pages/mine/check", {}, ip());
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "60");
  assert.deepEqual(keys, ["u:7", "u:7"], "signed-in callers count by account, not IP");
});

test("source: only the owner gets the HTML; the PIN never shields it from them, and never leaks", async () => {
  const owner = await setup({ user: kim });
  const res = await owner.call("GET", "/api/pages/mine/source", undefined, ip());
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.deepEqual(body, { id: "mine", url: "https://aired.test/p/mine", title: "Page mine", size: 40, html: "<h1>mine</h1>" });
  assert.equal((await owner.call("GET", "/api/pages/theirs/source", undefined, ip())).status, 403);
  assert.equal((await owner.call("GET", "/api/pages/anon/source", undefined, ip())).status, 403, "an anonymous page needs its token");
  const nobody = await setup({});
  assert.equal((await nobody.call("GET", "/api/pages/mine/source", undefined, ip())).status, 401);
});

test("check.jpg: served only with the key from the report, and not after it expires", async () => {
  const { call, r2 } = await setup({});
  const key = "0123456789abcdef0123456789abcdef";
  await r2.put("pages/mine/check.jpg", new Uint8Array([0xff, 0xd8, 0xff]), { customMetadata: { key, expires: String(Date.now() + 60_000) } });
  const ok = await call("GET", `/api/pages/mine/check.jpg?k=${key}`, undefined, ip());
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("Content-Type"), "image/jpeg");
  assert.equal(ok.headers.get("Cache-Control"), "private, max-age=3600");
  assert.equal((await call("GET", "/api/pages/mine/check.jpg", undefined, ip())).status, 404);
  assert.equal((await call("GET", `/api/pages/mine/check.jpg?k=${key.replace("0", "f")}`, undefined, ip())).status, 404);
  assert.equal((await call("GET", `/api/pages/theirs/check.jpg?k=${key}`, undefined, ip())).status, 404, "a key is for its own page");
  await r2.put("pages/mine/check.jpg", new Uint8Array([0xff]), { customMetadata: { key, expires: String(Date.now() - 1) } });
  assert.equal((await call("GET", `/api/pages/mine/check.jpg?k=${key}`, undefined, ip())).status, 404);
});
