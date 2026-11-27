import { Hono, type Context, type Next } from "hono";
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
import { analytics } from "./routes/analytics.ts";
import { admin } from "./routes/admin.ts";
import { authWorkos } from "./routes/auth-workos.js";
import { authDevice, devicePage } from "./routes/auth-device.js";
import { publishRateLimit } from "./middleware/rate-limit.js";
import { corsMiddleware } from "./middleware/cors.js";
import { authMiddleware } from "./middleware/auth.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { log, logError } from "./lib/log.js";
import { cachedHealth, checkHealth, publicReport, storageProbes } from "./lib/health.js";
import { countMcpToolCalls, isMcpToolCall } from "./lib/mcp-rpc.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { TIERS } from "./lib/rate-limit-tiers.js";
import { pageIdFromKey, sweepExpiredPages } from "./lib/expired-sweep.js";
import { withAssetCache } from "./lib/asset-cache.js";
import { preserveSweptFiles, runBackup } from "./lib/backup-bindings.ts";
import { livePageIds } from "./lib/pages-store.ts";
import { API_KEY_PREFIX, kvKeys } from "@aired/core";
import { loadUserRecord, signedInUser } from "./lib/user-record.js";
import { bearerToken } from "./lib/page-token.js";
import {
  MCP_SCOPE,
  mcpChallenge,
  mcpInsufficientScope,
  mcpOAuth,
  mcpResources,
  validateMcpToken,
  withMcpOAuthUser,
} from "./routes/mcp-oauth.js";
import type { Env } from "./types.js";

const app = new Hono<AppBindings>();

// Error handler. HTTPExceptions are deliberate answers; anything else is a
// bug, logged with the request id and path (not the query string, which can
// carry tokens) and answered with a generic 500.
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  logError("unhandled_error", err, { method: c.req.method, path: new URL(c.req.url).pathname }, c.get("requestId"));
  return c.json({ error: "Internal Server Error" }, 500);
});

// Global middleware: request id first (so every later log line has it),
// then CORS, then auth
app.use("*", requestIdMiddleware);
app.use("*", corsMiddleware);
app.use("*", authMiddleware);

// Health check: probes KV, D1 and R2 (lib/health.ts). 503 when any fails.
const health = cachedHealth();
app.get("/health", async (c) => {
  const { report: pending, fresh } = health(() => checkHealth(storageProbes(c.env)));
  const report = await pending;
  if (fresh && report.status !== "ok") {
    const failed = Object.fromEntries(
      Object.entries(report.checks).filter(([, r]) => !r.ok).map(([name, r]) => [name, r.error ?? "failed"]),
    );
    log("error", "health_check_failed", { failed }, c.get("requestId"));
  }
  c.header("Cache-Control", "no-store");
  return c.json(publicReport(report), report.status === "ok" ? 200 : 503);
});

// MCP Streamable HTTP endpoints (/mcp and /mcp/account).
// OAuth for the remote MCP: metadata, /oauth/* (token, registration) and
// the /authorize consent page.
app.route("/", mcpOAuth);

/**
 * Who is calling the MCP. An API key was already checked by authMiddleware.
 * Any other bearer token must be an OAuth token for this resource (else 401
 * with the sign-in challenge). /mcp/account also challenges callers with no
 * credentials, which is how connector clients start signing in; /mcp lets
 * them through as anonymous.
 */
function mcpCaller(which: "open" | "account") {
  return async (c: Context<AppBindings>, next: Next): Promise<Response | void> => {
    const resource = mcpResources(c.env)[which];
    const bearer = bearerToken(c.req.header("Authorization"));
    if (bearer !== null && !bearer.startsWith(API_KEY_PREFIX)) {
      let found: Awaited<ReturnType<typeof validateMcpToken>>;
      try {
        found = await validateMcpToken(c.env, resource, bearer);
      } catch (err) {
        logError("mcp_token_check_failed", err, {}, c.get("requestId"));
        return c.json({ error: "Could not check the access token. Please try again." }, 503);
      }
      if (found === null) return mcpChallenge(c, resource, "invalid_token");
      if (!found.scope.includes(MCP_SCOPE)) return mcpInsufficientScope(c, resource);
      const record = await loadUserRecord(c.env.PAGES_KV, found.userId);
      if (record === null) return mcpChallenge(c, resource, "invalid_token");
      // A grant can't outlive the account that approved it, even if revoking it on deletion failed.
      const created = Date.parse(record.createdAt ?? "");
      if (!isNaN(created) && (found.issuedAt === null || found.issuedAt * 1000 < created - 60_000)) {
        return mcpChallenge(c, resource, "invalid_token");
      }
      c.set("user", signedInUser(record));
      c.set("jti", null);
      c.set("via", "oauth");
    } else if (which === "account" && c.get("via") !== "key") {
      return mcpChallenge(c, resource);
    }
    await next();
  };
}

// Every JSON-RPC message is a POST, so only tool calls (publishes) are
// rate-limited; initialize, tools/list and notifications pass through.
async function mcpPostLimits(c: Context<AppBindings>, next: Next): Promise<Response | void> {
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
    // Signed-in callers (key or OAuth): a per-account limit on every tool
    // call (publishes also count against the publish limit inside the API).
    // Everyone else: the publish limit.
    const via = c.get("via");
    return via === "key" || via === "oauth" ? rateLimit(TIERS.mcp_key)(c, next) : publishRateLimit(c, next);
  }
  await next();
}

const mcpFetch = (c: Context<AppBindings>) => (req: Request, asUser?: number) =>
  app.fetch(req, asUser === undefined ? c.env : withMcpOAuthUser(c.env, asUser), c.executionCtx);

for (const [path, which] of [["/mcp", "open"], ["/mcp/account", "account"]] as const) {
  app.post(path, mcpCaller(which), mcpPostLimits, (c) => handleMcp(c, mcpFetch(c), path));
  app.on(["GET", "DELETE"], path, mcpCaller(which), (c) => handleMcp(c, mcpFetch(c), path));
  app.on("OPTIONS", path, (c) => handleMcp(c, mcpFetch(c), path));
}

// OG image route
app.route("/", og);

// Mount auth routes (WorkOS first: /auth/login and /auth/workos/callback;
// then aired's device sign-in: POST /auth/device and /auth/device/approve)
app.route("/auth", authWorkos);
app.route("/auth", authDevice);
app.route("/auth", auth);

// Operator endpoints, off unless ADMIN_TOKEN is set (routes/admin.ts)
app.route("/api/admin", admin);

// Mount billing routes before api so /api/billing/* matches first
app.route("/api/billing", billing);

// Mount key routes before me, and me before api, so the longer paths match first
app.route("/api/me/keys", keys);
app.route("/api/me/analytics", analytics);
app.route("/api/me", me);

// Mount API routes
app.route("/api", api);
app.route("/api", report);

// GET /upgrade — sign in if needed, then redirect to checkout
app.route("/", upgrade);

// Mount dashboard route (authenticated HTML shell)
app.route("/", dashboard);
// The CLI device sign-in page (served with no-framing headers)
app.get("/device", devicePage);

// Mount viewer routes
app.route("/", viewer);

// Static assets fallback — serve web/ files (index.html, style.css, app.js)
// Cloudflare ASSETS binding handles routing to the correct file.
app.notFound(async (c) => {
  // The API answers in JSON, including for paths it doesn't have.
  const path = new URL(c.req.url).pathname;
  if (path === "/api" || path.startsWith("/api/") || path.startsWith("/oauth/")) {
    return c.json({ error: "Not found" }, 404);
  }
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
      livePages: (ids) => livePageIds(env.DB, ids, Date.now()),
      // Copied to the backup bucket first (trash/, 14 days): a KV record lost
      // by mistake must not take the only copy of a page with it.
      preserve: (files) => preserveSweptFiles(env, files),
      deleteKeys: async (keys) => {
        await env.PAGES_BUCKET.delete(keys);
        // The page is gone: its tile placeholder in D1 goes with its HTML.
        const ids = keys.filter((k) => k.endsWith("/index.html")).map((k) => pageIdFromKey(k)!);
        if (ids.length > 0) {
          await env.DB.batch(ids.map((id) => env.DB.prepare("DELETE FROM page_shots WHERE id = ?").bind(id)));
        }
      },
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
          log("info", "expired_sweep_pass_done", { hours: Math.round((now - started) / 3_600_000) });
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
      log: ({ event, ...fields }) => log("warn", String(event), fields),
    },
    Date.now(),
  );
  log("info", "expired_sweep", { scanned: result.scanned, marked: result.marked, deleted: result.deleted.length });
}

/**
 * Every cron run does each job in turn: the expired-page sweep, then the
 * nightly backup's next few chunks (lib/backup.ts; it does nothing until a
 * snapshot is due). One job failing doesn't stop the other. A throw is logged
 * as scheduled_failed (an alert event, lib/log.ts) with the cron expression
 * and job, then rethrown so Cloudflare still records the run as failed.
 */
async function runScheduled(cron: string, env: Env): Promise<void> {
  const jobs: Array<[string, (env: Env) => Promise<void>]> = [
    ["expired_sweep", runExpiredSweep],
    ["backup", runBackup],
  ];
  let failure: unknown = null;
  for (const [job, run] of jobs) {
    try {
      await run(env);
    } catch (err) {
      logError("scheduled_failed", err, { cron, job });
      failure ??= err;
    }
  }
  if (failure !== null) throw failure;
}

export default {
  fetch: app.fetch,
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(controller.cron, env));
  },
};
