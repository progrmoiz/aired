import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppBindings } from "../types.js";
import { withErrorCodes } from "./error-codes.ts";
import { requireCsrfHeader } from "./csrf.js";
import { apiError } from "../lib/errors.ts";
import { BODY_LIMIT_BYTES, PAGE_BODY_LIMIT_BYTES } from "../lib/input-limits.ts";

/** Paths whose bodies carry page HTML. */
const PAGE_BODY = /^\/(api\/publish|api\/pages\/[^/]+|mcp(\/account)?)$/;

const tooLarge = (max: number) => (c: Context) =>
  apiError(c, 413, "payload_too_large", `Request body too large: the limit is ${Math.floor(max / 1_000_000)} MB.`);
const pageBodyLimit = bodyLimit({ maxSize: PAGE_BODY_LIMIT_BYTES, onError: tooLarge(PAGE_BODY_LIMIT_BYTES) });
const smallBodyLimit = bodyLimit({ maxSize: BODY_LIMIT_BYTES, onError: tooLarge(BODY_LIMIT_BYTES) });

/**
 * The rules every API request follows, whatever route answers it. index.ts
 * applies them after auth; the HTTP tests apply the same function.
 *
 * - Every JSON error under /api and /auth carries a `code` (lib/errors.ts).
 * - Bodies are capped before any route reads them: page HTML (publish, PUT,
 *   MCP) gets room for the Pro size limit as JSON, everything else 1 MB
 *   (lib/input-limits.ts). The plan's own size limit still applies after.
 * - CSRF: a signed-in browser's state-changing request under /api or /auth
 *   must send X-Aired-Request: 1 (middleware/csrf.ts). Calls without the
 *   session cookie (CLI, agents, API keys, Stripe) are unaffected. Some
 *   routes also name it themselves; this covers every route, publish and
 *   report included.
 *
 * JSON 404s for unknown /api paths are the app's notFound handler (index.ts).
 */
export function applyApiContract(app: Hono<AppBindings>): void {
  app.use("/api/*", withErrorCodes);
  app.use("/auth/*", withErrorCodes);
  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (PAGE_BODY.test(path)) return pageBodyLimit(c, next);
    if (path.startsWith("/api/") || path.startsWith("/auth/") || path.startsWith("/oauth/")) return smallBodyLimit(c, next);
    await next();
  });
  app.use("/api/*", requireCsrfHeader);
  app.use("/auth/*", requireCsrfHeader);
}

/** The JSON 404 for an unknown /api or /oauth path; null for any other path. */
export function apiNotFound(c: Context): Response | null {
  const path = new URL(c.req.url).pathname;
  if (path === "/api" || path.startsWith("/api/") || path.startsWith("/oauth/")) {
    return apiError(c, 404, "not_found", "Not found");
  }
  return null;
}
