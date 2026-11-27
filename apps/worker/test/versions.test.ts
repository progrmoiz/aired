import "./helpers/worker-loader.ts";
import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { skillsText } from "./helpers/skills.ts";
import { fakeD1 } from "./helpers/d1.ts";

// routes/mcp.ts bundles the skill as text (wrangler [[rules]]): load .md the
// same way here. Its MCP library (agents) imports two Workers-only modules:
// stand-ins with the classes it names.
const workersStub =
  "data:text/javascript," +
  encodeURIComponent(
    "class Base { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } export class WorkerEntrypoint extends Base {} export class DurableObject extends Base {} export class WorkflowEntrypoint extends Base {} export class RpcTarget {} export const env = {};",
  );
const emailStub = "data:text/javascript," + encodeURIComponent("export class EmailMessage {}");
register(
  "data:text/javascript," +
    encodeURIComponent(`
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
export async function resolve(spec, ctx, next) {
  if (spec === "cloudflare:workers") return { url: ${JSON.stringify(workersStub)}, shortCircuit: true };
  if (spec === "cloudflare:email") return { url: ${JSON.stringify(emailStub)}, shortCircuit: true };
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url.endsWith(".md")) return { format: "module", source: "export default " + JSON.stringify(readFileSync(fileURLToPath(url), "utf8")), shortCircuit: true };
  return next(url, ctx);
}`),
);

// Page history end to end: the real API, history routes and both kinds of
// MCP call, on fake bindings (D1 is real SQLite with the real migrations).
const { Hono } = await import("hono");
type Context = import("hono").Context;
const { api } = await import("../src/routes/api.ts");
const { versions } = await import("../src/routes/versions.ts");
const { pageTools } = await import("../src/routes/page-tools.ts");
const { applyApiContract } = await import("../src/middleware/api-contract.ts");
const { createAiredMcpServer } = await import("../src/routes/mcp.ts");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { saveVersion, pruneVersions, trimVersions, versionAuthor, removeOwnerVersionsStatement, deleteRemovedVersions, listVersions, versionsPrefix } = await import(
  "../src/lib/page-versions.ts"
);
const { VERSION_LIMITS, ALWAYS_KEEP, MOST_VERSIONS } = await import("../src/lib/version-limits.ts");
const { deleteAccountRows } = await import("../src/lib/billing/forget.ts");
const { releaseOwnerPagesStatement } = await import("../src/lib/pages-store.ts");

const DAY = 86_400_000;

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

function fakeR2() {
  const m = new Map<string, string>();
  let n = 0;
  const bucket = {
    async put(k: string, v: string) { m.set(k, String(v)); return { key: k, etag: `e${++n}` }; },
    async get(k: string) {
      const v = m.get(k);
      return v === undefined ? null : { text: async () => v, body: v, etag: "e1", customMetadata: {} };
    },
    async head(k: string) { return m.has(k) ? { key: k, etag: "e1" } : null; },
    async delete(keys: string | string[]) { for (const k of [keys].flat()) m.delete(k); },
    async list({ prefix = "" }: { prefix?: string } = {}) {
      return { objects: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, uploaded: new Date(), etag: "e1" })), truncated: false };
    },
  };
  return { bucket: bucket as unknown as R2Bucket, m };
}

function setup() {
  const d1 = fakeD1();
  const r2 = fakeR2();
  const env = { PAGES_KV: fakeKv(), PAGES_BUCKET: r2.bucket, DB: d1.db, SESSION_SECRET: "x".repeat(32), SITE_ORIGIN: "https://aired.sh" };
  const app = new Hono();
  // X-Test-User signs the request in (as an API key caller); X-Test-Via overrides how.
  applyApiContract(app as never, (async (c: Context, next: () => Promise<void>) => {
    const id = c.req.header("X-Test-User");
    c.set("user", id === undefined ? null : { id: Number(id), login: `u${id}`, email: null, name: null });
    c.set("via", id === undefined ? null : (c.req.header("X-Test-Via") ?? "key"));
    c.set("jti", null);
    c.set("requestId", "test");
    await next();
  }) as never);
  app.route("/api", pageTools as never);
  app.route("/api", versions as never);
  app.route("/api", api as never);
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} };
  let ip = 0;
  const call = (path: string, init: RequestInit = {}) =>
    app.request(`https://aired.sh${path}`, { ...init, headers: { "CF-Connecting-IP": `203.0.113.${++ip % 250}`, ...(init.headers ?? {}) } }, env, ctx as never);
  const send = async (method: string, path: string, body: unknown, headers: Record<string, string> = {}) => {
    const res = await call(path, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json", "X-Aired-Request": "1", ...headers } });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  const get = async (path: string, headers: Record<string, string> = {}) => {
    const res = await call(path, { headers });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  /** An MCP client on the hosted server: anonymous, or signed in as `user` (an API key caller). */
  const mcp = async (user?: number) => {
    const callApi = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
      const headers: Record<string, string> = { "User-Agent": "aired-mcp", "X-Aired-Request": "1", ...extra };
      if (user !== undefined) headers["X-Test-User"] = String(user);
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const res = await call(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    const server = createAiredMcpServer(env as never, user === undefined ? null : { login: `u${user}`, origin: "https://aired.sh" }, callApi as never, () => {});
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    return async (name: string, args: Record<string, unknown>) =>
      (await client.callTool({ name, arguments: args })) as { isError?: boolean; structuredContent?: Record<string, any>; content: Array<{ text: string }> };
  };
  return { env, d1, r2: r2.m, call, send, get, mcp };
}

const kim = { "X-Test-User": "7" };
const ana = { "X-Test-User": "8" };
const page = (n: number) => `<!doctype html><html><head><title>Draft ${n}</title></head><body><h1>Draft ${n}</h1></body></html>`;
const versionFiles = (s: ReturnType<typeof setup>, id: string) => [...s.r2.keys()].filter((k) => k.startsWith(versionsPrefix(id)));

// --- Versions are kept on every update path -----------------------------------

test("every update path keeps what it replaced, numbered, with who did it", async () => {
  const s = setup();
  const pub = await s.send("POST", "/api/publish", { html: page(1) }, kim);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.version, 1);
  const id = String(pub.body.id);
  const token = String(pub.body.update_token);

  // PUT by the signed-in owner, with a note.
  const put = await s.send("PUT", `/api/pages/${id}`, { html: page(2), message: "Fix the heading" }, kim);
  assert.equal(put.status, 200);
  assert.equal(put.body.version, 2);
  // Publish with id + update token (no sign-in).
  const upd = await s.send("POST", "/api/publish", { html: page(3), id, update_token: token });
  assert.equal(upd.body.version, 3);
  // PUT with the token in the Bearer header, from the CLI.
  const cli = await s.send("PUT", `/api/pages/${id}`, { html: page(4) }, { Authorization: `Bearer ${token}`, "User-Agent": "aired/1.7.0" });
  assert.equal(cli.body.version, 4);
  // update_page over the hosted MCP, signed in.
  const tool = await s.mcp(7);
  const viaMcp = await tool("update_page", { id, html: page(5), message: "From the agent" });
  assert.equal(viaMcp.isError, undefined);
  assert.equal(viaMcp.structuredContent?.version, 5);

  const list = await s.get(`/api/pages/${id}/versions`, kim);
  assert.equal(list.status, 200);
  assert.equal(list.body.current, 5);
  const v = list.body.versions as Array<Record<string, any>>;
  assert.deepEqual(v.map((x) => x.version), [5, 4, 3, 2, 1]);
  assert.deepEqual(v.map((x) => x.current), [true, false, false, false, false]);
  assert.deepEqual(v.map((x) => x.actor), ["agent", "token", "token", "owner", "owner"]);
  assert.deepEqual(v.map((x) => x.client), ["mcp", "cli", "api", "api", "api"]);
  assert.deepEqual(v.map((x) => x.message), ["From the agent", null, null, "Fix the heading", null]);
  assert.deepEqual(v.map((x) => x.title), ["Draft 5", "Draft 4", "Draft 3", "Draft 2", "Draft 1"]);
  assert.ok(v.slice(1).every((x) => typeof x.replaced_at === "string"));
  assert.equal(v[0]!.replaced_at, null);
  assert.equal(list.body.kept.plan, "free");
  assert.equal(list.body.kept.versions, VERSION_LIMITS.free.versions);
  // Each kept version's HTML is the content it had, and the live one the page's.
  for (const n of [1, 2, 3, 4, 5]) {
    const one = await s.get(`/api/pages/${id}/versions/${n}`, kim);
    assert.equal(one.status, 200, `version ${n}`);
    assert.equal(one.body.html, page(n));
    assert.equal(one.body.version, n);
  }
  assert.equal(versionFiles(s, id).length, 4, "one file per kept version, none for the live one");
  // get_page shows the count.
  const details = await s.get(`/api/pages/${id}/details`, kim);
  assert.equal(details.body.version, 5);
  assert.equal(details.body.versions, 5);
  const gp = await tool("get_page", { id });
  assert.equal(gp.structuredContent?.version, 5);
  assert.match(gp.content[0]!.text, /Version: 5 \(4 earlier versions kept; list_versions shows them\)/);
});

test("the anonymous MCP publish and its token update keep versions too", async () => {
  const s = setup();
  const tool = await s.mcp();
  const first = await tool("publish_html", { html: page(1) });
  assert.equal(first.structuredContent?.version, 1);
  const id = String(first.structuredContent?.id);
  const token = String(first.structuredContent?.update_token);
  const second = await tool("publish_html", { html: page(2), id, update_token: token, message: "Second pass" });
  assert.equal(second.structuredContent?.version, 2);
  const listed = await tool("list_versions", { id, update_token: token });
  assert.equal(listed.isError, undefined);
  const v = listed.structuredContent?.versions as Array<Record<string, any>>;
  assert.deepEqual(v.map((x) => [x.version, x.actor, x.client, x.message]), [[2, "token", "mcp", "Second pass"], [1, "agent", "mcp", null]]);
  assert.match(listed.content[0]!.text, /v2 \(live\)/);
  assert.match(listed.content[0]!.text, /restore_version/);
  // Without the token, an anonymous caller is told how to get in.
  const refused = await tool("list_versions", { id });
  assert.equal(refused.isError, true);
});

test("a page published before history keeps its first content on the first update", async () => {
  const s = setup();
  const id = String((await s.send("POST", "/api/publish", { html: page(1) }, kim)).body.id);
  // As if published before 0016: no version rows at all.
  s.d1.raw.exec("DELETE FROM page_versions");
  const before = await s.get(`/api/pages/${id}/versions`, kim);
  assert.deepEqual(before.body.versions.map((x: any) => [x.version, x.current, x.actor, x.created_at]), [[1, true, "unknown", null]]);
  await s.send("PUT", `/api/pages/${id}`, { html: page(2) }, kim);
  const after = await s.get(`/api/pages/${id}/versions`, kim);
  assert.deepEqual(after.body.versions.map((x: any) => [x.version, x.current, x.actor]), [[2, true, "owner"], [1, false, "unknown"]]);
  assert.equal((await s.get(`/api/pages/${id}/versions/1`, kim)).body.html, page(1));
});

// --- Restore -------------------------------------------------------------------

test("restoring makes the old content a new version and rewrites nothing", async () => {
  const s = setup();
  const id = String((await s.send("POST", "/api/publish", { html: page(1) }, kim)).body.id);
  await s.send("PUT", `/api/pages/${id}`, { html: page(2) }, kim);
  await s.send("PUT", `/api/pages/${id}`, { html: page(3) }, kim);

  const r = await s.send("POST", `/api/pages/${id}/versions/1/restore`, { message: "Back to the first draft" }, kim);
  assert.equal(r.status, 200);
  assert.equal(r.body.version, 4);
  assert.equal(r.body.restored_from, 1);
  assert.equal(s.r2.get(`pages/${id}/index.html`), page(1), "the live page is version 1's content");
  const v = (await s.get(`/api/pages/${id}/versions`, kim)).body.versions as Array<Record<string, any>>;
  assert.deepEqual(v.map((x) => x.version), [4, 3, 2, 1]);
  assert.deepEqual(v.map((x) => x.restored_from), [1, null, null, null]);
  assert.equal(v[0]!.message, "Back to the first draft");
  assert.equal(v[0]!.title, "Draft 1");
  // Every earlier version is still there as it was.
  for (const n of [1, 2, 3]) assert.equal((await s.get(`/api/pages/${id}/versions/${n}`, kim)).body.html, page(n));
  // The restore itself can be undone the same way.
  const undo = await s.send("POST", `/api/pages/${id}/versions/3/restore`, {}, kim);
  assert.equal(undo.body.version, 5);
  assert.equal(s.r2.get(`pages/${id}/index.html`), page(3));

  // The live version, a missing one and a bad number.
  assert.equal((await s.send("POST", `/api/pages/${id}/versions/5/restore`, {}, kim)).body.code, "already_current");
  const missing = await s.send("POST", `/api/pages/${id}/versions/99/restore`, {}, kim);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "version_not_found");
  assert.equal((await s.send("POST", `/api/pages/${id}/versions/0/restore`, {}, kim)).status, 404);
  assert.equal((await s.send("POST", `/api/pages/${id}/versions/1/restore`, { message: "x".repeat(201) }, kim)).status, 400);
});

test("restore brings back a Markdown doc's source with its HTML", async () => {
  const s = setup();
  const id = String((await s.send("POST", "/api/publish", { markdown: "# Notes\n\nFirst version." }, kim)).body.id);
  await s.send("PUT", `/api/pages/${id}`, { html: page(2) }, kim);
  assert.equal((await s.get(`/api/pages/${id}/details`, kim)).body.kind, "page");
  const one = await s.get(`/api/pages/${id}/versions/1`, kim);
  assert.equal(one.body.kind, "doc");
  assert.equal(one.body.format, "markdown");
  assert.equal(one.body.source, "# Notes\n\nFirst version.");
  const r = await s.send("POST", `/api/pages/${id}/versions/1/restore`, {}, kim);
  assert.equal(r.body.kind, "doc");
  const src = await s.get(`/api/pages/${id}/source`, kim);
  assert.equal(src.body.format, "markdown");
  assert.equal(src.body.source, "# Notes\n\nFirst version.");
});

test("restore_version on the hosted MCP, signed in and by token", async () => {
  const s = setup();
  const tool = await s.mcp(7);
  const first = await tool("publish_html", { html: page(1) });
  const id = String(first.structuredContent?.id);
  await tool("update_page", { id, html: page(2) });
  const r = await tool("restore_version", { id, version: 1, message: "Undo" });
  assert.equal(r.isError, undefined);
  assert.deepEqual({ v: r.structuredContent?.version, from: r.structuredContent?.restored_from }, { v: 3, from: 1 });
  assert.match(r.content[0]!.text, /Restored version 1 of https:\/\/aired\.sh\/p\/\w+ as version 3/);
  assert.equal(s.r2.get(`pages/${id}/index.html`), page(1));
  // Anonymous page, by token.
  const anon = await s.mcp();
  const a = await anon("publish_html", { html: page(1) });
  const aid = String(a.structuredContent?.id);
  const tok = String(a.structuredContent?.update_token);
  await anon("publish_html", { html: page(2), id: aid, update_token: tok });
  const back = await anon("restore_version", { id: aid, version: 1, update_token: tok });
  assert.equal(back.structuredContent?.version, 3);
  const wrong = await anon("restore_version", { id: aid, version: 1, update_token: "nope" });
  assert.equal(wrong.isError, true);
});

// --- Who may see and restore --------------------------------------------------

test("only the owner or the page's token: another account, a wrong token and nobody are refused", async () => {
  const s = setup();
  const pub = await s.send("POST", "/api/publish", { html: page(1) }, kim);
  const id = String(pub.body.id);
  const token = String(pub.body.update_token);
  await s.send("PUT", `/api/pages/${id}`, { html: page(2) }, kim);
  for (const [method, path] of [
    ["GET", `/api/pages/${id}/versions`],
    ["GET", `/api/pages/${id}/versions/1`],
    ["POST", `/api/pages/${id}/versions/1/restore`],
  ] as const) {
    const go = (headers: Record<string, string>, body: unknown = {}) => (method === "GET" ? s.get(path, headers) : s.send(method, path, body, headers));
    const other = await go(ana);
    assert.equal(other.status, 403, `${path}: another account`);
    assert.equal(other.body.code, "not_owner");
    assert.ok(!JSON.stringify(other.body).includes("Draft"), "nothing of the page leaks");
    const wrong = await go({ "X-Update-Token": "wrong" }, { update_token: "wrong" });
    assert.equal(wrong.status, 403, `${path}: wrong token`);
    assert.equal(wrong.body.code, "invalid_token");
    // Another account with a wrong token: still refused.
    assert.equal((await go({ ...ana, "X-Update-Token": "wrong" }, { update_token: "wrong" })).status, 403);
    const nobody = await go({});
    assert.equal(nobody.status, 401, `${path}: no credentials`);
  }
  // The token works without signing in; the owner without the token.
  assert.equal((await s.get(`/api/pages/${id}/versions`, { "X-Update-Token": token })).status, 200);
  assert.equal((await s.send("POST", `/api/pages/${id}/versions/1/restore`, { update_token: token })).status, 200);
  const after = (await s.get(`/api/pages/${id}/versions`, kim)).body.versions as Array<Record<string, any>>;
  assert.equal(after[0]!.actor, "token");
  // Nothing was restored by the refused calls.
  assert.deepEqual(after.map((x) => x.version), [3, 2, 1]);
});

test("a page with collected responses is restored only by its signed-in owner", async () => {
  const s = setup();
  const pub = await s.send("POST", "/api/publish", { html: page(1) }, kim);
  const id = String(pub.body.id);
  const token = String(pub.body.update_token);
  await s.send("PUT", `/api/pages/${id}`, { html: page(2) }, kim);
  s.d1.raw
    .prepare("INSERT INTO responses (id, page_id, owner_id, viewer, entry_key, data, size, created_at, updated_at, expires_at) VALUES (?, ?, 7, 'v', NULL, '{}', 2, 1, 1, NULL)")
    .run("r1", id);
  const byToken = await s.send("POST", `/api/pages/${id}/versions/1/restore`, { update_token: token });
  assert.equal(byToken.status, 403);
  assert.equal(byToken.body.code, "owner_required");
  assert.equal(s.r2.get(`pages/${id}/index.html`), page(2), "unchanged");
  // Listing by token still works: it changes nothing.
  assert.equal((await s.get(`/api/pages/${id}/versions`, { "X-Update-Token": token })).status, 200);
  const anon = await s.mcp();
  const viaTool = await anon("restore_version", { id, version: 1, update_token: token });
  assert.equal(viaTool.isError, true);
  assert.match(viaTool.content[0]!.text, /only its owner/);
  assert.equal((await s.send("POST", `/api/pages/${id}/versions/1/restore`, {}, kim)).status, 200);
  assert.equal(s.r2.get(`pages/${id}/index.html`), page(1));
});

// --- Retention and pruning ------------------------------------------------------

test("Free keeps the last 5 earlier versions: older ones and their files go on the next update", async () => {
  const s = setup();
  const id = String((await s.send("POST", "/api/publish", { html: page(1) }, kim)).body.id);
  for (let n = 2; n <= 9; n++) await s.send("PUT", `/api/pages/${id}`, { html: page(n) }, kim);
  const v = (await s.get(`/api/pages/${id}/versions`, kim)).body.versions as Array<Record<string, any>>;
  assert.deepEqual(v.map((x) => x.version), [9, 8, 7, 6, 5, 4]);
  assert.equal(versionFiles(s, id).length, 5, "the trimmed versions' files are deleted too");
  assert.equal((await s.get(`/api/pages/${id}/versions/3`, kim)).status, 404);
  // Free versions have no day limit.
  assert.ok(v.slice(1).every((x) => x.kept_until === null));
});

test("Pro: 50 versions, each for 90 days, but the newest 5 stay however old", async () => {
  const s = setup();
  const env = { DB: s.d1.db, PAGES_BUCKET: s.env.PAGES_BUCKET };
  const id = String((await s.send("POST", "/api/publish", { html: page(0) }, kim)).body.id);
  const t0 = Date.now();
  const author = versionAuthor({ viaToken: false, via: "key", userAgent: undefined });
  // 8 Pro updates, a day apart.
  for (let n = 1; n <= 8; n++) {
    await saveVersion(env, id, { size: 10, title: null }, { size: 10, title: `v${n + 1}`, kind: "page" }, author, "pro", t0 + n * DAY);
    s.r2.set(`pages/${id}/index.html`, page(n));
  }
  let rows = await listVersions(s.d1.db, id);
  assert.equal(rows.filter((r) => !r.current).length, 8);
  assert.ok(rows.filter((r) => !r.current).every((r) => r.keepUntil !== null));
  // Nothing is past 90 days yet.
  assert.deepEqual(await pruneVersions(env, t0 + 50 * DAY), { removed: 0, gone: 0, old: 0, over: 0 });
  // Long after: all 8 are past their days, but the newest 5 stay.
  const res = await pruneVersions(env, t0 + 400 * DAY);
  assert.equal(res.old, 8 - ALWAYS_KEEP);
  rows = await listVersions(s.d1.db, id);
  assert.deepEqual(rows.filter((r) => !r.current).map((r) => r.version), [8, 7, 6, 5, 4]);
  assert.equal(versionFiles(s, id).length, 5);
  // And the count: a page over the most any plan keeps is cut back hourly.
  for (let n = 0; n < MOST_VERSIONS + 3; n++) {
    await saveVersion(env, id, { size: 10, title: null }, { size: 10, title: null, kind: "page" }, author, "pro", t0 + 401 * DAY);
  }
  const over = await pruneVersions(env, t0 + 401 * DAY);
  // The 5 old ones are past their days and no longer among the newest; then 3 over the count.
  assert.deepEqual({ old: over.old, over: over.over }, { old: ALWAYS_KEEP, over: 3 });
  assert.equal((await listVersions(s.d1.db, id)).filter((r) => !r.current).length, MOST_VERSIONS);
  // trimVersions takes it to a plan's count straight away.
  await trimVersions(env, id, VERSION_LIMITS.free.versions);
  assert.equal((await listVersions(s.d1.db, id)).filter((r) => !r.current).length, VERSION_LIMITS.free.versions);
  assert.equal(versionFiles(s, id).length, VERSION_LIMITS.free.versions);
});

test("housekeeping clears the history of expired pages", async () => {
  const s = setup();
  const env = { DB: s.d1.db, PAGES_BUCKET: s.env.PAGES_BUCKET };
  const pub = await s.send("POST", "/api/publish", { html: page(1) });
  const id = String(pub.body.id);
  await s.send("POST", "/api/publish", { html: page(2), id, update_token: pub.body.update_token });
  assert.equal(versionFiles(s, id).length, 1);
  // An anonymous page expires after 7 days.
  const res = await pruneVersions(env, Date.now() + 8 * DAY);
  assert.equal(res.gone, 2, "the kept version and the live row");
  assert.equal(versionFiles(s, id).length, 0);
  assert.equal(s.d1.raw.prepare("SELECT COUNT(*) AS n FROM page_versions").get()!.n, 0);
});

// --- Deletion -------------------------------------------------------------------

test("deleting a page deletes every version, files and rows", async () => {
  const s = setup();
  const id = String((await s.send("POST", "/api/publish", { html: page(1) }, kim)).body.id);
  for (let n = 2; n <= 4; n++) await s.send("PUT", `/api/pages/${id}`, { html: page(n) }, kim);
  assert.equal(versionFiles(s, id).length, 3);
  assert.equal((await s.send("DELETE", `/api/pages/${id}`, {}, kim)).status, 200);
  assert.equal(versionFiles(s, id).length, 0);
  assert.equal(s.d1.raw.prepare("SELECT COUNT(*) AS n FROM page_versions WHERE page_id = ?").get(id)!.n, 0);
  assert.equal((await s.get(`/api/pages/${id}/versions`, kim)).status, 404);
});

test("deleting an account removes its pages' history; the pages live on, anonymous", async () => {
  const s = setup();
  const pub = await s.send("POST", "/api/publish", { html: page(1) }, kim);
  const id = String(pub.body.id);
  const token = String(pub.body.update_token);
  await s.send("PUT", `/api/pages/${id}`, { html: page(2) }, kim);
  const other = String((await s.send("POST", "/api/publish", { html: page(1) }, ana)).body.id);
  await s.send("PUT", `/api/pages/${other}`, { html: page(2) }, ana);

  const now = Date.now();
  // The same statements, in the same order, as routes/me.ts.
  await deleteAccountRows(s.d1.db, 7, [removeOwnerVersionsStatement(s.d1.db, 7, now), releaseOwnerPagesStatement(s.d1.db, 7, now)]);
  // Removed at once: the token holder sees only the live content, and can't restore.
  const listed = await s.get(`/api/pages/${id}/versions`, { "X-Update-Token": token });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.versions.map((x: any) => x.current), [true]);
  assert.equal((await s.send("POST", `/api/pages/${id}/versions/1/restore`, { update_token: token })).status, 404);
  // The files go with deleteRemovedVersions (after the response, and hourly).
  await deleteRemovedVersions({ DB: s.d1.db, PAGES_BUCKET: s.env.PAGES_BUCKET });
  assert.equal(versionFiles(s, id).length, 0);
  assert.equal(s.d1.raw.prepare("SELECT COUNT(*) AS n FROM page_versions WHERE page_id = ?").get(id)!.n, 0);
  // Another account's history is untouched.
  assert.equal(versionFiles(s, other).length, 1);
  assert.equal((await s.get(`/api/pages/${other}/versions`, ana)).body.versions.length, 2);
  // The anonymous page keeps history again from its next update.
  await s.send("PUT", `/api/pages/${id}`, { html: page(3) }, { Authorization: `Bearer ${token}` });
  const again = (await s.get(`/api/pages/${id}/versions`, { "X-Update-Token": token })).body.versions as Array<Record<string, any>>;
  assert.equal(again.length, 2);
  assert.equal((await s.get(`/api/pages/${id}/versions/${again[1]!.version}`, { "X-Update-Token": token })).body.html, page(2));
});

// --- Units and wiring -------------------------------------------------------------

test("versionAuthor: token, agent or owner, and the client", () => {
  assert.deepEqual(versionAuthor({ viaToken: true, via: null, userAgent: "aired/1.7.0" }), { actor: "token", client: "cli", message: null });
  assert.deepEqual(versionAuthor({ viaToken: false, via: "key", userAgent: "aired-mcp/1.7.0", message: " note " }), { actor: "agent", client: "mcp", message: "note" });
  assert.equal(versionAuthor({ viaToken: false, via: "oauth", userAgent: undefined }).actor, "agent");
  assert.deepEqual(versionAuthor({ viaToken: false, via: "cookie", userAgent: "Mozilla/5.0", restoredFrom: 3 }), { actor: "owner", client: "web", message: null, restoredFrom: 3 });
  assert.equal(versionAuthor({ viaToken: false, via: "key", userAgent: "curl/8" }).client, "api");
});

test("wiring: every content write goes through updatePage, and housekeeping and deletion clear history", () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const write = src("../src/lib/page-write.ts");
  const update = write.slice(write.indexOf("export async function updatePage"), write.indexOf("export class PageGone"));
  // The old content is copied before the new HTML overwrites it.
  assert.ok(update.indexOf("saveVersion(") < update.indexOf("PAGES_BUCKET.put(`pages/${row.id}/index.html`"));
  assert.match(update, /trimVersions\(env, row\.id, VERSION_LIMITS\[plan\]\.versions\)/);
  const del = write.slice(write.indexOf("export async function deletePage"));
  assert.match(del.slice(0, del.indexOf("\n}\n")), /await deletePageVersions\(env, row\.id\)/);
  assert.match(src("../src/index.ts"), /const versions = await pruneVersions\(env, now\);/);
  assert.match(src("../src/index.ts"), /app\.route\("\/api", versions\);\s*app\.route\("\/api", api\);/);
  // Restore checks the owner, then the responses rule, before reading or writing.
  const v = src("../src/routes/versions.ts");
  const restore = v.slice(v.indexOf('versions.post("/pages/:id/versions/:n/restore"'));
  assert.ok(restore.indexOf("ownedPage(c,") < restore.indexOf("replaceRefusal(c, page)"));
  assert.ok(restore.indexOf("replaceRefusal(c, page)") < restore.indexOf("readVersionContent("));
  assert.match(restore, /requireCsrfHeader, rateLimit\(TIERS\.page_options\)/);
});

test("the docs cover history, and state the same retention as the config", () => {
  // "apps/cli skills": apps/cli/SKILL.md, its references and the skills under apps/cli/skills.
  const read = (f: string) => (f === "apps/cli skills" ? skillsText() : readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8"));
  const { free, pro } = VERSION_LIMITS;
  for (const f of ["apps/cli skills", "apps/web/docs.html", "apps/web/llms.txt", "apps/web/llms-full.txt"]) {
    const s = read(f);
    for (const want of ["aired versions", "aired restore", "list_versions", "restore_version"]) assert.ok(s.includes(want), `${f} misses ${want}`);
    assert.ok(s.includes(`last ${free.versions}`), `${f}: Free keeps the last ${free.versions}`);
    assert.ok(s.includes(`last ${pro.versions}`) && s.includes(`${pro.days} days`), `${f}: Pro keeps ${pro.versions} for ${pro.days} days`);
    assert.ok(s.includes(`newest ${ALWAYS_KEEP}`), `${f}: the newest ${ALWAYS_KEEP} stay`);
  }
  for (const f of ["apps/web/docs.html", "apps/web/llms.txt", "apps/web/llms-full.txt"]) {
    for (const want of ["/api/pages/:id/versions", "/versions/:n/restore"]) assert.ok(read(f).includes(want), `${f} misses ${want}`);
  }
  const privacy = read("apps/web/privacy.html");
  assert.match(privacy, new RegExp(`On the Free plan we keep the last ${free.versions}; on Pro the last ${pro.versions}, each for ${pro.days} days`));
  assert.match(read("docs/backups.md"), /page_versions/);
});
