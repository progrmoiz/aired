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
import { changedSettings, OWNER_REQUIRED_MESSAGE, pageAccess, pageDetails, parseOptions, replaceAllowed, settingsChange } from "../lib/page-options.ts";
import { pageHasResponses } from "../lib/collect-store.ts";
import { feedbackAllowed, feedbackId, insertFeedback, NOT_SUPPORT, parseFeedback } from "../lib/feedback.ts";
import { visitorNetwork } from "../lib/pin-guess.ts";
import { billingEnabled, getEntitlements, planLimitError, upgradeUrl } from "../lib/entitlements.js";
import { siteOrigin } from "../lib/origin.ts";
import { refreshShot } from "../lib/og-render.js";
import { apiError } from "../lib/errors.ts";
import { publicPageMeta } from "../lib/public-meta.ts";
import { buildContent, contentFields, kindOf, readSidecar } from "../lib/page-content.ts";
import { versionAuthor, versionCounts, type VersionAuthor } from "../lib/page-versions.ts";
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
  capTitle,
  parseBody,
  publishBody,
  updateBody,
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
    return (await loadPage(c.env, id)) ?? apiError(c, 404, "not_found", "Page not found");
  } catch (err) {
    console.error("pages lookup failed", { route, id, err });
    return apiError(c, 503, "unavailable", CREDENTIALS_UNAVAILABLE);
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
  return { response: apiError(c, 400, "invalid_html", validation.error), ent };
}

/**
 * The request's JSON body, or the 400 to answer when it isn't JSON. A body
 * sent without Content-Length that runs past the size cap is rethrown, so
 * bodyLimit (middleware/api-contract.ts) answers its 413.
 */
async function readJson(c: Context<AppBindings>): Promise<{ body: unknown } | Response> {
  try {
    return { body: await c.req.json() };
  } catch (err) {
    if (err instanceof Error && err.name === "BodyLimitError") throw err;
    return apiError(c, 400, "invalid_json", "Invalid JSON body");
  }
}

/** A body that failed its schema (lib/errors.ts): `field` names the field when there is one. */
function invalidInput(c: Context<AppBindings>, error: string, field: string | null): Response {
  return apiError(c, 400, "invalid_input", error, field !== null ? { field } : {});
}

const spamRejected = (c: Context<AppBindings>) => apiError(c, 422, "spam_rejected", SPAM_REJECTION);
const invalidToken = (c: Context<AppBindings>) => apiError(c, 403, "invalid_token", "Invalid update token");

/**
 * No working credential for a page write (PUT, DELETE): 401 when the caller
 * sent nothing at all, 403 when they're signed in but it isn't their page.
 * Same rule as the details and PATCH routes (lib/page-options.ts pageAccess).
 */
function noCredential(c: Context<AppBindings>): Response {
  if (c.get("user") !== null) {
    return apiError(c, 403, "not_owner", "This page isn't in your account. Use its update token instead.");
  }
  return apiError(c, 401, "token_required", "Send the page's update_token (in the body or as Authorization: Bearer <update_token>), or sign in as its owner.");
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
  const json = await readJson(c);
  if (json instanceof Response) return json;
  // Shapes and bounds in @aired/core (schemas.ts); a wrong-typed field is ignored, as before.
  const parsed = parseBody(publishBody, json.body);
  if (!parsed.ok) return invalidInput(c, parsed.error, parsed.field);
  const { title, pin, ttl, reads, permanent, project, update_token, id: existingId, message } = parsed.data;
  // Markdown is rendered and an HTML deck's notes are cut out here (lib/page-content.ts).
  const content = buildContent(parsed.data);
  const html = content.html;

  const { response: invalid, ent } = await rejectInvalidHtml(c, html);
  if (invalid !== null) return invalid;

  const resolvedTitle = capTitle(title) ?? capTitle(content.title) ?? capTitle(extractTitle(html));

  const origin = new URL(c.req.url).origin;
  const user = c.get('user');

  // Anonymous publishes (create or update) are screened for spam.
  // Signed-in publishers are accountable and skip the filter.
  if (user === null) {
    const verdict = detectSpam(html, resolvedTitle);
    if (verdict.spam) {
      console.log({ event: "spam_rejected", route: "api_publish", reason: verdict.reason });
      return spamRejected(c);
    }
  }

  // Update path: update_token + id provided
  if (typeof update_token === "string" && typeof existingId === "string") {
    const page = await pageFor(c, existingId, "publish_update");
    if (page instanceof Response) return page;
    const creds = { ownerId: page.row.ownerId, tokenHash: page.row.tokenHash };

    const valid = await verifyToken(update_token, creds.tokenHash);
    if (!valid) return invalidToken(c);
    const refusal = await replaceRefusal(c, page);
    if (refusal !== null) return refusal;

    // An anonymous page is screened on update whoever sends it, so a clean
    // page can't be swapped for spam (as PUT does).
    if (user !== null && creds.ownerId === null) {
      const verdict = detectSpam(html, resolvedTitle);
      if (verdict.spam) {
        console.log({ event: "spam_rejected", route: "api_publish_update", reason: verdict.reason });
        return spamRejected(c);
      }
    }

    const { metadata: updated, expiresAt, htmlEtag, version } = await updatePage(c.env, page, html, resolvedTitle, Date.now(), content.sidecar, authorOf(c, true, message));

    // Link-preview screenshot, after the response (lib/og-render.ts).
    c.executionCtx.waitUntil(refreshShot(c.env, existingId, updated, html, htmlEtag, { replacing: true }));

    return c.json({
      id: existingId,
      url: `${origin}/p/${existingId}`,
      update_token,
      expiresAt,
      ...(version !== null ? { version } : {}),
      ...contentFields(origin, existingId, content.sidecar),
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
    htmlObj = await createPage(c.env, metadata, html, now.getTime(), content.sidecar, authorOf(c, false, message));
  } catch (err) {
    if (err instanceof StorageUnavailable) {
      console.error("publish storage write failed", { id, err: err.message });
      return apiError(c, 503, "storage_unavailable", STORAGE_FULL);
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
    version: 1,
    ...contentFields(origin, id, content.sidecar),
    // Anonymous creates get a link to attach the page to an account later.
    ...(user === null ? { claim_url: claimUrl(siteOrigin(c.env), id, token) } : {}),
    ...upgradeHint(c, ent),
  });
});

// PUT /api/pages/:id — update by token (body or Bearer header) or owner JWT
api.put("/pages/:id", requireCsrfHeader, async (c) => {
  const id = c.req.param("id") ?? "";

  const json = await readJson(c);
  if (json instanceof Response) return json;
  const parsed = parseBody(updateBody, json.body);
  if (!parsed.ok) return invalidInput(c, parsed.error, parsed.field);
  const { title } = parsed.data;
  const update_token = readUpdateToken(parsed.data.update_token, c.req.header("Authorization"));
  const content = buildContent(parsed.data);
  const html = content.html;

  const { response: invalid, ent } = await rejectInvalidHtml(c, html);
  if (invalid !== null) return invalid;

  const resolvedTitle = capTitle(title) ?? capTitle(content.title) ?? capTitle(extractTitle(html));

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

  if (!auth.ok) return auth.reason === "bad_token" ? invalidToken(c) : noCredential(c);
  const refusal = await replaceRefusal(c, page);
  if (refusal !== null) return refusal;

  // Anonymous pages are screened on update too, so a clean page can't be
  // swapped for spam after publishing.
  if (creds.ownerId === null) {
    const verdict = detectSpam(html, resolvedTitle);
    if (verdict.spam) {
      console.log({ event: "spam_rejected", route: "api_put", reason: verdict.reason });
      return spamRejected(c);
    }
  }

  const author = authorOf(c, auth.viaToken, parsed.data.message);
  const { metadata: updated, expiresAt, htmlEtag, version } = await updatePage(c.env, page, html, resolvedTitle, Date.now(), content.sidecar, author);

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
    ...(version !== null ? { version } : {}),
    ...contentFields(origin, id, content.sidecar),
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

/** Who is publishing or updating, for the page's history (lib/page-versions.ts). */
export function authorOf(c: Context<AppBindings>, viaToken: boolean, message?: string, restoredFrom?: number): VersionAuthor {
  return versionAuthor({ viaToken, via: c.get("via") ?? null, userAgent: c.req.header("User-Agent"), message: message ?? null, restoredFrom: restoredFrom ?? null });
}

/** null when this caller may replace the page's content; else the refusal (see replaceAllowed). */
export async function replaceRefusal(c: Context<AppBindings>, page: LoadedPage): Promise<Response | null> {
  if (page.row.ownerId === null) return null; // anonymous pages can't collect responses
  let hasResponses: boolean;
  try {
    hasResponses = await pageHasResponses(c.env.DB, page.row.id);
  } catch (err) {
    console.error("responses lookup failed before replace", { id: page.row.id, err });
    return apiError(c, 503, "unavailable", "Could not check this page. Please try again.");
  }
  const userId = c.get("user")?.id ?? null;
  return replaceAllowed({ ownerId: page.row.ownerId, userId, hasResponses }) ? null : apiError(c, 403, "owner_required", OWNER_REQUIRED_MESSAGE);
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
  return c.json({ ...pageDetails(page.row, await viewCount(c, page), siteOrigin(c.env)), ...(await kindDetails(c, id)), ...(await versionCounts(c.env.DB, id)) });
});

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

  // A new title on an anonymous page is screened with its HTML, as an
  // update would be, so a clean page can't be retitled into spam.
  if (page.row.ownerId === null && typeof change.title === "string") {
    const obj = await c.env.PAGES_BUCKET.get(`pages/${id}/index.html`);
    const verdict = detectSpam(obj === null ? "" : await obj.text(), change.title);
    if (verdict.spam) {
      console.log({ event: "spam_rejected", route: "api_patch", reason: verdict.reason });
      return spamRejected(c);
    }
  }

  const now = Date.now();
  const pinHash = typeof change.pin === "string" ? await hashPin(change.pin) : null;
  let row;
  try {
    ({ row } = await setPageOptions(c.env, page, settingsChange(change, pinHash, now), now));
  } catch (err) {
    if (err instanceof PageGone) return apiError(c, 404, "not_found", "Page not found");
    console.error("page options write failed", { id, err });
    return apiError(c, 503, "unavailable", "Could not change this page's settings. Please try again.");
  }
  return c.json({ ...pageDetails(row, await viewCount(c, page), siteOrigin(c.env)), changed: changedSettings(change) });
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
  if (metadata.pin === null) {
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
