import { Hono, type Context } from "hono";
import type { AppBindings } from "../types.js";
import { loadStats, publicStats, saveStats } from "../lib/stats.js";
import { countryTotals, mergeViewTotals, pageViewCounts, viewCountOf } from "../lib/view-counts.ts";
import { rateLimit, publishRateLimit } from "../middleware/rate-limit.js";
import { requireCsrfHeader } from "../middleware/csrf.js";
import { readUpdateToken } from "../lib/page-token.js";
import { TIERS } from "../lib/rate-limit-tiers.js";
import { detectSpam, SPAM_REJECTION } from "../lib/spam.js";
import { claimUrl } from "../lib/claim-url.js";
import { hashPin } from "../lib/pin-hash.js";
import { authorizePageWrite } from "../lib/claim-decision.js";
import { createPage, deletePage, loadPage, PageGone, setPageOptions, StorageUnavailable, updatePage, type LoadedPage } from "../lib/page-write.ts";
import { changedSettings, pageAccess, pageDetails, parseOptions, settingsChange } from "../lib/page-options.ts";
import { feedbackAllowed, feedbackId, insertFeedback, NOT_SUPPORT, parseFeedback } from "../lib/feedback.ts";
import { visitorNetwork } from "../lib/pin-guess.ts";
import { billingEnabled, getEntitlements, planLimitError, upgradeUrl } from "../lib/entitlements.js";
import { siteOrigin } from "../lib/origin.ts";
import { refreshShot } from "../lib/og-render.js";
import type { Entitlements } from "../lib/entitlements.js";
import {
  generateId,
  generateToken,
  hashToken,
  verifyToken,
  validateHtml,
  extractTitle,
  parseMetadata,
  normalizeProject,
  hashToHex,
  DEFAULT_TTL,
  MAX_SIZE,
  PRO_MAX_SIZE,
} from "@aired/core";
import type { PageMetadata } from "@aired/core";

const api = new Hono<AppBindings>();

/**
 * The live page and the owner and token hash that count for it, from its D1
 * row (lib/page-write.ts loadPage), never from the KV record, which can be
 * written back stale. A D1 error answers 503: fail closed rather than trust
 * a possibly stale hash.
 */
export async function pageFor(c: Context<AppBindings>, id: string, route: string): Promise<LoadedPage | Response> {
  try {
    return (await loadPage(c.env, id)) ?? c.json({ error: "Page not found" }, 404);
  } catch (err) {
    console.error("pages lookup failed", { route, id, err });
    return c.json({ error: CREDENTIALS_UNAVAILABLE }, 503);
  }
}

const CREDENTIALS_UNAVAILABLE = "Could not check this page's credentials. Please try again.";
const STORAGE_FULL = "Service temporarily unavailable — storage write limit reached. Try again later.";

/**
 * Validate HTML against the caller's plan size limit. `response` is the error
 * response, or null when the HTML is fine. A signed-in free user whose page
 * would fit on Pro gets a 402 upgrade prompt when billing is on; everyone else
 * gets the validateHtml 400 as before. `ent` is the caller's entitlements
 * (null when anonymous), returned so the success path doesn't read KV again.
 */
async function rejectInvalidHtml(
  c: Context<AppBindings>,
  html: string,
): Promise<{ response: Response | null; ent: Entitlements | null }> {
  const user = c.get("user");
  const ent = user !== null ? await getEntitlements(c.env, user.id) : null;
  const maxBytes = ent !== null ? ent.maxBytes : MAX_SIZE;
  const validation = validateHtml(html, maxBytes);
  if (validation.ok) return { response: null, ent };
  if (ent !== null && ent.plan === "free" && billingEnabled(c.env)) {
    const size = new TextEncoder().encode(html).byteLength;
    if (size > maxBytes && size <= PRO_MAX_SIZE) {
      return { response: c.json(planLimitError("page_size", siteOrigin(c.env)), 402), ent };
    }
  }
  return { response: c.json({ error: validation.error }, 400), ent };
}

/**
 * The `upgrade` key for a successful publish/update response: only a signed-in
 * free-plan caller with billing on sees the offer to remove the badge.
 */
function upgradeHint(
  c: Context<AppBindings>,
  ent: Entitlements | null,
): { upgrade: { reason: "badge"; url: string } } | Record<string, never> {
  if (ent === null || ent.plan !== "free" || !billingEnabled(c.env)) return {};
  return { upgrade: { reason: "badge", url: upgradeUrl(siteOrigin(c.env), "publish") } };
}

// POST /api/publish — create a new page or update an existing one via update_token
api.post("/publish", publishRateLimit, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return c.json({ error: "Request body must be a JSON object" }, 400);
  }

  const req = body as Record<string, unknown>;
  const { html, title, pin, ttl, reads, permanent, project, update_token, id: existingId } = req;

  if (typeof html !== "string") {
    return c.json({ error: "html is required and must be a string" }, 400);
  }

  const { response: invalid, ent } = await rejectInvalidHtml(c, html);
  if (invalid !== null) return invalid;

  const resolvedTitle =
    (typeof title === "string" && title.trim() ? title.trim() : null) ??
    extractTitle(html);

  const origin = new URL(c.req.url).origin;
  const user = c.get('user');

  // Anonymous publishes (create or update) are screened for spam.
  // Signed-in publishers are accountable and skip the filter.
  if (user === null) {
    const verdict = detectSpam(html, resolvedTitle);
    if (verdict.spam) {
      console.log({ event: "spam_rejected", route: "api_publish", reason: verdict.reason });
      return c.json({ error: SPAM_REJECTION }, 422);
    }
  }

  // Update path: update_token + id provided
  if (typeof update_token === "string" && typeof existingId === "string") {
    const page = await pageFor(c, existingId, "publish_update");
    if (page instanceof Response) return page;
    const creds = { ownerId: page.row.ownerId, tokenHash: page.row.tokenHash };

    const valid = await verifyToken(update_token, creds.tokenHash);
    if (!valid) {
      return c.json({ error: "Invalid update token" }, 403);
    }

    // An anonymous page is screened on update whoever sends it, so a clean
    // page can't be swapped for spam (as PUT does).
    if (user !== null && creds.ownerId === null) {
      const verdict = detectSpam(html, resolvedTitle);
      if (verdict.spam) {
        console.log({ event: "spam_rejected", route: "api_publish_update", reason: verdict.reason });
        return c.json({ error: SPAM_REJECTION }, 422);
      }
    }

    const { metadata: updated, expiresAt, htmlEtag } = await updatePage(c.env, page, html, resolvedTitle);

    // Link-preview screenshot, after the response (lib/og-render.ts).
    c.executionCtx.waitUntil(refreshShot(c.env, existingId, updated, html, htmlEtag, { replacing: true }));

    return c.json({
      id: existingId,
      url: `${origin}/p/${existingId}`,
      update_token,
      expiresAt,
      ...upgradeHint(c, ent),
    });
  }

  // Create path: new page
  const id = generateId();
  const token = generateToken();
  const tokenHash = await hashToken(token);

  // Authenticated publishers default to permanent (no expiry).
  // Explicit `permanent: false` or an explicit `ttl` opts back into expiration.
  const isPermanent =
    permanent === true ||
    (permanent !== false && (typeof ttl !== "number" || ttl <= 0) && user !== null);
  const ttlSeconds =
    isPermanent ? null
    : typeof ttl === "number" && ttl > 0 ? Math.floor(ttl)
    : DEFAULT_TTL;

  const now = new Date();
  const expiresAt = ttlSeconds !== null
    ? new Date(now.getTime() + ttlSeconds * 1000).toISOString()
    : null;

  const metadata: PageMetadata = {
    id,
    title: resolvedTitle,
    size: new TextEncoder().encode(html).byteLength,
    tokenHash,
    // Stored as a salted PBKDF2 hash (lib/pin-hash.ts), never as typed.
    pin: typeof pin === "string" && pin.length > 0 ? await hashPin(pin) : null,
    reads: typeof reads === "number" && reads > 0 ? Math.floor(reads) : null,
    readCount: 0,
    permanent: isPermanent,
    createdAt: now.toISOString(),
    expiresAt,
    ownerId: user !== null ? user.id : null,
    project: normalizeProject(project),
  };

  // D1 row, R2 HTML and KV cache record, or nothing (lib/page-write.ts).
  let htmlObj: R2Object | null;
  try {
    htmlObj = await createPage(c.env, metadata, html, now.getTime());
  } catch (err) {
    if (err instanceof StorageUnavailable) {
      console.error("publish storage write failed", { id, err: err.message });
      return c.json({ error: STORAGE_FULL }, 503);
    }
    throw err;
  }

  // Increment publish counter (fire-and-forget)
  c.executionCtx.waitUntil(
    (async () => {
      const stats = await loadStats(c.env.PAGES_KV);
      stats.publishes += 1;
      await saveStats(c.env.PAGES_KV, stats);
    })().catch(() => {}),
  );

  // Link-preview screenshot, after the response (lib/og-render.ts).
  c.executionCtx.waitUntil(refreshShot(c.env, id, metadata, html, htmlObj?.etag ?? null, { replacing: false }));

  return c.json({
    id,
    url: `${origin}/p/${id}`,
    update_token: token,
    expiresAt,
    // Anonymous creates get a link to attach the page to an account later.
    ...(user === null ? { claim_url: claimUrl(siteOrigin(c.env), id, token) } : {}),
    ...upgradeHint(c, ent),
  });
});

// PUT /api/pages/:id — update by token (body or Bearer header) or owner JWT
api.put("/pages/:id", requireCsrfHeader, async (c) => {
  const id = c.req.param("id") ?? "";

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return c.json({ error: "Request body must be a JSON object" }, 400);
  }

  const { html, title } = body as Record<string, unknown>;
  const update_token = readUpdateToken(
    (body as Record<string, unknown>).update_token,
    c.req.header("Authorization"),
  );

  if (typeof html !== "string") {
    return c.json({ error: "html is required and must be a string" }, 400);
  }

  const { response: invalid, ent } = await rejectInvalidHtml(c, html);
  if (invalid !== null) return invalid;

  const resolvedTitle =
    (typeof title === "string" && title.trim() ? title.trim() : null) ??
    extractTitle(html);

  const page = await pageFor(c, id, "put");
  if (page instanceof Response) return page;
  const creds = { ownerId: page.row.ownerId, tokenHash: page.row.tokenHash };

  // Authorization: update_token (body, else Bearer header) wins (R6); else owner JWT
  const putUser = c.get('user');
  const auth = await authorizePageWrite({
    ownerId: creds.ownerId,
    tokenHash: creds.tokenHash,
    token: update_token,
    userId: putUser?.id ?? null,
    allowSession: true,
    matches: (hash) => verifyToken(update_token as string, hash),
  });

  if (!auth.ok) {
    if (auth.reason === "bad_token") {
      return c.json({ error: "Invalid update token" }, 403);
    }
    return c.json({ error: "update_token required" }, 400);
  }

  // Anonymous pages are screened on update too, so a clean page can't be
  // swapped for spam after publishing.
  if (creds.ownerId === null) {
    const verdict = detectSpam(html, resolvedTitle);
    if (verdict.spam) {
      console.log({ event: "spam_rejected", route: "api_put", reason: verdict.reason });
      return c.json({ error: SPAM_REJECTION }, 422);
    }
  }

  const { metadata: updated, expiresAt, htmlEtag } = await updatePage(c.env, page, html, resolvedTitle);

  // Link-preview screenshot, after the response (lib/og-render.ts).
  c.executionCtx.waitUntil(refreshShot(c.env, id, updated, html, htmlEtag, { replacing: true }));

  const origin = new URL(c.req.url).origin;
  // Return the token string back (prefer the body token; if owner-JWT path used, no token in response)
  const returnToken = auth.viaToken ? (update_token as string) : undefined;

  return c.json({
    id,
    url: `${origin}/p/${id}`,
    ...(returnToken !== undefined ? { update_token: returnToken } : {}),
    expiresAt,
    ...upgradeHint(c, ent),
  });
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

  if (!authorized) {
    if (token !== null) {
      return c.json({ error: "Invalid token" }, 403);
    }
    return c.json({ error: "Authorization: Bearer <update_token> is required" }, 401);
  }

  // The D1 row is marked first, then the HTML and cache record go
  // (lib/page-write.ts). If the row can't be marked, nothing has changed and
  // a retry works.
  try {
    await deletePage(c.env, page, (work) => c.executionCtx.waitUntil(work));
  } catch (err) {
    console.error("page delete failed", { id, err });
    return c.json({ error: "Could not delete this page. Please try again." }, 503);
  }

  return c.json({ ok: true });
});

/**
 * The update token a request carries for get_page and set_options: the
 * body's update_token, else X-Update-Token (for API key callers, whose
 * Authorization holds the key), else a non-key Bearer token.
 */
export function sentUpdateToken(c: Context<AppBindings>, bodyToken?: unknown): string | null {
  const header = c.req.header("X-Update-Token");
  if (typeof bodyToken === "string" && bodyToken !== "") return bodyToken;
  if (header !== undefined && header.trim() !== "") return header.trim();
  return readUpdateToken(undefined, c.req.header("Authorization"));
}

/** The token or signed-in owner check shared by details and PATCH (lib/page-options.ts). */
export async function ownerAccess(c: Context<AppBindings>, page: LoadedPage, token: string | null) {
  return pageAccess({
    ownerId: page.row.ownerId,
    userId: c.get("user")?.id ?? null,
    tokenSent: token !== null,
    tokenMatches: token !== null && (await verifyToken(token, page.row.tokenHash)),
  });
}

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

// GET /api/pages/:id/details — the owner's view of a page (get_page): title,
// URL, size, views, view limit, expiry, whether it has a PIN (never the PIN)
// and project. Owner by update token or signed-in owner; anyone else is refused.
api.get("/pages/:id/details", rateLimit(TIERS.page_options), async (c) => {
  const id = c.req.param("id") ?? "";
  const page = await pageFor(c, id, "details");
  if (page instanceof Response) return page;
  const access = await ownerAccess(c, page, sentUpdateToken(c));
  if (!access.ok) return c.json({ error: access.error }, access.status);
  return c.json(pageDetails(page.row, await viewCount(c, page), siteOrigin(c.env)));
});

// PATCH /api/pages/:id — change a page's settings without sending its HTML
// again (set_options, `aired set`): title, pin (null removes it), ttl or
// permanent, reads (null removes the view limit). Owner by update token
// (body, X-Update-Token or Bearer) or signed-in owner (session or API key).
api.patch("/pages/:id", requireCsrfHeader, rateLimit(TIERS.page_options), async (c) => {
  const id = c.req.param("id") ?? "";
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = parseOptions(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { change } = parsed;

  const page = await pageFor(c, id, "patch");
  if (page instanceof Response) return page;
  const access = await ownerAccess(c, page, sentUpdateToken(c, (body as Record<string, unknown>).update_token));
  if (!access.ok) return c.json({ error: access.error }, access.status);

  // A new title on an anonymous page is screened with its HTML, as an
  // update would be, so a clean page can't be retitled into spam.
  if (page.row.ownerId === null && typeof change.title === "string") {
    const obj = await c.env.PAGES_BUCKET.get(`pages/${id}/index.html`);
    const verdict = detectSpam(obj === null ? "" : await obj.text(), change.title);
    if (verdict.spam) {
      console.log({ event: "spam_rejected", route: "api_patch", reason: verdict.reason });
      return c.json({ error: SPAM_REJECTION }, 422);
    }
  }

  const now = Date.now();
  const pinHash = typeof change.pin === "string" ? await hashPin(change.pin) : null;
  let row;
  try {
    ({ row } = await setPageOptions(c.env, page, settingsChange(change, pinHash, now), now));
  } catch (err) {
    if (err instanceof PageGone) return c.json({ error: "Page not found" }, 404);
    console.error("page options write failed", { id, err });
    return c.json({ error: "Could not change this page's settings. Please try again." }, 503);
  }
  return c.json({ ...pageDetails(row, await viewCount(c, page), siteOrigin(c.env)), changed: changedSettings(change) });
});

// POST /api/feedback — feedback from agents and people about aired itself
// (send_feedback, `aired feedback`; lib/feedback.ts). Works signed in or
// not. Never page HTML. Answers an id to pass on to the user.
api.post("/feedback", rateLimit(TIERS.feedback), async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  // The source, when the client didn't say: the MCP servers and CLI name themselves.
  if (typeof body === "object" && body !== null && !Array.isArray(body) && (body as Record<string, unknown>).source === undefined) {
    const ua = c.req.header("User-Agent") ?? "";
    const source = ua.startsWith("aired-mcp") ? "mcp" : ua.startsWith("aired/") ? "cli" : undefined;
    if (source !== undefined) (body as Record<string, unknown>).source = source;
  }
  const parsed = parseFeedback(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

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
      return c.json(
        { error: global ? "aired isn't taking feedback right now. Try again tomorrow." : "Feedback limit reached: 10 an hour. Send it later, or not at all." },
        429,
      );
    }
    console.log({ event: "feedback_received", id, kind: parsed.input.kind, impact: parsed.input.impact, source: parsed.input.source });
    return c.json({ id, message: `${NOT_SUPPORT} Tell the user you sent feedback ${id}.` });
  } catch (err) {
    console.error("feedback write failed", { err });
    return c.json({ error: "Could not save feedback. Please try again later." }, 503);
  }
});

// GET /api/pages/:id — public metadata (no token required)
api.get("/pages/:id", async (c) => {
  const id = c.req.param("id");

  const raw = await c.env.PAGES_KV.get(`page:${id}`);
  if (raw === null) {
    return c.json({ error: "Page not found" }, 404);
  }

  const metadata = parseMetadata(raw);
  if (metadata === null) {
    return c.json({ error: "Page metadata is corrupted" }, 500);
  }

  let readCount = metadata.readCount;
  try {
    readCount = viewCountOf(await pageViewCounts(c.env.DB, [id]), id, metadata.readCount);
  } catch (err) {
    console.error("page_views lookup failed", { id, err });
  }

  return c.json({
    id: metadata.id,
    title: metadata.title,
    size: metadata.size,
    readCount,
    expiresAt: metadata.expiresAt,
  });
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
