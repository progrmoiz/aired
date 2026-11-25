import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppBindings } from "./types.js";
import { api } from "./routes/api.js";
import { me } from "./routes/me.js";
import { viewer } from "./routes/viewer.js";
import { report } from "./routes/report.js";
import { handleMcp } from "./routes/mcp.js";
import { og } from "./routes/og.js";
import { auth } from "./routes/auth.js";
import { dashboard } from "./routes/dashboard.js";
import { billing, upgrade } from "./routes/billing.js";
import { keys } from "./routes/keys.js";
import { publishRateLimit } from "./middleware/rate-limit.js";
import { corsMiddleware } from "./middleware/cors.js";
import { authMiddleware } from "./middleware/auth.js";
import { countMcpToolCalls, isMcpToolCall } from "./lib/mcp-rpc.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { TIERS } from "./lib/rate-limit-tiers.js";
import { sweepExpiredPages } from "./lib/expired-sweep.js";
import { withAssetCache } from "./lib/asset-cache.js";
import { kvKeys } from "@aired/core";
import type { Env } from "./types.js";

const app = new Hono<AppBindings>();

// Error handler
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error({
    event: "unhandled_error",
    timestamp: new Date().toISOString(),
    method: c.req.method,
    url: c.req.url,
    error: err.message,
    stack: err.stack,
  });
  return c.json({ error: "Internal Server Error" }, 500);
});

// Global middleware: CORS first, then auth
app.use("*", corsMiddleware);
app.use("*", authMiddleware);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// MCP Streamable HTTP endpoint
// Every JSON-RPC message is a POST, so only tool calls (publishes) are
// rate-limited; initialize, tools/list and notifications pass through.
app.post(
  "/mcp",
  async (c, next) => {
    let body: unknown = null;
    try {
      body = await c.req.raw.clone().json();
    } catch {
      // Malformed body: let the MCP handler return the JSON-RPC error.
    }
    // One tool call per request: limits count requests, not calls in a batch.
    if (countMcpToolCalls(body) > 1) {
      return c.json(
        { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Send one tool call per request." } },
        400,
      );
    }
    if (isMcpToolCall(body)) {
      // Key callers: a per-account limit on every tool call (publishes also
      // count against the publish limit inside the API). Everyone else: the
      // publish limit.
      return c.get("authMethod") === "key" ? rateLimit(TIERS.mcp_key)(c, next) : publishRateLimit(c, next);
    }
    await next();
  },
  (c) => handleMcp(c, (req) => app.fetch(req, c.env, c.executionCtx)),
);
app.on(["GET", "DELETE", "OPTIONS"], "/mcp", (c) => handleMcp(c, (req) => app.fetch(req, c.env, c.executionCtx)));

// OG image route
app.route("/", og);

// Mount auth routes
app.route("/auth", auth);

// Mount billing routes before api so /api/billing/* matches first
app.route("/api/billing", billing);

// Mount key routes before me, and me before api, so the longer paths match first
app.route("/api/me/keys", keys);
app.route("/api/me", me);

// Mount API routes
app.route("/api", api);
app.route("/api", report);

// GET /upgrade — sign in if needed, then redirect to checkout
app.route("/", upgrade);

// Mount dashboard route (authenticated HTML shell)
app.route("/", dashboard);

// Mount viewer routes
app.route("/", viewer);

// Static assets fallback — serve web/ files (index.html, style.css, app.js)
// Cloudflare ASSETS binding handles routing to the correct file.
app.notFound(async (c) => {
  if (c.env.ASSETS) {
    return withAssetCache(await c.env.ASSETS.fetch(c.req.raw), new URL(c.req.url).pathname);
  }
  return c.json({ error: "Not found" }, 404);
});

/**
 * Cron Trigger (wrangler.toml [triggers]): delete the R2 files of expired
 * pages, a batch per run (lib/expired-sweep.ts). The cursor and candidates
 * live in D1, not KV, to stay clear of KV's daily write limit.
 */
async function runExpiredSweep(env: Env): Promise<void> {
  const name = "expired_pages";
  const result = await sweepExpiredPages(
    {
      list: async (cursor, limit) => {
        const res = await env.PAGES_BUCKET.list({ prefix: "pages/", limit, ...(cursor ? { cursor } : {}) });
        return {
          objects: res.objects.map((o) => ({ key: o.key, uploaded: o.uploaded, etag: o.etag })),
          truncated: res.truncated,
          cursor: res.truncated ? res.cursor : null,
        };
      },
      pageExists: async (id) => (await env.PAGES_KV.get(kvKeys.page(id))) !== null,
      deleteKeys: (keys) => env.PAGES_BUCKET.delete(keys),
      loadCursor: async () =>
        (await env.DB.prepare("SELECT cursor FROM sweep_state WHERE name = ?").bind(name).first<{ cursor: string | null }>())?.cursor ?? null,
      saveCursor: async (cursor, passDone) => {
        const now = Date.now();
        const prev = await env.DB
          .prepare("SELECT pass_started_at FROM sweep_state WHERE name = ?")
          .bind(name)
          .first<{ pass_started_at: number | null }>();
        const started = prev?.pass_started_at ?? now;
        if (passDone) {
          console.log({ event: "expired_sweep_pass_done", hours: Math.round((now - started) / 3_600_000) });
        }
        await env.DB
          .prepare(
            "INSERT INTO sweep_state (name, cursor, updated_at, pass_started_at) VALUES (?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at, pass_started_at = excluded.pass_started_at",
          )
          .bind(name, cursor, now, passDone ? now : started)
          .run();
      },
      loadCandidates: async (keys) => {
        const found = new Map<string, { etag: string; firstSeen: number }>();
        if (keys.length === 0) return found;
        const { results } = await env.DB
          .prepare(`SELECT key, etag, first_seen FROM sweep_candidates WHERE key IN (${keys.map(() => "?").join(", ")})`)
          .bind(...keys)
          .all<{ key: string; etag: string; first_seen: number }>();
        for (const r of results) found.set(r.key, { etag: r.etag, firstSeen: r.first_seen });
        return found;
      },
      saveCandidates: async (put, drop) => {
        const stmts = [
          ...[...put].map(([key, c]) =>
            env.DB
              .prepare("INSERT INTO sweep_candidates (key, etag, first_seen) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET etag = excluded.etag, first_seen = excluded.first_seen")
              .bind(key, c.etag, c.firstSeen),
          ),
          ...drop.map((key) => env.DB.prepare("DELETE FROM sweep_candidates WHERE key = ?").bind(key)),
        ];
        if (stmts.length > 0) await env.DB.batch(stmts);
      },
      log: (entry) => console.warn(entry),
    },
    Date.now(),
  );
  console.log({ event: "expired_sweep", scanned: result.scanned, marked: result.marked, deleted: result.deleted.length });
}

export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runExpiredSweep(env));
  },
};
