import { Hono, type Context } from "hono";
import type { AppBindings } from "../types.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { requireCsrfHeader } from "../middleware/csrf.js";
import { TIERS } from "../lib/rate-limit-tiers.js";
import { underBurstLimit } from "../lib/burst-limit.js";
import { siteOrigin } from "../lib/origin.ts";
import { loadPage } from "../lib/page-write.ts";
import { checkPage, deleteCheckShots } from "../lib/og-render.js";
import { buildReport, CheckUnavailable, CHECK_SHOT_TTL_MS, checkShotKey, parseViewport, SHOT_URL_KEY, shotUnexpired, type CheckCaller } from "../lib/page-check.ts";
import { ownerAccess, pageFor, sentUpdateToken } from "../lib/pages-service.ts";
import { hashToHex } from "@aired/core";
import { apiError } from "../lib/errors.ts";
import { kindOf, readSidecar } from "../lib/page-content.ts";
import { versionCounts } from "../lib/page-versions.ts";

/**
 * Owner tools for one page, beside the page routes in api.ts:
 * - POST /api/pages/:id/check: check_page and `aired check` (lib/page-check.ts).
 * - GET /api/pages/:id/check.jpg?k=…: that check's screenshot, for 24 hours.
 * - GET /api/pages/:id/source: the page's HTML and what was published
 *   (Markdown, a deck's notes), for its owner (MCP resources, get_page
 *   include_source, `aired pull`).
 * Owner means the page's update token or its signed-in owner (session, API
 * key or OAuth), as for get_page; anyone else is refused.
 */
const pageTools = new Hono<AppBindings>();

const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Who a check counts against (per-minute guard and daily share): the account, else the IP. */
async function checkCaller(c: Context<AppBindings>): Promise<CheckCaller> {
  const user = c.get("user");
  if (user) return { key: `u:${user.id}`, signedIn: true };
  return { key: `ip:${await hashToHex(c.req.header("CF-Connecting-IP") ?? "unknown", 16)}`, signedIn: false };
}

const UNAVAILABLE: Record<CheckUnavailable["reason"], { status: 429 | 503; code: string; error: string }> = {
  budget: { status: 429, code: "check_budget", error: "Page checks have used today's browser time (yours or everyone's). They start again at 00:00 UTC." },
  busy: { status: 503, code: "check_busy", error: "The browser is busy. Try again after Retry-After seconds." },
  storage: { status: 503, code: "check_unavailable", error: "Couldn't read the check budget. Try again shortly." },
  no_browser: { status: 503, code: "check_unavailable", error: "Page checks aren't available on this server." },
};

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function randomKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// POST /api/pages/:id/check — render the page in a browser and report console
// errors, files that didn't load, a blank screen and heavy pages, with a
// screenshot. Body: { update_token?, viewport?: "desktop" | "mobile",
// inline_screenshot?: boolean }.
pageTools.post("/pages/:id/check", requireCsrfHeader, rateLimit(TIERS.page_check), async (c) => {
  const id = c.req.param("id") ?? "";
  if (!PAGE_ID.test(id)) return apiError(c, 404, "not_found", "Page not found");
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
  const viewport = parseViewport(body.viewport);
  if (viewport === null) return apiError(c, 400, "invalid_input", 'viewport must be "desktop" or "mobile"', { field: "viewport" });

  const page = await pageFor(c, id, "check");
  if (page instanceof Response) return page;
  const access = await ownerAccess(c, page, sentUpdateToken(c, body.update_token));
  if (!access.ok) return apiError(c, access.status, access.code, access.error);

  // Browser Rendering allows one new browser every few seconds: a few checks a minute per caller.
  const caller = await checkCaller(c);
  if (!(await underBurstLimit(c.env.CHECK_BURST, caller.key))) {
    c.header("Retry-After", "60");
    return apiError(c, 429, "rate_limited", "Too many checks. Wait a minute and try again.");
  }

  const obj = await c.env.PAGES_BUCKET.get(`pages/${id}/index.html`);
  if (obj === null) return apiError(c, 404, "not_found", "Page not found");
  const html = await obj.text();

  let result: Awaited<ReturnType<typeof checkPage>>;
  try {
    result = await checkPage(c.env, id, html, viewport, caller);
  } catch (err) {
    if (err instanceof CheckUnavailable) {
      if (err.waitSeconds !== null) c.header("Retry-After", String(err.waitSeconds));
      const u = UNAVAILABLE[err.reason];
      return apiError(c, u.status, u.code, u.error);
    }
    console.error("page check failed", { id, err: String(err) });
    return apiError(c, 502, "check_failed", "The check didn't finish. Try again; if it keeps failing, the page may hang the browser.");
  }

  const now = Date.now();
  const origin = siteOrigin(c.env);
  let screenshotUrl: string | null = null;
  if (result.screenshot !== null) {
    try {
      // The page may have been updated while the browser ran: don't keep a picture of the old version.
      const current = await c.env.PAGES_BUCKET.head(`pages/${id}/index.html`);
      if (current !== null && current.etag === obj.etag) {
        const key = randomKey();
        // One object per check, named by a hash of the URL key: earlier links keep working, and storage never holds the key.
        await c.env.PAGES_BUCKET.put(checkShotKey(id, await hashToHex(key, 32)), result.screenshot, {
          httpMetadata: { contentType: "image/jpeg" },
          customMetadata: { expires: String(now + CHECK_SHOT_TTL_MS) },
        });
        screenshotUrl = `${origin}/api/pages/${encodeURIComponent(id)}/check.jpg?k=${key}`;
        await deleteCheckShots(c.env.PAGES_BUCKET, id, (o) => now - o.uploaded.getTime() > CHECK_SHOT_TTL_MS);
      }
    } catch (err) {
      console.error("page check screenshot write failed", { id, err: String(err) });
    }
  }

  const report = buildReport({
    id,
    url: `${origin}/p/${id}`,
    viewport,
    htmlBytes: new TextEncoder().encode(html).byteLength,
    obs: result.obs,
    now,
    screenshotUrl,
  });
  console.log({ event: "page_check", id, ok: report.ok, issues: report.issues.map((i) => i.code), ms: report.load_ms });
  const inline = body.inline_screenshot === true && result.screenshot !== null ? { screenshot_base64: base64(result.screenshot) } : {};
  return c.json({ ...report, ...inline });
});

// GET /api/pages/:id/check.jpg?k=… — a check's screenshot. The key in the
// URL is the credential (only the owner got it), so it works in a browser
// or an agent's image fetch. It stops working after 24 hours, or when the
// page is updated or deleted. The key is looked up by its hash, so a wrong
// one costs one R2 read and no D1 read.
pageTools.get("/pages/:id/check.jpg", async (c) => {
  const id = c.req.param("id") ?? "";
  const sent = c.req.query("k") ?? "";
  if (!PAGE_ID.test(id) || !SHOT_URL_KEY.test(sent)) return apiError(c, 404, "not_found", "Not found");
  const obj = await c.env.PAGES_BUCKET.get(checkShotKey(id, await hashToHex(sent, 32)));
  if (obj === null || !shotUnexpired(obj.customMetadata?.expires, Date.now())) return apiError(c, 404, "not_found", "Not found");
  let live: Awaited<ReturnType<typeof loadPage>>;
  try {
    live = await loadPage(c.env, id);
  } catch {
    return apiError(c, 503, "unavailable", "Try again");
  }
  if (live === null) return apiError(c, 404, "not_found", "Not found");
  return new Response(obj.body, {
    headers: {
      "Content-Type": "image/jpeg",
      // Never kept: the link must stop working when the page is updated or deleted.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  });
});

// GET /api/pages/:id/source — the page's HTML and title for its owner (the
// MCP page resources). Never counts a view and ignores the PIN: only the
// owner gets here.
pageTools.get("/pages/:id/source", rateLimit(TIERS.page_options), async (c) => {
  const id = c.req.param("id") ?? "";
  if (!PAGE_ID.test(id)) return apiError(c, 404, "not_found", "Page not found");
  const page = await pageFor(c, id, "source");
  if (page instanceof Response) return page;
  const access = await ownerAccess(c, page, sentUpdateToken(c));
  if (!access.ok) return apiError(c, access.status, access.code, access.error);
  const [obj, sidecar, counts] = await Promise.all([
    c.env.PAGES_BUCKET.get(`pages/${id}/index.html`),
    readSidecar(c.env.PAGES_BUCKET, id).catch(() => null),
    versionCounts(c.env.DB, id),
  ]);
  if (obj === null) return apiError(c, 404, "not_found", "Page not found");
  const html = await obj.text();
  // `html` is the page as served; `source` what was published (Markdown, or a
  // deck's HTML with its speaker notes), with the notes on their own.
  return c.json({
    id,
    url: `${siteOrigin(c.env)}/p/${id}`,
    title: page.row.title,
    size: page.row.size,
    html,
    kind: kindOf(sidecar),
    format: sidecar?.format ?? "html",
    source: sidecar?.source ?? html,
    ...(sidecar?.kind === "deck" ? { slides: sidecar.slides, notes: sidecar.notes } : {}),
    // The live version this source is, so an agent that pulls it, edits and
    // updates can tell (with aired versions) whether someone updated it since.
    ...(counts.version !== undefined ? { version: counts.version } : {}),
  });
});

export { pageTools };
