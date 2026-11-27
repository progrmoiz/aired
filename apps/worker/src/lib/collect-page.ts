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
import { mintViewerToken, newViewerCookie, validViewerCookie, viewerCookieHeader, viewerKey } from "./collect-token.ts";

export { VIEWER_COOKIE } from "./collect-token.ts";

export type DataLayerPage = { script: string; setCookie: string | null };

export async function dataLayerFor(opts: {
  secret: string;
  origin: string;
  id: string;
  ownerId: number | null;
  html: string;
  cookie: string | undefined;
  nowMs: number;
}): Promise<DataLayerPage | null> {
  if (!usesDataLayer(opts.html)) return null;
  if (opts.ownerId === null) return { script: collectRuntime({ enabled: false, reason: "sign_in_required" }), setCookie: null };
  const existing = validViewerCookie(opts.cookie);
  const cookie = existing ?? newViewerCookie();
  const viewer = await viewerKey(opts.secret, opts.id, cookie);
  const token = await mintViewerToken(opts.secret, opts.id, viewer, Math.floor(opts.nowMs / 1000) + VIEWER_TOKEN_SECONDS);
  return {
    script: collectRuntime({ enabled: true, origin: opts.origin, id: opts.id, token, viewer }),
    setCookie: existing === null ? viewerCookieHeader(cookie, VIEWER_COOKIE_SECONDS) : null,
  };
}
