import "./worker-stubs.ts";
import { fakeD1 } from "./d1.ts";

/**
 * Every /api router, mounted the way index.ts mounts them (routes/api-table.ts),
 * behind the real API contract middleware (middleware/api-contract.ts) with a
 * stand-in for authMiddleware. D1 is real SQLite with the real migrations.
 * index.ts itself needs the Workers runtime. Import this before any Worker module.
 *
 * X-Test-User signs a request in as that id (as an API key caller), and
 * X-Test-Bad-Key answers 401 the way a revoked API key does.
 */
const { Hono } = await import("hono");
type Context = import("hono").Context;
const { applyApiContract, apiNotFound } = await import("../../src/middleware/api-contract.ts");
const { mountApi, mountMixed, allowedMethods } = await import("../../src/routes/api-table.ts");

export type User = { id: number; login: string; email: string | null; name: string | null };

export function fakeKv(): KVNamespace {
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

export function fakeR2(): R2Bucket {
  const m = new Map<string, string>();
  return {
    async put(k: string, v: string) { m.set(k, String(v)); return { key: k, etag: `e${m.size}` }; },
    async get(k: string) {
      const v = m.get(k);
      return v === undefined ? null : { text: async () => v, body: v, customMetadata: {} };
    },
    async head(k: string) { return m.has(k) ? { key: k, etag: "e1" } : null; },
    async delete(keys: string | string[]) { for (const k of [keys].flat()) m.delete(k); },
    async list() { return { objects: [], truncated: false }; },
  } as unknown as R2Bucket;
}

export function setupApi(extra: { routes?: (app: InstanceType<typeof Hono>) => void } = {}) {
  const d1 = fakeD1();
  const env = { PAGES_KV: fakeKv(), PAGES_BUCKET: fakeR2(), DB: d1.db, SESSION_SECRET: "x".repeat(32) };
  const app = new Hono<{ Bindings: typeof env; Variables: { user: User | null; via: string | null; jti: string | null; requestId: string } }>();
  applyApiContract(app as never, (async (c: Context, next: () => Promise<void>) => {
    if (c.req.header("X-Test-Bad-Key") !== undefined) return c.json({ error: "Invalid or revoked API key" }, 401);
    const id = c.req.header("X-Test-User");
    c.set("user", id === undefined ? null : { id: Number(id), login: `u${id}`, email: null, name: null });
    c.set("via", id === undefined ? null : "key");
    c.set("jti", null);
    c.set("requestId", "test");
    await next();
  }) as never);
  extra.routes?.(app as never);
  mountApi(app as never);
  mountMixed(app as never);
  app.notFound((c) => apiNotFound(c, allowedMethods) ?? c.text("site 404", 404));
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} };
  const call = (path: string, init: RequestInit = {}) =>
    app.request(`https://aired.sh${path}`, { ...init, headers: { "CF-Connecting-IP": "203.0.113.9", ...(init.headers ?? {}) } }, env, ctx as never);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}, method = "POST") =>
    call(path, { method, body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });
  return { env, raw: d1.raw, d1, call, post };
}

/** The `error` object of a new-shape error body. */
export async function errorOf(res: Response): Promise<{ code: string; message: string } & Record<string, unknown>> {
  const body = (await res.json()) as { error: { code: string; message: string } & Record<string, unknown> };
  return body.error;
}
