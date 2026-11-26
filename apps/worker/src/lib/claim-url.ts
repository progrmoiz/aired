/**
 * Claim links let someone who published anonymously attach the page to an
 * aired account later: `<origin>/claim#<id>.<update_token>`. The id and token
 * sit in the fragment, which browsers never send to the server, so the token
 * stays out of request logs.
 *
 * apps/web/claim.html repeats the same shape check in its inline script; keep
 * the two in step.
 */

import { siteOrigin } from "./origin.ts";

// Page ids are 10 chars from [0-9a-zA-Z] (@aired/core generateId); allow a
// little range so a future id length doesn't break old links.
const ID_RE = /^[0-9A-Za-z]{6,32}$/;
// Update tokens are "at_" + base64url of 32 bytes (@aired/core generateToken).
const TOKEN_RE = /^at_[A-Za-z0-9_-]{16,128}$/;

/** The claim link for a page. `origin` is siteOrigin(env); empty falls back to production. */
export function claimUrl(origin: string | undefined, id: string, token: string): string {
  return `${siteOrigin({ SITE_ORIGIN: origin })}/claim#${id}.${token}`;
}

/**
 * Read `#<id>.<token>` (with or without the leading `#`). Returns null for
 * anything that doesn't match the id and token shapes.
 */
export function parseClaimFragment(hash: string): { id: string; token: string } | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const dot = raw.indexOf(".");
  if (dot === -1) return null;
  const id = raw.slice(0, dot);
  const token = raw.slice(dot + 1);
  if (!ID_RE.test(id) || !TOKEN_RE.test(token)) return null;
  return { id, token };
}
