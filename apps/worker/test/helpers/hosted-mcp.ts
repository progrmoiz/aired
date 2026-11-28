import "./worker-loader.ts";
import { fakeD1 } from "./d1.ts";

/**
 * The hosted MCP server end to end, on fake bindings: the real API routes
 * (D1 is real SQLite with the real migrations) and createAiredMcpServer
 * over an in-memory transport. Import this before any Worker module.
 */

import "./worker-stubs.ts";

// Page history end to end: the real API, history routes and both kinds of
// MCP call, on fake bindings (D1 is real SQLite with the real migrations).
const { Hono } = await import("hono");
type Context = import("hono").Context;
const { api } = await import("../../src/routes/api.ts");
const { versions } = await import("../../src/routes/versions.ts");
const { pageTools } = await import("../../src/routes/page-tools.ts");
const { me } = await import("../../src/routes/me.ts");
const { applyApiContract } = await import("../../src/middleware/api-contract.ts");
const { createAiredMcpServer } = await import("../../src/routes/mcp.ts");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");


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
  app.route("/api/me", me as never);
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
  /**
   * An MCP client on the hosted server: anonymous, or signed in as `user` (an
   * API key caller). `capabilities` are the client's (e.g. the MCP Apps
   * extension); none by default, like a plain client.
   */
  const mcpClient = async (user?: number, capabilities: Record<string, unknown> = {}) => {
    const callApi = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
      const headers: Record<string, string> = { "User-Agent": "aired-mcp", "X-Aired-Request": "1", ...extra };
      if (user !== undefined) headers["X-Test-User"] = String(user);
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const res = await call(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    const server = createAiredMcpServer(env as never, user === undefined ? null : { login: `u${user}`, origin: "https://aired.sh" }, callApi as never);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" }, { capabilities });
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  };
  /** A tool caller on mcpClient(user). */
  const mcp = async (user?: number, capabilities?: Record<string, unknown>) => {
    const client = await mcpClient(user, capabilities);
    return async (name: string, args: Record<string, unknown>) =>
      (await client.callTool({ name, arguments: args })) as ToolAnswer;
  };
  return { env, d1, r2: r2.m, call, send, get, mcp, mcpClient };
}

/** A tool call's answer as a test reads it. */
export type ToolAnswer = { isError?: boolean; structuredContent?: Record<string, any>; content: Array<{ type?: string; text: string }>; _meta?: Record<string, any> };

export { setup };
