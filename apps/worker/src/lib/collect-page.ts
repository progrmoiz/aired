/**
 * What GET /p/:id adds for a page that uses the data layer
 * (lib/collect-runtime.ts usesDataLayer): the window.aired script, with a
 * token for this viewer on this page, and the viewer cookie when the
 * browser has none yet. Pages without an owner get the script with saving
 * turned off, so their calls fail with sign_in_required instead of
 * throwing. Every other page gets nothing.
 */

import { VIEWER_COOKIE_SECONDS, VIEWER_TOKEN_SECONDS } from "./collect-limits.ts";
import { collectRuntime, usesDataLayer } from "./collect-runtime.ts";
import { mintViewerToken, newViewerCookie, pageGate, usableSecret, validViewerCookie, viewerCookieHeader, viewerKey } from "./collect-token.ts";

export { VIEWER_COOKIE } from "./collect-token.ts";

export type DataLayerPage = { script: string; setCookie: string | null };

export async function dataLayerFor(opts: {
  secret: string;
  origin: string;
  id: string;
  ownerId: number | null;
  /** The PIN as stored (a hash), or null: the token stops working when it changes. */
  pin: string | null;
  html: string;
  cookie: string | undefined;
  nowMs: number;
}): Promise<DataLayerPage | null> {
  if (!usesDataLayer(opts.html)) return null;
  // No owner (nobody could read the data), or no secret to sign with: saving stays off.
  if (opts.ownerId === null || !usableSecret(opts.secret)) return { script: collectRuntime({ enabled: false, reason: "sign_in_required" }), setCookie: null };
  const existing = validViewerCookie(opts.cookie);
  const cookie = existing ?? newViewerCookie();
  const viewer = await viewerKey(opts.secret, opts.id, cookie);
  const gate = await pageGate(opts.secret, opts.id, opts.pin);
  const token = await mintViewerToken(opts.secret, opts.id, viewer, Math.floor(opts.nowMs / 1000) + VIEWER_TOKEN_SECONDS, gate);
  return {
    script: collectRuntime({ enabled: true, origin: opts.origin, id: opts.id, token, viewer }),
    setCookie: existing === null ? viewerCookieHeader(cookie, VIEWER_COOKIE_SECONDS) : null,
  };
}
