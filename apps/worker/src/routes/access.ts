import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import type { AppBindings } from "../types.js";
import { hashToHex, parseMetadata } from "@aired/core";
import { siteOrigin } from "../lib/origin.ts";
import { apiError } from "../lib/errors.ts";
import { rateLimit } from "../middleware/rate-limit.js";
import { TIERS } from "../lib/rate-limit-tiers.js";
import { underBurstLimit } from "../lib/burst-limit.js";
import { visitorNetwork } from "../lib/pin-guess.js";
import { takeDurableSlot } from "../lib/durable-limit.ts";
import { getEntitlements } from "../lib/entitlements.js";
import { isEmail, normalizeEmail, onList, fromEntries } from "../lib/access-list.ts";
import { ACCESS_COOKIE_SECONDS, ACCESS_RATE_LIMITS, CODE_MAX_ATTEMPTS, CODE_TTL_MS } from "../lib/access-limits.ts";
import { accessCookieName, accessCookieValue, cleanCode, codeHash, emailKey, newCode, verifyAccessCookie } from "../lib/access-code.ts";
import { durableUsed, getAccessEntries, listVisitors, putCode, recordVisit, useCode } from "../lib/access-store.ts";
import { accessCodeEmail, emailSenderFor } from "../lib/email-sender.ts";
import { accessGatePage, gateHeaders, newNonce } from "../lib/access-page.ts";
import { pageFor } from "../lib/pages-service.ts";

/**
 * "Only these people": a page its owner shared with named emails and
 * domains (lib/access-list.ts). The gate is in the viewer (accessGate,
 * below); these routes are its two steps and the owner's view.
 *
 *   POST /p/:id/access/send    { email }        a code by email, if listed
 *   POST /p/:id/access/verify  { email, code }  the acc_<id> cookie
 *   GET  /api/pages/:id/access                  list and visitors, owner only
 *
 * Nothing here says whether an email is on the list. /send answers the
 * same "if you have access, we've sent a code" for every email and every
 * page id, and does the lookup and the sending after answering, so the
 * time it takes doesn't tell either. Its rate limits are counted before the
 * list is read. /verify gives one answer for a wrong code, an expired one,
 * an unlisted email and a page that isn't restricted.
 *
 * Both steps take JSON only. A cross-site form can't send that without a
 * CORS preflight, which only aired.sh passes.
 */

const access = new Hono<AppBindings>();

const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const SENT_MESSAGE = "If this email has access, we've sent a code. Check your inbox.";
export const BAD_CODE_MESSAGE = "That code isn't right or has expired. Check the email, or send a new code.";
const SLOW_DOWN = "Too many tries. Wait a few minutes and try again.";
const PAGE_LOCKED = "Too many wrong codes have been tried on this page today. Try again tomorrow, or ask the person who shared it.";

async function jsonBody(c: Context<AppBindings>): Promise<Record<string, unknown> | Response> {
  if (!(c.req.header("Content-Type") ?? "").toLowerCase().startsWith("application/json")) {
    return apiError(c, 415, "unsupported_media_type", "Send JSON");
  }
  try {
    const text = await c.req.text();
    if (text.length > 2048) return apiError(c, 413, "payload_too_large", "Request body too large");
    const body: unknown = JSON.parse(text);
    if (typeof body !== "object" || body === null || Array.isArray(body)) return apiError(c, 400, "invalid_input", "Send a JSON object");
    return body as Record<string, unknown>;
  } catch {
    return apiError(c, 400, "invalid_input", "Send a JSON object");
  }
}

/** The visitor's address, hashed (IPv6 by /64): only ever a rate-limit key. */
async function networkKey(c: Context<AppBindings>): Promise<string> {
  return hashToHex(visitorNetwork(c.req.header("CF-Connecting-IP") ?? "unknown"), 16);
}

/** Count one request against each bucket. False when any is used up. Throws on a D1 error. */
async function underLimits(db: D1Database, buckets: Array<[string, { limit: number; windowSeconds: number }]>, now: number): Promise<boolean> {
  for (const [bucket, limit] of buckets) {
    if (!(await takeDurableSlot(db, bucket, limit, now))) return false;
  }
  return true;
}

async function restrictedPage(kv: KVNamespace, id: string): Promise<{ ownerId: number } | null> {
  const raw = await kv.get(`page:${id}`);
  const meta = raw === null ? null : parseMetadata(raw);
  if (meta === null || meta.access !== "people" || meta.ownerId === null) return null;
  if (meta.expiresAt !== null && Date.parse(meta.expiresAt) <= Date.now()) return null;
  return { ownerId: meta.ownerId };
}

// POST /p/:id/access/send — email a code to a listed person.
access.post("/p/:id/access/send", async (c) => {
  const id = c.req.param("id");
  if (!PAGE_ID.test(id)) return apiError(c, 404, "not_found", "Page not found");
  const body = await jsonBody(c);
  if (body instanceof Response) return body;
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  if (!isEmail(email)) return apiError(c, 400, "invalid_input", "Enter a valid email address.", { field: "email" });
  if (!c.env.SESSION_SECRET) return apiError(c, 503, "unavailable", "Codes can't be sent right now. Try again later.");

  const now = Date.now();
  const key = await emailKey(c.env.SESSION_SECRET, email);
  const net = await networkKey(c);
  const L = ACCESS_RATE_LIMITS;
  try {
    const ok = await underLimits(c.env.DB, [
      [`acc:pe:${id}:${key}`, L.pageEmail],
      [`acc:ip:${net}`, L.ip],
      [`acc:p:${id}`, L.page],
    ], now);
    if (!ok) return apiError(c, 429, "rate_limited", SLOW_DOWN);
  } catch (err) {
    console.error("access send limit check failed", { id, err });
    return apiError(c, 503, "unavailable", "Codes can't be sent right now. Try again in a minute.");
  }

  // Everything that depends on the list happens after the answer.
  c.executionCtx.waitUntil(
    sendCodeIfListed(c, id, email, key, now).catch((err) => console.error({ event: "access_code_send_failed", id, error: String(err) })),
  );
  return c.json({ ok: true, message: SENT_MESSAGE });
});

async function sendCodeIfListed(c: Context<AppBindings>, id: string, email: string, key: string, now: number): Promise<void> {
  const page = await restrictedPage(c.env.PAGES_KV, id);
  if (page === null) return;
  const entries = await getAccessEntries(c.env.DB, id);
  if (!onList(email, entries)) return;
  const sender = emailSenderFor(c.env);
  if (sender === null) {
    console.error({ event: "access_email_not_configured", id });
    return;
  }
  // Counted only when a code is about to go out (lib/access-limits.ts).
  if (!(await takeDurableSlot(c.env.DB, `acc:e:${key}`, ACCESS_RATE_LIMITS.email, now))) {
    console.warn({ event: "access_email_send_cap", id });
    return;
  }
  if (!entries.includes(email) && !(await takeDurableSlot(c.env.DB, `acc:dom:${id}`, ACCESS_RATE_LIMITS.domainCodes, now))) {
    console.warn({ event: "access_domain_send_cap", id });
    return;
  }
  // The owner's daily cap: counted only for codes actually sent.
  const ent = await getEntitlements(c.env, page.ownerId);
  if (!(await takeDurableSlot(c.env.DB, `acc:o:${page.ownerId}`, { limit: ent.access.sendsPerDay, windowSeconds: 86_400 }, now))) {
    console.warn({ event: "access_owner_send_cap", id, owner: page.ownerId });
    return;
  }
  const code = newCode();
  await putCode(c.env.DB, id, key, await codeHash(c.env.SESSION_SECRET, id, key, code), now + CODE_TTL_MS, now);
  await sender.send(accessCodeEmail({ to: email, code, pageUrl: `${siteOrigin(c.env)}/p/${id}`, minutes: Math.round(CODE_TTL_MS / 60_000) }));
  console.log({ event: "access_code_sent", id, via: sender.kind });
}

// POST /p/:id/access/verify — a right code gets the page's cookie.
access.post("/p/:id/access/verify", async (c) => {
  const id = c.req.param("id");
  if (!PAGE_ID.test(id)) return apiError(c, 404, "not_found", "Page not found");
  const body = await jsonBody(c);
  if (body instanceof Response) return body;
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const code = cleanCode(body.code);
  if (!isEmail(email) || code === null) return apiError(c, 400, "invalid_code", BAD_CODE_MESSAGE);
  if (!c.env.SESSION_SECRET) return apiError(c, 503, "unavailable", "Codes can't be checked right now. Try again later.");

  const now = Date.now();
  const net = await networkKey(c);
  if (!(await underBurstLimit(c.env.PIN_GUESS, `acc:${id}:${net}`))) return apiError(c, 429, "rate_limited", SLOW_DOWN);
  const failures = `acc:vf:${id}`;
  try {
    if (!(await underLimits(c.env.DB, [[`acc:vi:${id}:${net}`, ACCESS_RATE_LIMITS.verifyIp]], now))) {
      return apiError(c, 429, "rate_limited", SLOW_DOWN);
    }
    // The page's budget of wrong guesses (lib/access-limits.ts verifyFailures).
    if ((await durableUsed(c.env.DB, failures, now)) >= ACCESS_RATE_LIMITS.verifyFailures.limit) {
      return apiError(c, 429, "rate_limited", PAGE_LOCKED);
    }
  } catch (err) {
    console.error("access verify limit check failed", { id, err });
    return apiError(c, 503, "unavailable", "Codes can't be checked right now. Try again in a minute.");
  }

  let allowed = false;
  try {
    const key = await emailKey(c.env.SESSION_SECRET, email);
    const page = await restrictedPage(c.env.PAGES_KV, id);
    const result = page === null ? "none" : await useCode(c.env.DB, id, key, await codeHash(c.env.SESSION_SECRET, id, key, code), now, CODE_MAX_ATTEMPTS);
    if (result === "ok") {
      // Still on the list: the owner may have taken them off since the code went out.
      allowed = onList(email, await getAccessEntries(c.env.DB, id));
    } else if (result === "wrong") {
      // A guess at a code that exists: it counts against the page, after the answer.
      c.executionCtx.waitUntil(
        takeDurableSlot(c.env.DB, failures, ACCESS_RATE_LIMITS.verifyFailures, now).catch((err) => console.error("access failure count failed", { id, err })),
      );
    }
  } catch (err) {
    console.error("access verify failed", { id, err });
    return apiError(c, 503, "unavailable", "Codes can't be checked right now. Try again in a minute.");
  }
  if (!allowed) return apiError(c, 400, "invalid_code", BAD_CODE_MESSAGE);

  const expSec = Math.floor(now / 1000) + ACCESS_COOKIE_SECONDS;
  const value = await accessCookieValue(c.env.SESSION_SECRET, id, email, expSec);
  // Lax, not Strict: the link is usually opened from an email or chat app,
  // and a Strict cookie isn't sent on that first navigation.
  c.header("Set-Cookie", `${accessCookieName(id)}=${value}; Path=/p/${id}; HttpOnly; Secure; SameSite=Lax; Max-Age=${ACCESS_COOKIE_SECONDS}`);
  c.header("Cache-Control", "no-store");
  return c.json({ ok: true });
});

/**
 * The viewer's check for an "only these people" page. The signed-in owner
 * always gets in (and isn't logged). Anyone else needs an `acc_<id>` cookie
 * for an email that is on the list as it is now. Returns the visitor's
 * email (null for the owner), or the response to send instead: the gate,
 * or a 503 when the list can't be read (fail closed).
 */
export async function accessGate(
  c: Context<AppBindings>,
  id: string,
  ownerId: number | null,
): Promise<{ email: string | null; entries: string[] } | Response> {
  const nonce = newNonce();
  const gate = () => new Response(accessGatePage({ id, nonce }), { status: 200, headers: gateHeaders(nonce) });
  const user = c.get("user");
  const isOwner = user !== null && user !== undefined && ownerId !== null && user.id === ownerId;
  if (!isOwner && (ownerId === null || !c.env.SESSION_SECRET)) return gate();
  const email = isOwner ? null : await verifyAccessCookie(c.env.SESSION_SECRET, id, getCookie(c, accessCookieName(id)), Math.floor(Date.now() / 1000));
  if (!isOwner && email === null) return gate();
  // The list, as it is now: who may come in, and what the page's data-layer tokens are tied to.
  let entries: string[];
  try {
    entries = await getAccessEntries(c.env.DB, id);
  } catch (err) {
    console.error("access list lookup failed", { id, err });
    return new Response("This page can't be opened right now. Try again in a minute.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "30" },
    });
  }
  if (email !== null && !onList(email, entries)) {
    const res = gate();
    // The cookie is no good any more: take it away.
    res.headers.append("Set-Cookie", `${accessCookieName(id)}=; Path=/p/${id}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    return res;
  }
  return { email, entries };
}

/** Log a listed person's visit for the owner, in the background. */
export function logVisit(c: Context<AppBindings>, id: string, ownerId: number, email: string): void {
  c.executionCtx.waitUntil(
    recordVisit(c.env.DB, id, ownerId, email, Date.now()).catch((err) => console.error("access visit log failed", { id, err })),
  );
}

// GET /api/pages/:id/access — the list and who opened the page. The
// signed-in owner only: an update token isn't enough, since this is other
// people's email addresses.
access.get("/api/pages/:id/access", rateLimit(TIERS.page_options), async (c) => {
  const id = c.req.param("id") ?? "";
  if (!PAGE_ID.test(id)) return apiError(c, 404, "not_found", "Page not found");
  const user = c.get("user");
  if (user === null || user === undefined) return apiError(c, 401, "sign_in_required", "Sign in to see who can open this page.");
  const page = await pageFor(c, id, "access");
  if (page instanceof Response) return page;
  if (page.row.ownerId !== user.id) return apiError(c, 403, "not_owner", "This page isn't in your account.");
  try {
    const [entries, visitors, ent] = await Promise.all([
      getAccessEntries(c.env.DB, id),
      listVisitors(c.env.DB, id, user.id),
      getEntitlements(c.env, user.id),
    ]);
    const mode = page.row.access === "people" ? "people" : page.row.pin !== null ? "pin" : "public";
    return c.json({
      id,
      mode,
      ...fromEntries(mode === "people" ? entries : []),
      visitors: visitors.map((v) => ({
        email: v.email,
        first_opened_at: new Date(v.firstAt).toISOString(),
        last_opened_at: new Date(v.lastAt).toISOString(),
        views: v.views,
      })),
      limits: { people: ent.access.people, domains: ent.access.domains },
      email_ready: emailSenderFor(c.env) !== null,
    });
  } catch (err) {
    console.error("access read failed", { id, err });
    return apiError(c, 503, "unavailable", "Could not load who can open this page. Try again.");
  }
});

export { access };
