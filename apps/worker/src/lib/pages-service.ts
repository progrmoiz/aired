import type { Context } from "hono";
import type { AppBindings } from "../types.js";
import {
  capTitle,
  extractTitle,
  generateId,
  generateToken,
  hashToken,
  normalizeProject,
  validateHtml,
  verifyToken,
  DEFAULT_TTL,
  MAX_SIZE,
  PRO_MAX_SIZE,
} from "@aired/core";
import type { PageMetadata, PublishBody, UpdateBody } from "@aired/core";
import { loadStats, saveStats } from "./stats.js";
import { detectSpam, SPAM_REJECTION } from "./spam.js";
import { claimUrl } from "./claim-url.js";
import { hashPin } from "./pin-hash.js";
import { readUpdateToken } from "./page-token.js";
import { createPage, loadPage, StorageUnavailable, updatePage, type LoadedPage } from "./page-write.ts";
import { OWNER_REQUIRED_MESSAGE, pageAccess, replaceAllowed } from "./page-options.ts";
import { pageHasResponses } from "./collect-store.ts";
import { billingEnabled, getEntitlements, planLimitError, upgradeUrl, type Entitlements } from "./entitlements.js";
import { siteOrigin } from "./origin.ts";
import { refreshShot } from "./og-render.js";
import { apiError } from "./errors.ts";
import { buildContent, contentFields, type PageContent } from "./page-content.ts";
import { versionAuthor, type VersionAuthor } from "./page-versions.ts";

/**
 * The pages service: the rules every page write and owner read follows,
 * whoever calls. The REST routes (routes/api.ts publish, PUT, PATCH, DELETE
 * and details; the history, check, source, PDF, responses and access
 * routes) call these, and the remote MCP's tools (routes/mcp.ts) call
 * those same routes in-process, signed in or anonymous, so a rule can't
 * differ between the API and the MCP. Storage itself (D1 first, then R2,
 * then the KV cache) is lib/page-write.ts.
 *
 * Each function takes the request's context (caller, bindings, waitUntil)
 * and answers either its result or the error Response to send, in the API's
 * error shape (lib/errors.ts).
 */

type C = Context<AppBindings>;

const CREDENTIALS_UNAVAILABLE = "Could not check this page's credentials. Please try again.";
const STORAGE_FULL = "Service temporarily unavailable — storage write limit reached. Try again later.";

/**
 * The live page and the owner and token hash that count for it, from its D1
 * row (lib/page-write.ts loadPage), never from the KV record, which can be
 * written back stale. A D1 error answers 503: fail closed rather than trust
 * a possibly stale hash.
 */
export async function pageFor(c: C, id: string, route: string): Promise<LoadedPage | Response> {
  try {
    return (await loadPage(c.env, id)) ?? apiError(c, 404, "not_found", "Page not found");
  } catch (err) {
    console.error("pages lookup failed", { route, id, err });
    return apiError(c, 503, "unavailable", CREDENTIALS_UNAVAILABLE);
  }
}

/**
 * The request's JSON body, or the 400 to answer when it isn't JSON. A body
 * sent without Content-Length that runs past the size cap is rethrown, so
 * bodyLimit (middleware/api-contract.ts) answers its 413.
 */
export async function readJson(c: C): Promise<{ body: unknown } | Response> {
  try {
    return { body: await c.req.json() };
  } catch (err) {
    if (err instanceof Error && err.name === "BodyLimitError") throw err;
    return apiError(c, 400, "invalid_json", "The request body isn't valid JSON.");
  }
}

/** A body that failed its schema: `field` names the field when there is one. */
export function invalidInput(c: C, error: string, field: string | null): Response {
  return apiError(c, 400, "invalid_input", error, field !== null ? { field } : {});
}

export const invalidToken = (c: C): Response => apiError(c, 403, "invalid_token", "Invalid update token");

/**
 * No working credential for a page write (PUT, DELETE): 401 when the caller
 * sent nothing at all, 403 when they're signed in but it isn't their page.
 * Same rule as the details and PATCH routes (lib/page-options.ts pageAccess).
 */
export function noCredential(c: C): Response {
  if (c.get("user") !== null) {
    return apiError(c, 403, "not_owner", "This page isn't in your account. Use its update token instead.");
  }
  return apiError(c, 401, "token_required", "Send the page's update_token (in the body or as Authorization: Bearer <update_token>), or sign in as its owner.");
}

/** Whether a write by this caller to a page with this owner (null: anonymous, or a new page) is screened for spam. */
export function spamScreened(c: C, pageOwnerId: number | null): boolean {
  return c.get("user") === null || pageOwnerId === null;
}

/**
 * The spam screen. Signed-in publishers are accountable and skip it, except
 * on an anonymous page, so a clean page can't be swapped for spam; anonymous
 * callers are always screened. Null when the write may go ahead.
 */
export function spamRefusal(c: C, html: string, title: string | null, route: string, pageOwnerId: number | null = null): Response | null {
  if (!spamScreened(c, pageOwnerId)) return null;
  const verdict = detectSpam(html, title);
  if (!verdict.spam) return null;
  console.log({ event: "spam_rejected", route, reason: verdict.reason });
  return apiError(c, 422, "spam_rejected", SPAM_REJECTION);
}

/**
 * The update token a request carries: the body's update_token, else
 * X-Update-Token (for API key callers, whose Authorization holds the key),
 * else a non-key Bearer token.
 */
export function sentUpdateToken(c: C, bodyToken?: unknown): string | null {
  const header = c.req.header("X-Update-Token");
  if (typeof bodyToken === "string" && bodyToken !== "") return bodyToken;
  if (header !== undefined && header.trim() !== "") return header.trim();
  return readUpdateToken(undefined, c.req.header("Authorization"));
}

/** Who is publishing or updating, for the page's history (lib/page-versions.ts). */
export function authorOf(c: C, viaToken: boolean, message?: string, restoredFrom?: number): VersionAuthor {
  return versionAuthor({ viaToken, via: c.get("via") ?? null, userAgent: c.req.header("User-Agent"), message: message ?? null, restoredFrom: restoredFrom ?? null });
}

/** null when this caller may replace the page's content; else the refusal (see replaceAllowed). */
export async function replaceRefusal(c: C, page: LoadedPage): Promise<Response | null> {
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

/** The token or signed-in owner check for owner reads and settings (lib/page-options.ts pageAccess). */
export async function ownerAccess(c: C, page: LoadedPage, token: string | null) {
  return pageAccess({
    ownerId: page.row.ownerId,
    userId: c.get("user")?.id ?? null,
    tokenSent: token !== null,
    tokenMatches: token !== null && (await verifyToken(token, page.row.tokenHash)),
  });
}

/** Content ready to store: the HTML, its sidecar, the title it gets, and the caller's plan (null when anonymous). */
export type PreparedContent = { content: PageContent; html: string; title: string | null; ent: Entitlements | null };

/**
 * A publish or update's content, rendered (Markdown, decks: lib/page-content.ts)
 * and checked against the caller's plan size limit. A signed-in free user
 * whose page would fit on Pro gets a 402 upgrade prompt when billing is on;
 * everyone else gets the size error as a 400. The title is the one sent,
 * else the Markdown's, else the HTML's <title>, cut to 200 characters.
 */
export async function prepareContent(c: C, data: PublishBody | UpdateBody): Promise<PreparedContent | Response> {
  const content = buildContent(data);
  const html = content.html;
  const user = c.get("user");
  const ent = user !== null ? await getEntitlements(c.env, user.id) : null;
  const maxBytes = ent !== null ? ent.maxBytes : MAX_SIZE;
  const validation = validateHtml(html, maxBytes);
  if (!validation.ok) {
    if (ent !== null && ent.plan === "free" && billingEnabled(c.env)) {
      const size = new TextEncoder().encode(html).byteLength;
      if (size > maxBytes && size <= PRO_MAX_SIZE) return c.json(planLimitError("page_size", siteOrigin(c.env)), 402);
    }
    return apiError(c, 400, "invalid_html", validation.error);
  }
  const title = capTitle(data.title) ?? capTitle(content.title) ?? capTitle(extractTitle(html));
  return { content, html, title, ent };
}

/**
 * The `upgrade` key for a successful publish/update response: only a signed-in
 * free-plan caller with billing on sees the offer to remove the badge.
 */
function upgradeHint(c: C, ent: Entitlements | null): { upgrade: { reason: "badge"; url: string } } | Record<string, never> {
  if (ent === null || ent.plan !== "free" || !billingEnabled(c.env)) return {};
  return { upgrade: { reason: "badge", url: upgradeUrl(siteOrigin(c.env), "publish") } };
}

/**
 * A new page from a publish: its id and update token, its expiry (signed-in
 * publishers default to permanent; an explicit `permanent: false` or a `ttl`
 * opts back into expiring), PIN hash and view limit, then storage. Answers
 * the publish response.
 */
export async function createFromPublish(c: C, data: PublishBody, prepared: PreparedContent, route: string): Promise<Response> {
  const spam = spamRefusal(c, prepared.html, prepared.title, route);
  if (spam !== null) return spam;
  const { ttl, pin, reads, permanent, project, message } = data;
  const { content, html, ent } = prepared;
  const user = c.get("user");
  const origin = new URL(c.req.url).origin;

  const id = generateId();
  const token = generateToken();
  const tokenHash = await hashToken(token);
  const isPermanent = permanent === true || (permanent !== false && (typeof ttl !== "number" || ttl <= 0) && user !== null);
  const ttlSeconds = isPermanent ? null : typeof ttl === "number" && ttl > 0 ? Math.floor(ttl) : DEFAULT_TTL;
  const now = new Date();
  const expiresAt = ttlSeconds !== null ? new Date(now.getTime() + ttlSeconds * 1000).toISOString() : null;

  const metadata: PageMetadata = {
    id,
    title: prepared.title,
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

  // The publish counter and the link-preview screenshot, after the response (lib/og-render.ts).
  c.executionCtx.waitUntil(
    (async () => {
      const stats = await loadStats(c.env.PAGES_KV);
      stats.publishes += 1;
      await saveStats(c.env.PAGES_KV, stats);
    })().catch(() => {}),
  );
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
}

/**
 * New content for a page the caller may write (by its update token or as
 * its signed-in owner, checked by the route): the responses rule, the spam
 * screen, then storage, keeping what it replaces as a version. Both ways of
 * updating answer through this: POST /api/publish with id and update_token,
 * and PUT /api/pages/:id. `token` is the update token used, echoed back;
 * null when the signed-in owner wrote without one.
 */
export async function replaceContent(
  c: C,
  page: LoadedPage,
  prepared: PreparedContent,
  opts: { token: string | null; message?: string; route: string },
): Promise<Response> {
  const refusal = await replaceRefusal(c, page);
  if (refusal !== null) return refusal;
  const spam = spamRefusal(c, prepared.html, prepared.title, opts.route, page.row.ownerId);
  if (spam !== null) return spam;

  const id = page.row.id;
  const { content, html } = prepared;
  const author = authorOf(c, opts.token !== null, opts.message);
  const { metadata: updated, expiresAt, htmlEtag, version } = await updatePage(c.env, page, html, prepared.title, Date.now(), content.sidecar, author);
  // Link-preview screenshot, after the response (lib/og-render.ts).
  c.executionCtx.waitUntil(refreshShot(c.env, id, updated, html, htmlEtag, { replacing: true }));

  const origin = new URL(c.req.url).origin;
  return c.json({
    id,
    url: `${origin}/p/${id}`,
    ...(opts.token !== null ? { update_token: opts.token } : {}),
    expiresAt,
    ...(version !== null ? { version } : {}),
    ...contentFields(origin, id, content.sidecar),
    ...upgradeHint(c, prepared.ent),
  });
}
