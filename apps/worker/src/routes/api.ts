import { Hono, type Context } from "hono";
import type { AppBindings } from "../types.js";
import { loadStats, publicStats } from "../lib/stats.js";
import { countryTotals, mergeViewTotals, pageViewCounts, viewCountOf } from "../lib/view-counts.ts";
import { rateLimit, publishRateLimit } from "../middleware/rate-limit.js";
import { requireCsrfHeader } from "../middleware/csrf.js";
import { readUpdateToken } from "../lib/page-token.js";
import { TIERS } from "../lib/rate-limit-tiers.js";
import { hashPin } from "../lib/pin-hash.js";
import { authorizePageWrite } from "../lib/claim-decision.js";
import { deletePage, PageGone, setPageOptions, type LoadedPage } from "../lib/page-write.ts";
import { changedSettings, pageDetails, parseOptions, settingsChange } from "../lib/page-options.ts";
import { feedbackAllowed, feedbackId, insertFeedback, NOT_SUPPORT, parseFeedback } from "../lib/feedback.ts";
import { visitorNetwork } from "../lib/pin-guess.ts";
import { getEntitlements, planLimitError } from "../lib/entitlements.js";
import { siteOrigin } from "../lib/origin.ts";
import { apiError } from "../lib/errors.ts";
import { publicPageMeta } from "../lib/public-meta.ts";
import { kindOf, readSidecar } from "../lib/page-content.ts";
import { versionCounts } from "../lib/page-versions.ts";
import { fromEntries, overLimit, toEntries } from "../lib/access-list.ts";
import { clearAccessList, getAccessEntries, replaceAccessList } from "../lib/access-store.ts";
import { emailSenderFor } from "../lib/email-sender.ts";
import {
  createFromPublish,
  invalidInput,
  invalidToken,
  noCredential,
  ownerAccess,
  pageFor,
  prepareContent,
  readJson,
  replaceContent,
  sentUpdateToken,
  spamRefusal,
  spamScreened,
} from "../lib/pages-service.ts";
import { idempotentPublish } from "../middleware/idempotency.ts";
import { verifyToken, parseMetadata, hashToHex, parseBody, publishBody, updateBody } from "@aired/core";

const api = new Hono<AppBindings>();

// POST /api/publish — create a new page, or replace one with id + update_token.
// Accepts an Idempotency-Key header (lib/idempotency.ts): a retry with the
// same key and body answers the first response instead of a second page.
api.post("/publish", idempotentPublish, publishRateLimit, async (c) => {
  const json = await readJson(c);
  if (json instanceof Response) return json;
  // Shapes and bounds in @aired/core (schemas.ts); a wrong-typed field is ignored, as before.
  const parsed = parseBody(publishBody, json.body);
  if (!parsed.ok) return invalidInput(c, parsed.error, parsed.field);
  const { update_token, id: existingId, message } = parsed.data;
  // Markdown rendered, an HTML deck's notes cut out, the plan's size limit (lib/pages-service.ts).
  const prepared = await prepareContent(c, parsed.data);
  if (prepared instanceof Response) return prepared;

  // Update path: update_token + id provided
  if (typeof update_token === "string" && typeof existingId === "string") {
    const page = await pageFor(c, existingId, "publish_update");
    if (page instanceof Response) return page;
    if (!(await verifyToken(update_token, page.row.tokenHash))) return invalidToken(c);
    return replaceContent(c, page, prepared, { token: update_token, message, route: "api_publish_update" });
  }
  return createFromPublish(c, parsed.data, prepared, "api_publish");
});

// PUT /api/pages/:id — update by token (body or Bearer header) or owner JWT
api.put("/pages/:id", requireCsrfHeader, async (c) => {
  const id = c.req.param("id") ?? "";
  const json = await readJson(c);
  if (json instanceof Response) return json;
  const parsed = parseBody(updateBody, json.body);
  if (!parsed.ok) return invalidInput(c, parsed.error, parsed.field);
  const update_token = readUpdateToken(parsed.data.update_token, c.req.header("Authorization"));
  const prepared = await prepareContent(c, parsed.data);
  if (prepared instanceof Response) return prepared;

  const page = await pageFor(c, id, "put");
  if (page instanceof Response) return page;
  // Authorization: update_token (body, else Bearer header) wins (R6); else owner JWT
  const auth = await authorizePageWrite({
    ownerId: page.row.ownerId,
    tokenHash: page.row.tokenHash,
    token: update_token,
    userId: c.get("user")?.id ?? null,
    allowSession: true,
    matches: (hash) => verifyToken(update_token as string, hash),
  });
  if (!auth.ok) return auth.reason === "bad_token" ? invalidToken(c) : noCredential(c);
  // The token is echoed back only when it's what authorized the write.
  return replaceContent(c, page, prepared, { token: auth.viaToken ? update_token : null, message: parsed.data.message, route: "api_put" });
});

// DELETE /api/pages/:id — delete by Bearer token OR owner-JWT convenience path
api.delete("/pages/:id", requireCsrfHeader, async (c) => {
  const id = c.req.param("id") ?? "";
  const authHeader = c.req.header("Authorization");

  const page = await pageFor(c, id, "delete");
  if (page instanceof Response) return page;
  const creds = { ownerId: page.row.ownerId, tokenHash: page.row.tokenHash };

  const deleteUser = c.get('user');
  let authorized = false;

  // Primary path: Authorization: Bearer <update_token>, or update_token in a
  // JSON body for clients that send it the same way as PUT.
  let bodyToken: unknown;
  try {
    bodyToken = ((await c.req.json()) as Record<string, unknown> | null)?.update_token;
  } catch {
    bodyToken = undefined;
  }
  const token = readUpdateToken(bodyToken, authHeader);
  if (token !== null) {
    const valid = await verifyToken(token, creds.tokenHash);
    if (valid) {
      authorized = true;
    }
  }

  // Owner-convenience path: JWT owner match (rate-limited)
  if (!authorized && deleteUser !== null && creds.ownerId === deleteUser.id) {
    // Apply delete rate limit for owner-convenience path
    const deleteRateLimit = rateLimit(TIERS.delete);
    const rlResult = await deleteRateLimit(c, async () => {});
    if (rlResult !== undefined) {
      // Rate limit exceeded — middleware returned a Response
      return rlResult;
    }
    authorized = true;
  }

  if (!authorized) return token !== null ? invalidToken(c) : noCredential(c);

  // The D1 row is marked first, then the HTML and cache record go
  // (lib/page-write.ts). If the row can't be marked, nothing has changed and
  // a retry works.
  try {
    await deletePage(c.env, page, (work) => c.executionCtx.waitUntil(work));
  } catch (err) {
    console.error("page delete failed", { id, err });
    return apiError(c, 503, "unavailable", "Could not delete this page. Please try again.");
  }

  return c.json({ ok: true });
});

/** The page's view count, from its KV record (where views are counted). */
// Views live in D1 page_views; the KV readCount is the fallback for pages
// viewed before view counting moved there, or if the lookup fails.
async function viewCount(c: Context<AppBindings>, page: LoadedPage): Promise<number> {
  const kvCount = page.kv?.readCount ?? 0;
  try {
    return viewCountOf(await pageViewCounts(c.env.DB, [page.row.id]), page.row.id, kvCount);
  } catch (err) {
    console.error("page_views lookup failed", { id: page.row.id, err });
    return kvCount;
  }
}

/** A page's kind (page, doc or deck) and slide count, from its sidecar. A failed read: a plain page. */
async function kindDetails(c: Context<AppBindings>, id: string): Promise<{ kind: string; slides?: number }> {
  try {
    const sidecar = await readSidecar(c.env.PAGES_BUCKET, id);
    return sidecar?.kind === "deck" ? { kind: "deck", slides: sidecar.slides } : { kind: kindOf(sidecar) };
  } catch (err) {
    console.error("sidecar read failed", { id, err });
    return { kind: "page" };
  }
}

// GET /api/pages/:id/details — the owner's view of a page (get_page): title,
// URL, size, views, view limit, expiry, whether it has a PIN (never the PIN)
// and project. Owner by update token or signed-in owner; anyone else is refused.
api.get("/pages/:id/details", rateLimit(TIERS.page_options), async (c) => {
  const id = c.req.param("id") ?? "";
  const page = await pageFor(c, id, "details");
  if (page instanceof Response) return page;
  const access = await ownerAccess(c, page, sentUpdateToken(c));
  if (!access.ok) return apiError(c, access.status, access.code, access.error);
  const allowed = await allowedFor(c, page.row);
  if (allowed instanceof Response) return allowed;
  return c.json({ ...pageDetails(page.row, await viewCount(c, page), siteOrigin(c.env)), ...(await kindDetails(c, id)), ...(await versionCounts(c.env.DB, id)), ...allowed });
});

/**
 * An "only these people" page's list, for its signed-in owner only (a token
 * sent too doesn't matter): other people's addresses don't go to whoever
 * holds the update token. Empty for other pages and other callers.
 */
async function allowedFor(
  c: Context<AppBindings>,
  row: { id: string; ownerId: number | null; access: "people" | null },
): Promise<{ allowed?: { emails: string[]; domains: string[] } } | Response> {
  const user = c.get("user");
  if (row.access !== "people" || user === null || row.ownerId !== user.id) return {};
  try {
    return { allowed: fromEntries(await getAccessEntries(c.env.DB, row.id)) };
  } catch (err) {
    console.error("access list lookup failed", { id: row.id, err });
    return apiError(c, 503, "unavailable", "Could not load this page's settings. Please try again.");
  }
}

// PATCH /api/pages/:id — change a page's settings without sending its HTML
// again (set_options, `aired set`): title, pin (null removes it), ttl or
// permanent, reads (null removes the view limit). Owner by update token
// (body, X-Update-Token or Bearer) or signed-in owner (session or API key).
api.patch("/pages/:id", requireCsrfHeader, rateLimit(TIERS.page_options), async (c) => {
  const id = c.req.param("id") ?? "";
  const json = await readJson(c);
  if (json instanceof Response) return json;
  const body = json.body;
  const parsed = parseOptions(body);
  if (!parsed.ok) return invalidInput(c, parsed.error, null);
  const { change } = parsed;

  const page = await pageFor(c, id, "patch");
  if (page instanceof Response) return page;
  const access = await ownerAccess(c, page, sentUpdateToken(c, (body as Record<string, unknown>).update_token));
  if (!access.ok) return apiError(c, access.status, access.code, access.error);

  // A new title is screened with the page's HTML, as an update would be
  // (lib/pages-service.ts), so a clean page can't be retitled into spam.
  if (typeof change.title === "string" && spamScreened(c, page.row.ownerId)) {
    const obj = await c.env.PAGES_BUCKET.get(`pages/${id}/index.html`);
    const spam = spamRefusal(c, obj === null ? "" : await obj.text(), change.title, "api_patch", page.row.ownerId);
    if (spam !== null) return spam;
  }

  const now = Date.now();
  const pinHash = typeof change.pin === "string" ? await hashPin(change.pin) : null;
  const columns = settingsChange(change, pinHash, now, page.row);

  // Who may open the page (lib/access-list.ts). Making a page "only these
  // people", changing its list, or taking it out of that mode is for the
  // signed-in owner: the list is other people's addresses.
  const toPeople = change.access?.mode === "people";
  const fromPeople = page.row.access === "people" && columns.access === null;
  if (toPeople || fromPeople) {
    const user = c.get("user");
    if (page.row.ownerId === null) {
      return apiError(c, 403, "owner_required", "Only pages in an account can be shared with named people. Sign in and keep the page in your account first.");
    }
    // A token sent alongside doesn't matter: what counts is the signed-in owner.
    if (user === null || user.id !== page.row.ownerId) {
      return apiError(c, 403, "owner_required", "Only the page's owner, signed in (aired login, an API key or the dashboard), can change who can open it.");
    }
  }
  if (change.access?.mode === "pin" && change.pin === undefined && page.row.pin === null) {
    return invalidInput(c, 'access.mode "pin" needs a pin: this page has none yet', "pin");
  }
  if (toPeople && change.access !== undefined) {
    const ent = await getEntitlements(c.env, page.row.ownerId);
    const over = overLimit(change.access, ent.access);
    if (over !== null) {
      const pro = ent.plan === "pro";
      if (pro) return apiError(c, 400, "invalid_input", over.error.replace(" Remove some, or upgrade.", " Remove some."), { field: "access" });
      return c.json({ ...planLimitError(over.limit, siteOrigin(c.env), "share"), error: over.error }, 402);
    }
    if (emailSenderFor(c.env) === null) {
      return apiError(c, 503, "email_unavailable", "Sharing with named people needs email, which isn't set up on this server yet.");
    }
    // The list goes in first: a "people" page with an old or empty list
    // lets fewer people in, never more.
    try {
      await replaceAccessList(c.env.DB, id, page.row.ownerId!, toEntries(change.access), now);
    } catch (err) {
      console.error("access list write failed", { id, err });
      return apiError(c, 503, "unavailable", "Could not change who can open this page. Please try again.");
    }
  }

  let row;
  try {
    ({ row } = await setPageOptions(c.env, page, columns, now));
  } catch (err) {
    if (err instanceof PageGone) return apiError(c, 404, "not_found", "Page not found");
    console.error("page options write failed", { id, err });
    return apiError(c, 503, "unavailable", "Could not change this page's settings. Please try again.");
  }
  // Out of "only these people": the list and live codes go once the page no longer checks them.
  if (fromPeople) {
    try {
      await clearAccessList(c.env.DB, id);
    } catch (err) {
      console.error("access list clear failed", { id, err });
    }
  }
  const allowed = await allowedFor(c, row);
  if (allowed instanceof Response) return allowed;
  return c.json({ ...pageDetails(row, await viewCount(c, page), siteOrigin(c.env)), changed: changedSettings(change), ...allowed });
});

// POST /api/feedback — feedback from agents and people about aired itself
// (send_feedback, `aired feedback`; lib/feedback.ts). Works signed in or
// not. Never page HTML. Answers an id to pass on to the user.
api.post("/feedback", rateLimit(TIERS.feedback), async (c) => {
  const json = await readJson(c);
  if (json instanceof Response) return json;
  const body = json.body;
  // The source, when the client didn't say: the MCP servers and CLI name themselves.
  if (typeof body === "object" && body !== null && !Array.isArray(body) && (body as Record<string, unknown>).source === undefined) {
    const ua = c.req.header("User-Agent") ?? "";
    const source = ua.startsWith("aired-mcp") ? "mcp" : ua.startsWith("aired/") ? "cli" : undefined;
    if (source !== undefined) (body as Record<string, unknown>).source = source;
  }
  const parsed = parseFeedback(body);
  if (!parsed.ok) return invalidInput(c, parsed.error, null);

  const user = c.get("user");
  const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For") ?? "unknown";
  // An IPv6 sender counts by their /64, which one connection usually controls.
  const rateKey = await hashToHex(user !== null ? `user:${user.id}` : `ip:${visitorNetwork(ip)}`, 16);
  const now = Date.now();
  try {
    const id = feedbackId();
    if (!(await insertFeedback(c.env.DB, id, parsed.input, { userId: user?.id ?? null, rateKey }, now))) {
      const limit = await feedbackAllowed(c.env.DB, rateKey, now);
      const global = !limit.ok && limit.reason === "global";
      return apiError(
        c,
        429,
        "rate_limited",
        global ? "aired isn't taking feedback right now. Try again tomorrow." : "Feedback limit reached: 10 an hour. Send it later, or not at all.",
      );
    }
    console.log({ event: "feedback_received", id, kind: parsed.input.kind, impact: parsed.input.impact, source: parsed.input.source });
    return c.json({ id, message: `${NOT_SUPPORT} Tell the user you sent feedback ${id}.` });
  } catch (err) {
    console.error("feedback write failed", { err });
    return apiError(c, 503, "unavailable", "Could not save feedback. Please try again later.");
  }
});

// GET /api/pages/:id — public metadata (no token required). A PIN-protected
// page's title and view count stay hidden (lib/public-meta.ts).
api.get("/pages/:id", async (c) => {
  const id = c.req.param("id");

  const raw = await c.env.PAGES_KV.get(`page:${id}`);
  if (raw === null) return apiError(c, 404, "not_found", "Page not found");

  const metadata = parseMetadata(raw);
  if (metadata === null) return apiError(c, 500, "internal_error", "Page metadata is corrupted");

  let readCount = metadata.readCount;
  if (metadata.pin === null && metadata.access !== "people") {
    try {
      readCount = viewCountOf(await pageViewCounts(c.env.DB, [id]), id, metadata.readCount);
    } catch (err) {
      console.error("page_views lookup failed", { id, err });
    }
  }

  return c.json(publicPageMeta(metadata, readCount));
});

// GET /api/stats — public stats: counters and per-country views only. Views
// are the totals frozen in stats:live plus D1's per-country counts since
// (lib/view-counts.ts); if D1 fails, the frozen totals alone.
api.get("/stats", async (c) => {
  const stats = await loadStats(c.env.PAGES_KV);
  let geo: Record<string, number> = {};
  try {
    geo = await countryTotals(c.env.DB);
  } catch (err) {
    console.error("view_totals lookup failed", { err });
  }
  return c.json(publicStats(mergeViewTotals(stats, geo)));
});

export { api };
