import type { Context } from "hono";
import type { AppBindings } from "../types.js";

/**
 * CSP header value for served pages.
 * Allows full JS execution while blocking form submissions and framing.
 */
export const PAGE_CSP =
  "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; form-action 'none'; frame-ancestors 'none'";

/**
 * Hono middleware: add security headers to all responses.
 * Used on viewer routes.
 */
export async function securityHeadersMiddleware(
  c: Context<AppBindings>,
  next: () => Promise<void>,
): Promise<void> {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("Referrer-Policy", "no-referrer");
}

/**
 * Apply CSP and security headers to an HTML response for a published page.
 */
export function applyPageHeaders(headers: Headers): void {
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Content-Security-Policy", PAGE_CSP);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
}
