import type { Context, Hono, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppBindings } from "../types.js";
import { apiErrorShape, withErrorCodes } from "./error-codes.ts";
import { requireCsrfHeader } from "./csrf.js";
import { apiError } from "../lib/errors.ts";
import { BODY_LIMIT_BYTES, PAGE_BODY_LIMIT_BYTES } from "../lib/input-limits.ts";

/** Paths whose bodies carry page HTML. */
const PAGE_BODY = /^\/(api\/publish|api\/pages\/[^/]+(?:\/data)?|mcp(\/account)?)$/;

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

const tooLarge = (max: number) => (c: Context) =>
  apiError(c, 413, "payload_too_large", `Request body too large: the limit is ${Math.floor(max / 1_000_000)} MB.`);
const pageBodyLimit = bodyLimit({ maxSize: PAGE_BODY_LIMIT_BYTES, onError: tooLarge(PAGE_BODY_LIMIT_BYTES) });
const smallBodyLimit = bodyLimit({ maxSize: BODY_LIMIT_BYTES, onError: tooLarge(BODY_LIMIT_BYTES) });

/**
 * The rules every API request follows, whatever route answers it, with the
 * caller's auth middleware in its place. index.ts passes authMiddleware; the
 * HTTP tests pass a stand-in.
 *
 * - Every JSON error under /api is `{ error: { code, message } }`, flat
 *   `{ error, code }` for older CLIs (lib/errors.ts); /auth's stay flat with
 *   a `code`. Both wrap auth, so its own errors (a revoked API key's 401)
 *   follow the same rule.
 * - Bodies are capped before any route reads them: page HTML (publish, PUT,
 *   MCP) gets room for the Pro size limit as JSON; every other /api, /auth
 *   and /oauth request, and every write anywhere else (the PIN form, the
 *   consent form, the data layer), 1 MB (lib/input-limits.ts). The plan's
 *   own size limit and the data layer's 16 KB still apply after.
 * - CSRF: a signed-in browser's state-changing request under /api or /auth
 *   must send X-Aired-Request: 1 (middleware/csrf.ts). Calls without the
 *   session cookie (CLI, agents, API keys, Stripe) are unaffected. Some
 *   routes also name it themselves; this covers every route, publish and
 *   report included.
 *
 * JSON 404s and 405s for unknown /api paths and methods are the app's
 * notFound handler (index.ts), apiNotFound below.
 */
export function applyApiContract(app: Hono<AppBindings>, auth: MiddlewareHandler<AppBindings>): void {
  app.use("/api/*", apiErrorShape);
  app.use("/auth/*", withErrorCodes);
  app.use("*", auth);
  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (PAGE_BODY.test(path)) return pageBodyLimit(c, next);
    if (path.startsWith("/api/") || path.startsWith("/auth/") || path.startsWith("/oauth/") || !READS.has(c.req.method)) {
      return smallBodyLimit(c, next);
    }
    await next();
  });
  app.use("/api/*", requireCsrfHeader);
  app.use("/auth/*", requireCsrfHeader);
}

/**
 * The JSON answer for an /api (or /oauth) path no route took: 405 with an
 * Allow header when some route takes the path with another method
 * (`allowedMethods`, routes/api-table.ts in index.ts), else 404. Null for any other path, which gets the
 * site's HTML 404.
 */
export function apiNotFound(c: Context, allowedMethods: (path: string) => string[] = () => []): Response | null {
  const path = new URL(c.req.url).pathname;
  if (path === "/api" || path.startsWith("/api/")) {
    const method = c.req.method;
    const allowed = allowedMethods(path);
    if (allowed.length > 0 && !allowed.includes(method === "HEAD" ? "GET" : method)) {
      c.header("Allow", allowed.join(", "));
      return apiError(c, 405, "method_not_allowed", `${method} isn't allowed on ${path}. Use ${allowed.join(" or ")}.`);
    }
    return apiError(c, 404, "not_found", `No API route matches ${method} ${path}.`);
  }
  if (path.startsWith("/oauth/")) return apiError(c, 404, "not_found", "Not found");
  return null;
}
