import type { Context } from "hono";
import type { AppBindings } from "../types.js";

/**
 * Sandbox flags for served pages. `allow-same-origin` is deliberately absent:
 * the page runs in an opaque origin, so its scripts cannot call aired.sh's
 * API with the visitor's session (the cookie is SameSite=Lax and CORS only
 * allows https://aired.sh). Without this, any published page could read a
 * signed-in visitor's account or delete their pages.
 *
 * allow-forms keeps JS `submit` handlers firing (form-action 'none' still
 * blocks real submissions). allow-popups-to-escape-sandbox lets links that
 * open new tabs, like the report link, load normally.
 */
export const PAGE_SANDBOX = [
  "allow-scripts",
  "allow-forms",
  "allow-modals",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-downloads",
  "allow-pointer-lock",
  "allow-presentation",
  "allow-orientation-lock",
].join(" ");

/**
 * CSP header value for served pages.
 * Allows full JS execution while blocking form submissions and framing, and
 * sandboxes the page into its own origin.
 */
export const PAGE_CSP =
  `default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; form-action 'none'; frame-ancestors 'none'; sandbox ${PAGE_SANDBOX}`;

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
 *
 * Anonymous pages are never indexable: search engines are told not to index
 * them or follow their links. That removes the payoff for backlink spam, which
 * only works if the page ranks and passes link equity from aired.sh.
 */
export function applyPageHeaders(headers: Headers, opts: { indexable: boolean }): void {
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Content-Security-Policy", PAGE_CSP);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  if (!opts.indexable) {
    headers.set("X-Robots-Tag", "noindex, nofollow");
  }
}
