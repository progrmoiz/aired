/**
 * The site's own origin, for every absolute link the Worker writes: OAuth
 * redirect URIs, Stripe return URLs, claim and upgrade links, the badge,
 * OG tags, MCP replies and the CORS allow-list.
 *
 * Production leaves SITE_ORIGIN unset and gets https://aired.sh. Local dev
 * sets it in .dev.vars; a self-hosted deploy sets it to its own domain.
 * Never taken from the request, so a forged Host header can't redirect
 * anyone.
 *
 * No imports, so tests load it directly. Import it as "./origin.ts" (not
 * .js) from files the tests load, so node can resolve it.
 */

export const PRODUCTION_ORIGIN = "https://aired.sh";

export function siteOrigin(env: { SITE_ORIGIN?: string | undefined }): string {
  return (env.SITE_ORIGIN || PRODUCTION_ORIGIN).replace(/\/+$/, "");
}
