/**
 * The secrets behind "only these people": the 6-digit code, the keys its
 * row is stored under, and the page's access cookie. Web Crypto only, no
 * imports, so tests load it directly.
 *
 * Every MAC here is HMAC-SHA256 with SESSION_SECRET and a purpose label, so
 * none of them can stand in for another or for anything else signed with
 * the secret.
 *
 * The cookie `acc_<page id>` holds `<expiry seconds>.<email, base64url>.<MAC>`
 * over the page id, the email and the expiry. It's HttpOnly and scoped to
 * /p/<id>, and the MAC names the page, so it opens that page only. The
 * email is in it so each visit can be checked against the list as it is
 * now: take someone off the list and their cookie stops working.
 */

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

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function mac(secret: string, label: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(label)));
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** A uniformly random 6-digit code, leading zeros kept ("004211"). */
export function newCode(): string {
  // 2^32 isn't a multiple of 1,000,000: draw again above the last whole block, so every code is equally likely.
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return String(buf[0]! % 1_000_000).padStart(6, "0");
  }
}

/** A typed code as we check it: digits only, so "123 456" and "123-456" work. Null if it can't be one. */
export function cleanCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 20) return null;
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** The key an email's code row and rate limits are stored under: the address itself never is. */
export async function emailKey(secret: string, email: string): Promise<string> {
  return hex(await mac(secret, `aired-access-email:v1:${email}`)).slice(0, 32);
}

/** What access_codes.code_hash holds for a code: tied to the page and email, so it's no use anywhere else. */
export async function codeHash(secret: string, pageId: string, key: string, code: string): Promise<string> {
  return hex(await mac(secret, `aired-access-code:v1:${pageId}:${key}:${code}`));
}

async function cookieMac(secret: string, pageId: string, email: string, expSec: number): Promise<Uint8Array> {
  return mac(secret, `aired-access-cookie:v1:${pageId}:${expSec}:${email}`);
}

/** The cookie's name for a page. */
export const accessCookieName = (pageId: string) => `acc_${pageId}`;

/** The `acc_<id>` cookie value for an email that just entered a right code. */
export async function accessCookieValue(secret: string, pageId: string, email: string, expSec: number): Promise<string> {
  return `${expSec}.${b64url(enc.encode(email))}.${b64url(await cookieMac(secret, pageId, email, expSec))}`;
}

/** The email an `acc_<id>` cookie was given to, if it's valid and unexpired for this page; else null. */
export async function verifyAccessCookie(
  secret: string,
  pageId: string,
  cookie: string | null | undefined,
  nowSec: number,
): Promise<string | null> {
  if (!cookie || cookie.length > 1024) return null;
  const parts = cookie.split(".");
  if (parts.length !== 3) return null;
  const [expPart, emailPart, macPart] = parts as [string, string, string];
  if (!/^\d{1,12}$/.test(expPart)) return null;
  const expSec = Number(expPart);
  if (expSec <= nowSec) return null;
  const emailBytes = fromB64url(emailPart);
  const given = fromB64url(macPart);
  if (emailBytes === null || given === null) return null;
  let email: string;
  try {
    email = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(emailBytes);
  } catch {
    return null;
  }
  return sameBytes(given, await cookieMac(secret, pageId, email, expSec)) ? email : null;
}
