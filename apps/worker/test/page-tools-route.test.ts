import { test } from "node:test";
import assert from "node:assert/strict";
import "./helpers/worker-loader.ts";
import { fakeD1 } from "./helpers/d1.ts";

// The real routes, middleware and page store, on fake bindings.
const { Hono } = await import("hono");
const { pageTools } = await import("../src/routes/page-tools.ts");
const { insertPageRow, rowFromMetadata } = await import("../src/lib/pages-store.ts");
const { hashToken, hashToHex } = await import("@aired/core");
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
    async delete(keys: string | string[]) { for (const k of [keys].flat()) objects.delete(k); },
    async list({ prefix = "" }: { prefix?: string } = {}) {
      return { objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, uploaded: new Date() })), truncated: false };
    },
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
  await addSpent(db as never, 10 * 60 * 1000, Date.now(), "check");
  const res = await call("POST", "/api/pages/mine/check", {}, ip());
  assert.equal(res.status, 429);
  const body = (await res.json()) as { code: string; error: string };
  assert.equal(body.code, "check_budget");
  assert.match(body.error, /00:00 UTC/);
  assert.ok(Number(res.headers.get("Retry-After")) > 0);
  assert.equal(launched, 0);
});

test("check: Browser Rendering saying 'too many' holds back checks for a minute, not link previews", async () => {
  const { call, db } = await setup({ user: kim, browser: { launch: async () => { throw new Error("Unable to create new browser: code: 429: message: Too many browsers"); } } });
  const res = await call("POST", "/api/pages/mine/check", {}, ip());
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as { code: string }).code, "check_busy");
  const shared = await readBudget(db as never);
  assert.ok(shared === null || shared.blockedUntil <= Date.now(), "screenshots aren't blocked by a check's launch");
  assert.ok((await readBudget(db as never, "check"))!.blockedUntil > Date.now());
  const again = await call("POST", "/api/pages/mine/check", {}, ip());
  assert.equal(again.status, 503, "still busy, not 'used today's time'");
  assert.ok(Number(again.headers.get("Retry-After")) <= 60);
  // The failed launch gave its reservation back.
  assert.ok((await readBudget(db as never, "check:u:7"))!.spentMs < 5_000);
});

test("check: the account's daily Browser Rendering limit is 'budget' until midnight and stops screenshots too", async () => {
  const { call, db } = await setup({ user: kim, browser: { launch: async () => { throw new Error("Browser time limit exceeded for today"); } } });
  const res = await call("POST", "/api/pages/mine/check", {}, ip());
  assert.equal(res.status, 429);
  assert.equal(((await res.json()) as { code: string }).code, "check_budget");
  assert.ok((await readBudget(db as never))!.blockedUntil > Date.now() + 60_000);
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
  // A plain HTML page: its source is the HTML itself.
  assert.deepEqual(body, { id: "mine", url: "https://aired.test/p/mine", title: "Page mine", size: 40, html: "<h1>mine</h1>", kind: "page", format: "html", source: "<h1>mine</h1>" });
  assert.equal((await owner.call("GET", "/api/pages/theirs/source", undefined, ip())).status, 403);
  assert.equal((await owner.call("GET", "/api/pages/anon/source", undefined, ip())).status, 403, "an anonymous page needs its token");
  const nobody = await setup({});
  assert.equal((await nobody.call("GET", "/api/pages/mine/source", undefined, ip())).status, 401);
});

test("check.jpg: served only with the key from the report, never cached, and not after it expires", async () => {
  const { call, r2 } = await setup({});
  const key = "0123456789abcdef0123456789abcdef";
  const at = `pages/mine/checks/${await hashToHex(key, 32)}.jpg`;
  await r2.put(at, new Uint8Array([0xff, 0xd8, 0xff]), { customMetadata: { expires: String(Date.now() + 60_000) } });
  assert.ok(![...r2.objects.values()].some((o) => JSON.stringify(o.customMetadata ?? {}).includes(key)), "storage holds only the key's hash");
  const ok = await call("GET", `/api/pages/mine/check.jpg?k=${key}`, undefined, ip());
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("Content-Type"), "image/jpeg");
  assert.equal(ok.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await call("GET", "/api/pages/mine/check.jpg", undefined, ip())).status, 404);
  assert.equal((await call("GET", `/api/pages/mine/check.jpg?k=${key.replace("0", "f")}`, undefined, ip())).status, 404);
  assert.equal((await call("GET", `/api/pages/theirs/check.jpg?k=${key}`, undefined, ip())).status, 404, "a key is for its own page");
  await r2.put(at, new Uint8Array([0xff]), { customMetadata: { expires: String(Date.now() - 1) } });
  assert.equal((await call("GET", `/api/pages/mine/check.jpg?k=${key}`, undefined, ip())).status, 404);
});

/**
 * A stand-in for a Browser Rendering browser: goto fires the page's
 * requests through the real interception code, then the page's own events.
 */
function fakeBrowser(opts: { requests?: { url: string; type: string }[]; onLoad?: (emit: (ev: string, arg: unknown) => void) => void; dom?: Record<string, unknown> }) {
  const popups: string[] = [];
  const makePage = () => {
    const handlers: Record<string, ((a: unknown) => void)[]> = {};
    const emit = (ev: string, arg: unknown) => (handlers[ev] ?? []).forEach((f) => f(arg));
    const frame = {};
    const req = (url: string, type: string, nav = false) => {
      const r = {
        responded: false, aborted: false,
        url: () => url, isNavigationRequest: () => nav, frame: () => frame, resourceType: () => type,
        respond: async () => { r.responded = true; }, abort: async () => { r.aborted = true; }, continue: async () => {},
        failure: () => ({ errorText: "net::ERR_FAILED" }),
      };
      return r;
    };
    return {
      on: (ev: string, f: (a: unknown) => void) => { (handlers[ev] ??= []).push(f); },
      setViewport: async () => {}, setRequestInterception: async () => {}, mainFrame: () => frame,
      async goto(url: string) {
        const doc = req(url, "document", true);
        emit("request", doc);
        if (!doc.responded) throw new Error("net::ERR_FAILED");
        for (const q of opts.requests ?? []) {
          const r = req(q.url, q.type);
          emit("request", r);
          if (r.aborted) emit("requestfailed", r);
        }
        emit("popup", { close: async () => { popups.push("closed"); } });
        opts.onLoad?.(emit);
      },
      evaluate: async (expr: string) => (expr.includes("innerText") ? { title: "T", textChars: 20, visibleMedia: 0, brokenImages: 0, scrollWidth: 1280, scrollHeight: 900, viewportWidth: 1280, hasViewportMeta: true, transferBytes: 900, resourceCount: 1, ...opts.dom } : true),
      screenshot: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      close: async () => {},
    };
  };
  return { popups, binding: { launch: async () => ({ newPage: async () => makePage(), close: async () => {} }) } };
}

test("check, end to end: a relative script is reported, a popup is closed, and aired's favicon isn't blamed", async () => {
  const b = fakeBrowser({
    requests: [
      { url: "https://aired.test/p/app.js", type: "script" },
      { url: "https://aired.sh/favicon.ico", type: "other" },
      { url: "https://aired.abc123.workers.dev/api/pages/mine/check", type: "fetch" },
    ],
    onLoad: (emit) => emit("pageerror", new Error("boot is not defined")),
  });
  const { call, db, r2 } = await setup({ user: kim, browser: b.binding });
  const res = await call("POST", "/api/pages/mine/check", { inline_screenshot: true }, ip());
  assert.equal(res.status, 200);
  const r = (await res.json()) as { ok: boolean; issues: { code: string }[]; failed_requests: { url: string; error: string }[]; screenshot_url: string; screenshot_base64?: string };
  assert.equal(r.ok, false);
  assert.deepEqual(r.issues.map((i) => i.code), ["script_error", "failed_request"]);
  assert.deepEqual(r.failed_requests.map((f) => f.url), ["https://aired.test/p/app.js"], "only the file a visitor would lose too");
  assert.match(r.failed_requests[0]!.error, /a page is one file/);
  assert.deepEqual(b.popups, ["closed"]);
  assert.equal(r.screenshot_base64, "/9j/2Q==");
  // The screenshot is stored once per check, by the key's hash, and its URL opens it.
  const key = new URL(r.screenshot_url).searchParams.get("k")!;
  assert.ok([...r2.objects.keys()].includes(`pages/mine/checks/${await hashToHex(key, 32)}.jpg`));
  assert.equal((await call("GET", new URL(r.screenshot_url).pathname + `?k=${key}`, undefined, ip())).status, 200);
  // The reservation was settled to the real (short) time.
  assert.ok((await readBudget(db as never, "check:u:7"))!.spentMs < 10_000);

  // A second check (say, at mobile size) doesn't break the first link.
  const second = (await (await call("POST", "/api/pages/mine/check", { viewport: "mobile" }, ip())).json()) as { screenshot_url: string };
  assert.notEqual(second.screenshot_url, r.screenshot_url);
  assert.equal((await call("GET", new URL(r.screenshot_url).pathname + `?k=${key}`, undefined, ip())).status, 200);
});

test("check, end to end: a page updated while the browser ran gets no screenshot of its old version", async () => {
  let r2ref: ReturnType<typeof fakeR2> | null = null;
  const b = fakeBrowser({ onLoad: () => { r2ref!.objects.set("pages/mine/index.html", { body: new TextEncoder().encode("<h1>v2</h1>") }); } });
  const s = await setup({ user: kim, browser: b.binding });
  r2ref = s.r2;
  // The fake R2 gives every object etag e1; make the update visible as a new etag.
  const head = s.r2.head.bind(s.r2);
  let updated = false;
  s.r2.head = async (k: string) => (updated && k === "pages/mine/index.html" ? { etag: "e2" } : head(k));
  const realSet = s.r2.objects.set.bind(s.r2.objects);
  s.r2.objects.set = (k, v) => { if (k === "pages/mine/index.html") updated = true; return realSet(k, v); };
  const r = (await (await s.call("POST", "/api/pages/mine/check", {}, ip())).json()) as { screenshot_url: string | null };
  assert.equal(r.screenshot_url, null);
  assert.ok(![...s.r2.objects.keys()].some((k) => k.includes("/checks/")));
});
