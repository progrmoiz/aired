import { Hono, type Context } from "hono";
import type { AppBindings } from "../types.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { requireCsrfHeader } from "../middleware/csrf.js";
import { TIERS } from "../lib/rate-limit-tiers.js";
import { apiError } from "../lib/errors.ts";
import { siteOrigin } from "../lib/origin.ts";
import { getEntitlements } from "../lib/entitlements.js";
import { refreshShot } from "../lib/og-render.js";
import { updatePage, type LoadedPage } from "../lib/page-write.ts";
import { contentFields, kindOf, readSidecar } from "../lib/page-content.ts";
import {
  getVersion,
  listVersions,
  nextVersionNumber,
  readVersionContent,
  versionOut,
  type PageVersion,
} from "../lib/page-versions.ts";
import { ALWAYS_KEEP, MESSAGE_MAX, retentionText, VERSION_LIMITS } from "../lib/version-limits.ts";
import { authorOf, ownerAccess, pageFor, replaceRefusal, sentUpdateToken } from "./api.ts";

/**
 * Page history, beside the page routes in api.ts (lib/page-versions.ts):
 * - GET  /api/pages/:id/versions              every version kept, newest first, and what the plan keeps
 * - GET  /api/pages/:id/versions/:n           one version, with its HTML (and Markdown or deck source)
 * - POST /api/pages/:id/versions/:n/restore   make version n's content the live one, as a new version
 *
 * Owner means the page's update token or its signed-in owner (session, CLI
 * sign-in, API key or OAuth), as for get_page (ownerAccess); anyone else
 * gets the same refusal whether or not the version exists. A restore
 * replaces the page's content, so a page that has collected responses
 * needs its signed-in owner (replaceRefusal), as for any update.
 */
const versions = new Hono<AppBindings>();

const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const VERSION_N = /^[1-9][0-9]{0,8}$/;

/** The page, once its id is well formed, it exists and the caller is its owner; else the error to answer. */
async function ownedPage(c: Context<AppBindings>, route: string, bodyToken?: unknown): Promise<{ page: LoadedPage; viaToken: boolean } | Response> {
  const id = c.req.param("id") ?? "";
  if (!PAGE_ID.test(id)) return apiError(c, 404, "not_found", "Page not found");
  const page = await pageFor(c, id, route);
  if (page instanceof Response) return page;
  const access = await ownerAccess(c, page, sentUpdateToken(c, bodyToken));
  if (!access.ok) return apiError(c, access.status, access.code, access.error);
  return { page, viaToken: access.viaToken };
}

/** The version number in the path, or null. */
function versionParam(c: Context<AppBindings>): number | null {
  const n = c.req.param("n") ?? "";
  return VERSION_N.test(n) ? Number(n) : null;
}

/**
 * The page's versions, with the live one first. A page published before
 * history was kept (or whose first row failed) has no live row yet: it's
 * listed from the page row, with the number its first update will give it.
 */
async function versionsOf(c: Context<AppBindings>, page: LoadedPage): Promise<PageVersion[]> {
  const rows = await listVersions(c.env.DB, page.row.id);
  if (rows.some((v) => v.current)) return rows;
  const sidecar = await readSidecar(c.env.PAGES_BUCKET, page.row.id).catch(() => null);
  const live: PageVersion = {
    pageId: page.row.id,
    version: await nextVersionNumber(c.env.DB, page.row.id),
    current: true,
    objectKey: null,
    hasSidecar: sidecar !== null,
    size: page.row.size,
    title: page.row.title,
    kind: kindOf(sidecar),
    actor: "unknown",
    client: null,
    message: null,
    restoredFrom: null,
    createdAt: null,
    replacedAt: null,
    keepUntil: null,
  };
  return [live, ...rows];
}

const historyUnavailable = (c: Context<AppBindings>) => apiError(c, 503, "unavailable", "Could not read this page's history. Please try again.");

// GET /api/pages/:id/versions — the history: live version first, then the
// kept ones, newest first. No HTML: fetch one version for that.
versions.get("/pages/:id/versions", rateLimit(TIERS.versions), async (c) => {
  const owned = await ownedPage(c, "versions");
  if (owned instanceof Response) return owned;
  const { page } = owned;
  let list: PageVersion[];
  try {
    list = await versionsOf(c, page);
  } catch (err) {
    console.error("versions list failed", { id: page.row.id, err });
    return historyUnavailable(c);
  }
  const plan = (await getEntitlements(c.env, page.row.ownerId)).plan === "pro" ? "pro" : "free";
  const limits = VERSION_LIMITS[plan];
  return c.json({
    id: page.row.id,
    url: `${siteOrigin(c.env)}/p/${page.row.id}`,
    current: list.find((v) => v.current)?.version ?? null,
    versions: list.map(versionOut),
    kept: { plan, versions: limits.versions, days: limits.days, always_keep: ALWAYS_KEEP, summary: `This page keeps ${retentionText(plan)}.` },
  });
});

// GET /api/pages/:id/versions/:n — one version and its HTML, for its owner.
// The HTML is data here, never served as a page: the dashboard shows it in
// a sandboxed frame.
versions.get("/pages/:id/versions/:n", rateLimit(TIERS.versions), async (c) => {
  const owned = await ownedPage(c, "version");
  if (owned instanceof Response) return owned;
  const { page } = owned;
  const n = versionParam(c);
  if (n === null) return apiError(c, 404, "version_not_found", "That isn't a version number.");
  let v: PageVersion | null;
  let content: Awaited<ReturnType<typeof readVersionContent>>;
  try {
    v = (await versionsOf(c, page)).find((x) => x.version === n) ?? null;
    content = v === null ? null : await readVersionContent(c.env.PAGES_BUCKET, v);
  } catch (err) {
    console.error("version read failed", { id: page.row.id, n, err });
    return historyUnavailable(c);
  }
  if (v === null) return apiError(c, 404, "version_not_found", `Version ${n} isn't in this page's history.`);
  if (content === null) return apiError(c, 410, "version_gone", `Version ${n}'s content is no longer stored.`);
  c.header("Cache-Control", "private, no-store");
  return c.json({
    id: page.row.id,
    url: `${siteOrigin(c.env)}/p/${page.row.id}`,
    ...versionOut(v),
    html: content.html,
    format: content.sidecar?.format ?? "html",
    source: content.sidecar?.source ?? content.html,
  });
});

// POST /api/pages/:id/versions/:n/restore — version n's content goes live
// again as a new version (history is never rewritten). Body, optional:
// { update_token?, message? }.
versions.post("/pages/:id/versions/:n/restore", requireCsrfHeader, rateLimit(TIERS.page_options), async (c) => {
  let body: Record<string, unknown> = {};
  const raw = await c.req.text();
  if (raw.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return apiError(c, 400, "invalid_input", "Request body must be a JSON object");
      body = parsed as Record<string, unknown>;
    } catch {
      return apiError(c, 400, "invalid_json", "Invalid JSON body");
    }
  }
  if (body.message !== undefined && body.message !== null && (typeof body.message !== "string" || body.message.length > MESSAGE_MAX)) {
    return apiError(c, 400, "invalid_input", `message must be a string of at most ${MESSAGE_MAX} characters`, { field: "message" });
  }
  const message = typeof body.message === "string" ? body.message : undefined;

  const owned = await ownedPage(c, "restore", body.update_token);
  if (owned instanceof Response) return owned;
  const { page, viaToken } = owned;
  const n = versionParam(c);
  if (n === null) return apiError(c, 404, "version_not_found", "That isn't a version number.");
  // A page with collected responses: its signed-in owner only, as for PUT.
  const refusal = await replaceRefusal(c, page);
  if (refusal !== null) return refusal;

  let v: PageVersion | null;
  let content: Awaited<ReturnType<typeof readVersionContent>>;
  try {
    v = await getVersion(c.env.DB, page.row.id, n);
    content = v === null || v.current ? null : await readVersionContent(c.env.PAGES_BUCKET, v);
  } catch (err) {
    console.error("version read failed before restore", { id: page.row.id, n, err });
    return historyUnavailable(c);
  }
  if (v === null) return apiError(c, 404, "version_not_found", `Version ${n} isn't in this page's history.`);
  if (v.current) return apiError(c, 409, "already_current", `Version ${n} is already the live version.`);
  if (content === null) return apiError(c, 410, "version_gone", `Version ${n}'s content is no longer stored.`);

  const id = page.row.id;
  const author = authorOf(c, viaToken, message, n);
  const { metadata, expiresAt, htmlEtag, version } = await updatePage(c.env, page, content.html, v.title, Date.now(), content.sidecar, author);
  c.executionCtx.waitUntil(refreshShot(c.env, id, metadata, content.html, htmlEtag, { replacing: true }));
  const origin = siteOrigin(c.env);
  return c.json({
    id,
    url: `${origin}/p/${id}`,
    version,
    restored_from: n,
    expiresAt,
    ...contentFields(origin, id, content.sidecar),
  });
});

export { versions };
