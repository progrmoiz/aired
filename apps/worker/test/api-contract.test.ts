import "./helpers/ts-resolve.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeD1 } from "./helpers/d1.ts";

// The real API router behind the same contract middleware index.ts applies
// (middleware/api-contract.ts). index.ts itself needs the Workers runtime.
const { Hono } = await import("hono");
const { api } = await import("../src/routes/api.ts");
const { applyApiContract, apiNotFound } = await import("../src/middleware/api-contract.ts");
const { BODY_LIMIT_BYTES } = await import("../src/lib/input-limits.ts");

type User = { id: number; login: string; email: string | null; name: string | null };

function fakeKv(): KVNamespace {
  const m = new Map<string, string>();
  return {
    async get(k: string, opts?: unknown) {
      const v = m.get(k) ?? null;
      const type = typeof opts === "string" ? opts : (opts as { type?: string } | undefined)?.type;
      return v !== null && type === "json" ? JSON.parse(v) : v;
    },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: "" }; },
  } as unknown as KVNamespace;
}

function fakeR2(): R2Bucket {
  const m = new Map<string, string>();
  return {
    async put(k: string, v: string) { m.set(k, String(v)); return { key: k, etag: `e${m.size}` }; },
    async get(k: string) {
      const v = m.get(k);
      return v === undefined ? null : { text: async () => v, body: v, customMetadata: {} };
    },
    async delete(keys: string | string[]) { for (const k of [keys].flat()) m.delete(k); },
    async list() { return { objects: [], truncated: false }; },
  } as unknown as R2Bucket;
}

function setup() {
  const d1 = fakeD1();
  const env = { PAGES_KV: fakeKv(), PAGES_BUCKET: fakeR2(), DB: d1.db, SESSION_SECRET: "x".repeat(32) };
  const app = new Hono<{ Bindings: typeof env; Variables: { user: User | null; via: string | null; jti: string | null; requestId: string } }>();
  // Stands in for authMiddleware: X-Test-User signs the request in as that id.
  app.use("*", async (c, next) => {
    const id = c.req.header("X-Test-User");
    c.set("user", id === undefined ? null : { id: Number(id), login: `u${id}`, email: null, name: null });
    c.set("via", id === undefined ? null : "key");
    c.set("jti", null);
    c.set("requestId", "test");
    await next();
  });
  applyApiContract(app as never);
  app.route("/api", api as never);
  app.get("/api/legacy-conflict", (c) => c.json({ error: "Already there" }, 409));
  app.get("/api/legacy-pending", (c) => c.json({ error: "authorization_pending" }, 400));
  app.notFound((c) => apiNotFound(c) ?? c.text("site 404", 404));
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} };
  const call = (path: string, init: RequestInit = {}) =>
    app.request(`https://aired.sh${path}`, { ...init, headers: { "CF-Connecting-IP": "203.0.113.9", ...(init.headers ?? {}) } }, env, ctx as never);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}, method = "POST") =>
    call(path, { method, body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });
  return { env, raw: d1.raw, call, post };
}

const publish = async (s: ReturnType<typeof setup>, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) => {
  const res = await s.post("/api/publish", { html: "<h1>Hello</h1>", ...body }, headers);
  return { res, body: (await res.json()) as Record<string, unknown> };
};

test("an unknown /api path answers a JSON 404 with a code", async () => {
  const s = setup();
  const res = await s.call("/api/nope");
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "Not found", code: "not_found" });
  assert.equal(await (await s.call("/elsewhere")).text(), "site 404");
});

test("older routes that send only { error } get a code from the status, or their own code-like error", async () => {
  const s = setup();
  assert.deepEqual(await (await s.call("/api/legacy-conflict")).json(), { error: "Already there", code: "conflict" });
  assert.deepEqual(await (await s.call("/api/legacy-pending")).json(), { error: "authorization_pending", code: "authorization_pending" });
});

test("publish: bad JSON, no html and a non-object body are 400s with codes", async () => {
  const s = setup();
  const bad = await s.post("/api/publish", "{nope");
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { code: string }).code, "invalid_json");

  const noHtml = await s.post("/api/publish", { title: "x" });
  assert.equal(noHtml.status, 400);
  assert.deepEqual(await noHtml.json(), { error: "html is required and must be a string", code: "invalid_input", field: "html" });

  const arr = await s.post("/api/publish", [1]);
  assert.deepEqual(await arr.json(), { error: "Request body must be a JSON object", code: "invalid_input" });
});

test("publish: ttl 1e20 or Infinity is a 400, not a 500", async () => {
  const s = setup();
  const huge = await s.post("/api/publish", { html: "<p>x</p>", ttl: 1e20 });
  assert.equal(huge.status, 400);
  const body = (await huge.json()) as Record<string, unknown>;
  assert.equal(body.code, "invalid_input");
  assert.equal(body.field, "ttl");
  // JSON.parse turns 1e400 into Infinity.
  const inf = await s.post("/api/publish", '{"html":"<p>x</p>","ttl":1e400}');
  assert.equal(inf.status, 400);
  // A year is still fine.
  const year = await publish(s, { ttl: 365 * 24 * 3600 });
  assert.equal(year.res.status, 200);
});

test("publish: a PIN over 64 characters and a view limit over a million are refused", async () => {
  const s = setup();
  const pin = await s.post("/api/publish", { html: "<p>x</p>", pin: "1".repeat(65) });
  assert.equal(pin.status, 400);
  assert.equal(((await pin.json()) as { field: string }).field, "pin");
  const reads = await s.post("/api/publish", { html: "<p>x</p>", reads: 1e9 });
  assert.equal(reads.status, 400);
});

test("publish: a wrong-typed field is still ignored, as before", async () => {
  const s = setup();
  const { res, body } = await publish(s, { title: 5, pin: 1234, ttl: "soon" });
  assert.equal(res.status, 200);
  const meta = (await (await s.call(`/api/pages/${body.id}`)).json()) as Record<string, unknown>;
  assert.equal(meta.pinProtected, false);
  assert.equal(meta.title, null);
});

test("publish: a long title is cut to 200 characters", async () => {
  const s = setup();
  const { body } = await publish(s, { title: "t".repeat(500) });
  const meta = (await (await s.call(`/api/pages/${body.id}`)).json()) as { title: string };
  assert.equal(meta.title.length, 200);
  // A <title> from the HTML is cut the same way.
  const fromHtml = await publish(s, { html: `<title>${"h".repeat(300)}</title>` });
  const meta2 = (await (await s.call(`/api/pages/${fromHtml.body.id}`)).json()) as { title: string };
  assert.equal(meta2.title.length, 200);
});

test("bodies over the limit are a 413, with or without Content-Length", async () => {
  const s = setup();
  const big = JSON.stringify({ message: "x".repeat(BODY_LIMIT_BYTES) });
  const declared = await s.post("/api/feedback", big, { "Content-Length": String(big.length) });
  assert.equal(declared.status, 413);
  assert.deepEqual(await declared.json(), { error: "Request body too large: the limit is 1 MB.", code: "payload_too_large" });
  // Streamed: counted as it's read.
  const streamed = await s.post("/api/feedback", big);
  assert.equal(streamed.status, 413);
  assert.equal(((await streamed.json()) as { code: string }).code, "payload_too_large");
});

test("PUT and DELETE agree: no credential is 401, someone else's page is 403, a wrong token is 403", async () => {
  const s = setup();
  const { body: page } = await publish(s);
  const id = String(page.id);
  const put = (headers: Record<string, string> = {}, extra: Record<string, unknown> = {}) =>
    s.post(`/api/pages/${id}`, { html: "<p>new</p>", ...extra }, headers, "PUT");
  const del = (headers: Record<string, string> = {}) => s.call(`/api/pages/${id}`, { method: "DELETE", headers });
  const codeOf = async (r: Response) => [r.status, ((await r.json()) as { code: string }).code];

  assert.deepEqual(await codeOf(await put()), [401, "token_required"]);
  assert.deepEqual(await codeOf(await del()), [401, "token_required"]);
  assert.deepEqual(await codeOf(await put({ "X-Test-User": "8" })), [403, "not_owner"]);
  assert.deepEqual(await codeOf(await del({ "X-Test-User": "8" })), [403, "not_owner"]);
  assert.deepEqual(await codeOf(await put({}, { update_token: "at_wrong" })), [403, "invalid_token"]);
  assert.deepEqual(await codeOf(await del({ Authorization: "Bearer at_wrong" })), [403, "invalid_token"]);

  // The right token still works for both.
  assert.equal((await put({}, { update_token: page.update_token })).status, 200);
  assert.equal((await del({ Authorization: `Bearer ${page.update_token}` })).status, 200);
});

test("CSRF: a request carrying the session cookie needs X-Aired-Request on every /api write, publish included", async () => {
  const s = setup();
  const cookie = { Cookie: "aired_session=abc" };
  const blocked = await s.post("/api/publish", { html: "<p>x</p>" }, cookie);
  assert.equal(blocked.status, 403);
  assert.equal(((await blocked.json()) as { code: string }).code, "forbidden");
  const report = await s.post("/api/report", { id: "x", reason: "spam" }, cookie);
  assert.equal(report.status, 403);
  // With the header, or without the cookie (CLI, agents), it goes through.
  assert.equal((await s.post("/api/publish", { html: "<p>x</p>" }, { ...cookie, "X-Aired-Request": "1" })).status, 200);
  assert.equal((await s.post("/api/publish", { html: "<p>x</p>" })).status, 200);
  // Reads never need it.
  assert.equal((await s.call("/api/stats", { headers: cookie })).status, 200);
});

test("anonymous publishes are counted in D1 and the sixth in an hour is a 429", async () => {
  const s = setup();
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push((await publish(s, {}, { "CF-Connecting-IP": "198.51.100.77" })).res.status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  const rows = s.raw.prepare("SELECT bucket, count FROM rate_limits WHERE bucket LIKE 'rl:ip:%'").all() as Array<{ count: number }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.count, 5);
  const last = await publish(s, {}, { "CF-Connecting-IP": "198.51.100.77" });
  assert.equal(last.body.code, "rate_limited");
});

test("a PIN-protected page's public metadata hides its title and views", async () => {
  const s = setup();
  const { body } = await publish(s, { title: "Salary review", pin: "4821" });
  const res = await s.call(`/api/pages/${body.id}`);
  assert.equal(res.status, 200);
  const meta = (await res.json()) as Record<string, unknown>;
  assert.equal(meta.title, null);
  assert.equal(meta.readCount, 0);
  assert.equal(meta.pinProtected, true);
  assert.equal(meta.id, body.id);

  const open = await publish(s, { title: "Open page" });
  const openMeta = (await (await s.call(`/api/pages/${open.body.id}`)).json()) as Record<string, unknown>;
  assert.equal(openMeta.title, "Open page");
  assert.equal(openMeta.pinProtected, false);
});
