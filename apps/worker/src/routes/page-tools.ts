import { Hono, type Context } from "hono";
import type { AppBindings } from "../types.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { requireCsrfHeader } from "../middleware/csrf.js";
import { TIERS } from "../lib/rate-limit-tiers.js";
import { underBurstLimit } from "../lib/burst-limit.js";
import { siteOrigin } from "../lib/origin.ts";
import { loadPage } from "../lib/page-write.ts";
import { checkPage } from "../lib/og-render.js";
import { buildReport, CheckUnavailable, CHECK_SHOT_TTL_MS, checkShotKey, parseViewport, shotKeyValid } from "../lib/page-check.ts";
import { ownerAccess, pageFor, sentUpdateToken } from "./api.ts";
import { hashToHex } from "@aired/core";

/**
 * Owner tools for one page, beside the page routes in api.ts:
 * - POST /api/pages/:id/check: check_page and `aired check` (lib/page-check.ts).
 * - GET /api/pages/:id/check.jpg?k=…: that check's screenshot, for 24 hours.
 * - GET /api/pages/:id/source: the page's HTML, for its owner (MCP resources).
 * Owner means the page's update token or its signed-in owner (session, API
 * key or OAuth), as for get_page; anyone else is refused.
 */
const pageTools = new Hono<AppBindings>();

const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Who a check counts against for the per-minute guard: the account, else the IP. */
async function callerKey(c: Context<AppBindings>): Promise<string> {
  const user = c.get("user");
  if (user) return `u:${user.id}`;
  return `ip:${await hashToHex(c.req.header("CF-Connecting-IP") ?? "unknown", 16)}`;
}

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
  if (!PAGE_ID.test(id)) return c.json({ error: "Page not found" }, 404);
  let body: Record<string, unknown> = {};
  const raw = await c.req.text();
  if (raw.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return c.json({ error: "Request body must be a JSON object" }, 400);
      body = parsed as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
  }
  const viewport = parseViewport(body.viewport);
  if (viewport === null) return c.json({ error: 'viewport must be "desktop" or "mobile"' }, 400);

  const page = await pageFor(c, id, "check");
  if (page instanceof Response) return page;
  const access = await ownerAccess(c, page, sentUpdateToken(c, body.update_token));
  if (!access.ok) return c.json({ error: access.error }, access.status);

  // Browser Rendering allows one new browser every few seconds: a few checks a minute per caller.
  if (!(await underBurstLimit(c.env.CHECK_BURST, await callerKey(c)))) {
    c.header("Retry-After", "60");
    return c.json({ error: "Too many checks. Wait a minute and try again." }, 429);
  }

  const obj = await c.env.PAGES_BUCKET.get(`pages/${id}/index.html`);
  if (obj === null) return c.json({ error: "Page not found" }, 404);
  const html = await obj.text();

  let result: Awaited<ReturnType<typeof checkPage>>;
  try {
    result = await checkPage(c.env, id, html, viewport);
  } catch (err) {
    if (err instanceof CheckUnavailable) {
      if (err.waitSeconds !== null) c.header("Retry-After", String(err.waitSeconds));
      const error =
        err.reason === "budget"
          ? "Page checks have used today's browser time. They start again at 00:00 UTC."
          : err.reason === "busy"
            ? "The browser is busy. Try again in a minute."
            : "Page checks aren't available on this server.";
      return c.json({ error, code: err.reason === "budget" ? "check_budget" : err.reason === "busy" ? "check_busy" : "check_unavailable" }, err.reason === "budget" ? 429 : 503);
    }
    console.error("page check failed", { id, err: String(err) });
    return c.json({ error: "The check didn't finish. Try again; if it keeps failing, the page may hang the browser." }, 502);
  }

  const now = Date.now();
  const origin = siteOrigin(c.env);
  let screenshotUrl: string | null = null;
  if (result.screenshot !== null) {
    const key = randomKey();
    try {
      await c.env.PAGES_BUCKET.put(checkShotKey(id), result.screenshot, {
        httpMetadata: { contentType: "image/jpeg" },
        customMetadata: { key, expires: String(now + CHECK_SHOT_TTL_MS) },
      });
      screenshotUrl = `${origin}/api/pages/${encodeURIComponent(id)}/check.jpg?k=${key}`;
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

// GET /api/pages/:id/check.jpg?k=… — the last check's screenshot. The key in
// the URL is the credential (only the owner got it), so it works in a
// browser or an agent's image fetch; it stops working after 24 hours, when
// the page is checked again, updated or deleted.
pageTools.get("/pages/:id/check.jpg", async (c) => {
  const id = c.req.param("id") ?? "";
  if (!PAGE_ID.test(id)) return c.json({ error: "Not found" }, 404);
  const sent = c.req.query("k");
  if (typeof sent !== "string" || sent.length < 16) return c.json({ error: "Not found" }, 404);
  let live: Awaited<ReturnType<typeof loadPage>>;
  try {
    live = await loadPage(c.env, id);
  } catch {
    return c.json({ error: "Try again" }, 503);
  }
  if (live === null) return c.json({ error: "Not found" }, 404);
  const obj = await c.env.PAGES_BUCKET.get(checkShotKey(id));
  if (obj === null || !shotKeyValid(sent, obj.customMetadata?.key, obj.customMetadata?.expires, Date.now())) {
    return c.json({ error: "Not found" }, 404);
  }
  return new Response(obj.body, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=3600",
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
  if (!PAGE_ID.test(id)) return c.json({ error: "Page not found" }, 404);
  const page = await pageFor(c, id, "source");
  if (page instanceof Response) return page;
  const access = await ownerAccess(c, page, sentUpdateToken(c));
  if (!access.ok) return c.json({ error: access.error }, access.status);
  const obj = await c.env.PAGES_BUCKET.get(`pages/${id}/index.html`);
  if (obj === null) return c.json({ error: "Page not found" }, 404);
  const html = await obj.text();
  return c.json({ id, url: `${siteOrigin(c.env)}/p/${id}`, title: page.row.title, size: page.row.size, html });
});

export { pageTools };
