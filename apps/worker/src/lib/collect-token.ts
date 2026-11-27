/**
 * Who a viewer is, for the data layer, without giving the page anything it
 * could use on another page or as another viewer.
 *
 * Published pages run in an opaque origin (middleware/security.ts): their
 * scripts can't read aired.sh cookies, and their requests to aired.sh carry
 * none. So identity is carried two ways:
 *
 * 1. The viewer cookie (`aired_v`): 128 random bits, HttpOnly, SameSite=Lax,
 *    Path=/p/. Only the top-level GET /p/:id sends it, so only the server
 *    sees it, and it keeps the same browser the same viewer across visits.
 * 2. The viewer token: minted on that GET and put in the page, signed with a
 *    key derived from SESSION_SECRET. It names one page and one viewer key
 *    and expires (VIEWER_TOKEN_SECONDS). The page's calls to /c/:id/* send
 *    it in the body; the route checks the signature, the expiry and that the
 *    page in the token is the page in the URL.
 *
 * The token also carries the page's "gate": an HMAC of its PIN as stored
 * (or of nothing, without a PIN). Adding, changing or removing the PIN
 * changes the gate, so tokens minted before stop working at once instead
 * of lasting their 7 days (the route compares it with the page as it is).
 *
 * The viewer key is HMAC(secret, page id + cookie), cut to 22 characters: a
 * person has a different key on every page (owners can't match viewers
 * across pages), and the key can't be turned back into the cookie. A page
 * can't forge a token for another viewer or another page without the secret.
 *
 * No runtime imports, so tests load it directly.
 */

export const VIEWER_COOKIE = "aired_v";
const COOKIE_VALUE = /^[A-Za-z0-9_-]{22}$/;
export const VIEWER_KEY = /^[A-Za-z0-9_-]{22}$/;
const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

/** A secret too short to sign with: the data layer stays off rather than sign with it. */
export function usableSecret(secret: string | undefined | null): secret is string {
  return typeof secret === "string" && secret.length >= 16;
}

async function mac(secret: string, purpose: string, message: string): Promise<Uint8Array> {
  if (!usableSecret(secret)) throw new Error("SESSION_SECRET is missing or too short");
  // A purpose string keeps these MACs apart from every other use of the secret.
  const key = await crypto.subtle.importKey("raw", enc.encode(`aired-collect:${purpose}:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** A new viewer cookie value: 16 random bytes. */
export function newViewerCookie(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

/** The cookie value if it's one we could have set, else null (a new one is set then). */
export function validViewerCookie(value: string | undefined | null): string | null {
  return typeof value === "string" && COOKIE_VALUE.test(value) ? value : null;
}

/** The Set-Cookie header for a new viewer. Path=/p/ so the API never sees it. */
export function viewerCookieHeader(value: string, maxAgeSeconds: number): string {
  return `${VIEWER_COOKIE}=${value}; Path=/p/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

/** This viewer's key on this page. */
export async function viewerKey(secret: string, pageId: string, cookie: string): Promise<string> {
  return b64url((await mac(secret, "viewer", `${pageId}\n${cookie}`)).subarray(0, 16)).slice(0, 22);
}

/** The page's gate: 11 characters that change whenever its stored PIN does. */
export async function pageGate(secret: string, pageId: string, pin: string | null): Promise<string> {
  return b64url((await mac(secret, "gate", `${pageId}\n${pin ?? ""}`)).subarray(0, 8));
}

/** A token for one page, one viewer key and the page's gate, good until expSec. Format: v1.<page>.<viewer>.<exp>.<gate>.<sig>. */
export async function mintViewerToken(secret: string, pageId: string, viewer: string, expSec: number, gate: string): Promise<string> {
  const body = `v1.${pageId}.${viewer}.${expSec}.${gate}`;
  return `${body}.${b64url(await mac(secret, "token", body))}`;
}

export type TokenCheck =
  | { ok: true; viewer: string; gate: string }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "wrong_page" };

/**
 * Check a token sent to /c/:pageId/*. The page in the token must be the page
 * in the URL: a token from one page is refused on every other.
 */
export async function verifyViewerToken(secret: string, pageId: string, token: unknown, nowSec: number): Promise<TokenCheck> {
  if (typeof token !== "string" || token.length > 300) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 6 || parts[0] !== "v1") return { ok: false, reason: "malformed" };
  const [, tokenPage, viewer, exp, gate, sig] = parts as [string, string, string, string, string, string];
  if (!PAGE_ID.test(tokenPage) || !VIEWER_KEY.test(viewer) || !/^\d{1,12}$/.test(exp) || !/^[A-Za-z0-9_-]{11}$/.test(gate)) return { ok: false, reason: "malformed" };
  const given = fromB64url(sig);
  if (given === null) return { ok: false, reason: "malformed" };
  const want = await mac(secret, "token", `v1.${tokenPage}.${viewer}.${exp}.${gate}`);
  if (!sameBytes(given, want)) return { ok: false, reason: "bad_signature" };
  // Signature first, so a forged token learns nothing from the other checks.
  if (tokenPage !== pageId) return { ok: false, reason: "wrong_page" };
  if (Number(exp) <= nowSec) return { ok: false, reason: "expired" };
  return { ok: true, viewer, gate };
}
