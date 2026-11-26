import puppeteer from "@cloudflare/puppeteer";
import type { Browser } from "@cloudflare/puppeteer";
import { PAGE_CSP } from "../middleware/security.js";
import { SANDBOX_SHIM, injectEarlyScript } from "./sandbox-shim.js";
import {
  LOAD_TIMEOUT_MS,
  RENDER_TIMEOUT_MS,
  SHOT_CONTENT_TYPE,
  SHOT_HEIGHT,
  SHOT_QUALITY,
  SHOT_WIDTH,
  blockAfterError,
  budgetAllows,
  dailyBudgetMs,
  shotAllowed,
  shotKey,
  utcDay,
  type BudgetState,
  type ShotPage,
} from "./og-shot.js";

/**
 * Takes a page's link-preview screenshot with Cloudflare Browser Rendering
 * (rules in og-shot.ts). Runs in waitUntil after a publish or update, never
 * in the response path, and never throws.
 *
 * The browser renders the stored HTML, not /p/:id, so no view is counted.
 * It's served to the browser at the page's own URL with the viewer's sandbox
 * CSP and storage shim, so it draws as a visitor would see it (minus the
 * badge), and every other request to aired.sh is blocked: an embedded aired
 * page would otherwise count a view.
 */

export type ShotEnv = {
  BROWSER?: Fetcher;
  PAGES_BUCKET: R2Bucket;
  DB: D1Database;
  OG_SHOT_DAILY_SECONDS?: string;
};

const BUDGET_ROW = "browser";
const PAGE_ORIGIN = "https://aired.sh";

export async function refreshShot(
  env: ShotEnv,
  id: string,
  page: ShotPage,
  html: string,
  /** The stored HTML's R2 etag; null (no object came back) skips the shot. */
  htmlEtag: string | null,
  opts: { replacing: boolean },
): Promise<void> {
  try {
    // An update drops the old screenshot first: until the new one lands (or
    // if it never does) the card shows, never the old page.
    if (opts.replacing) await env.PAGES_BUCKET.delete(shotKey(id));
    if (env.BROWSER === undefined || htmlEtag === null || !shotAllowed(page, Date.now())) return;

    const cap = dailyBudgetMs(env.OG_SHOT_DAILY_SECONDS);
    if (!budgetAllows(await readBudget(env.DB), Date.now(), cap)) {
      console.log({ event: "og_shot_skipped", id, reason: "budget" });
      return;
    }

    const started = Date.now();
    let browser: Browser;
    try {
      browser = await puppeteer.launch(env.BROWSER);
    } catch (err) {
      const until = blockAfterError(String(err), Date.now());
      if (until !== null) await setBlocked(env.DB, until);
      console.log({ event: "og_shot_skipped", id, reason: until !== null ? "limit" : "launch", err: String(err) });
      return;
    }

    let image: Uint8Array | null = null;
    try {
      image = await withTimeout(capture(browser, id, html), RENDER_TIMEOUT_MS);
    } catch (err) {
      console.log({ event: "og_shot_failed", id, err: String(err) });
    } finally {
      await browser.close().catch(() => {});
    }
    const ms = Date.now() - started;
    await addSpent(env.DB, ms, Date.now()).catch((err) => console.error("og shot budget write failed", { id, err: String(err) }));
    if (image === null) return;

    // The page may have been updated or deleted while the browser ran.
    const current = await env.PAGES_BUCKET.head(`pages/${id}/index.html`);
    if (current === null || current.etag !== htmlEtag) return;
    await env.PAGES_BUCKET.put(shotKey(id), image, {
      httpMetadata: { contentType: SHOT_CONTENT_TYPE },
      customMetadata: { html: htmlEtag },
    });
    console.log({ event: "og_shot", id, ms, bytes: image.byteLength });
  } catch (err) {
    console.error("og shot failed", { id, err: String(err) });
  }
}

async function capture(browser: Browser, id: string, html: string): Promise<Uint8Array> {
  const page = await browser.newPage();
  await page.setViewport({ width: SHOT_WIDTH, height: SHOT_HEIGHT, deviceScaleFactor: 1 });
  page.on("dialog", (d) => {
    d.dismiss().catch(() => {});
  });

  const url = `${PAGE_ORIGIN}/p/${encodeURIComponent(id)}`;
  const body = injectEarlyScript(html, SANDBOX_SHIM);
  let served = false;
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const target = req.url();
    if (!served && target === url && req.isNavigationRequest()) {
      served = true;
      req
        .respond({
          status: 200,
          headers: { "Content-Security-Policy": PAGE_CSP },
          contentType: "text/html; charset=utf-8",
          body,
        })
        .catch(() => {});
      return;
    }
    // The page can't leave (a redirect would screenshot someone else's
    // site) and can't reach aired.sh (an embedded page would count a view).
    const leaving = req.isNavigationRequest() && req.frame() === page.mainFrame();
    if (leaving || isAired(target)) {
      req.abort().catch(() => {});
      return;
    }
    req.continue().catch(() => {});
  });

  // A slow image or font shouldn't cost the screenshot: shoot what loaded.
  await page.goto(url, { waitUntil: "load", timeout: LOAD_TIMEOUT_MS }).catch(() => {});
  await page
    // A string, so it runs in the page (this file has no DOM types).
    .evaluate("Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(() => true)")
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  const shot = await page.screenshot({ type: "jpeg", quality: SHOT_QUALITY });
  return shot as Uint8Array;
}

function isAired(target: string): boolean {
  try {
    const host = new URL(target).hostname;
    return host === "aired.sh" || host.endsWith(".aired.sh");
  } catch {
    return false;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`render took over ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** The budget row, or null when there's none yet. A D1 error skips the shot. */
async function readBudget(db: D1Database): Promise<BudgetState | null> {
  const row = await db
    .prepare("SELECT day, spent_ms, blocked_until FROM og_shot_budget WHERE name = ?")
    .bind(BUDGET_ROW)
    .first<{ day: string; spent_ms: number; blocked_until: number }>();
  return row === null ? null : { day: row.day, spentMs: row.spent_ms, blockedUntil: row.blocked_until };
}

async function addSpent(db: D1Database, ms: number, nowMs: number): Promise<void> {
  await db
    .prepare(
      "INSERT INTO og_shot_budget (name, day, spent_ms, blocked_until) VALUES (?, ?, ?, 0) " +
        "ON CONFLICT (name) DO UPDATE SET spent_ms = CASE WHEN og_shot_budget.day = excluded.day " +
        "THEN og_shot_budget.spent_ms + excluded.spent_ms ELSE excluded.spent_ms END, day = excluded.day",
    )
    .bind(BUDGET_ROW, utcDay(nowMs), ms)
    .run();
}

async function setBlocked(db: D1Database, until: number): Promise<void> {
  await db
    .prepare(
      "INSERT INTO og_shot_budget (name, day, spent_ms, blocked_until) VALUES (?, ?, 0, ?) " +
        "ON CONFLICT (name) DO UPDATE SET blocked_until = MAX(og_shot_budget.blocked_until, excluded.blocked_until)",
    )
    .bind(BUDGET_ROW, utcDay(Date.now()), until)
    .run();
}
