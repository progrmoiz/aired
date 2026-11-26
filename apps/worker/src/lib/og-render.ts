import puppeteer from "@cloudflare/puppeteer";
import type { Browser } from "@cloudflare/puppeteer";
import { PAGE_CSP } from "../middleware/security.js";
import { SANDBOX_SHIM, injectEarlyScript } from "./sandbox-shim.js";
import {
  LOAD_TIMEOUT_MS,
  PLACEHOLDER_QUALITY,
  PLACEHOLDER_SCALE,
  RENDER_TIMEOUT_MS,
  SHOT_CONTENT_TYPE,
  SHOT_HEIGHT,
  SHOT_QUALITY,
  SHOT_WIDTH,
  TILE_HEIGHT,
  TILE_QUALITY,
  blockAfterError,
  budgetAllows,
  dailyBudgetMs,
  renderAllowed,
  shotAllowed,
  shotKey,
  tileKey,
  utcDay,
  type BudgetState,
  type ShotPage,
  type ShotRow,
} from "./og-shot.js";

/**
 * Draws pages with Cloudflare Browser Rendering (rules in og-shot.ts): the
 * public link-preview screenshot, the owner's dashboard tile and its blurred
 * placeholder. Runs in waitUntil after a publish or update, or for the
 * dashboard's backfill of older pages, and never throws.
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

export type ShotJob = {
  id: string;
  page: ShotPage;
  html: string;
  /** The stored HTML's R2 etag; null (no object came back) skips the page. */
  htmlEtag: string | null;
};

const BUDGET_ROW = "browser";
const PAGE_ORIGIN = "https://aired.sh";
/** Don't start another page in a batch after this long (waitUntil has ~30 s). */
const BATCH_START_BEFORE_MS = 12_000;

/** After a publish or update. An update drops the old images first. */
export async function refreshShot(
  env: ShotEnv,
  id: string,
  page: ShotPage,
  html: string,
  htmlEtag: string | null,
  opts: { replacing: boolean },
): Promise<void> {
  try {
    // Until the new images land (or if they never do) the card and the live
    // preview show, never the old page.
    if (opts.replacing) await forgetShots(env, id);
  } catch (err) {
    console.error("og shot cleanup failed", { id, err: String(err) });
  }
  await renderShots(env, [{ id, page, html, htmlEtag }]);
}

/** Remove a page's images and its page_shots row (update, delete). */
export async function forgetShots(env: Pick<ShotEnv, "PAGES_BUCKET" | "DB">, id: string): Promise<void> {
  await Promise.all([
    env.PAGES_BUCKET.delete([shotKey(id), tileKey(id)]),
    env.DB.prepare("DELETE FROM page_shots WHERE id = ?").bind(id).run(),
  ]);
}

/**
 * Draws each page in turn in one browser. Returns the ids that got images.
 * Within the daily budget only; a 429 stops it and blocks later launches.
 */
export async function renderShots(env: ShotEnv, jobs: ShotJob[]): Promise<string[]> {
  const done: string[] = [];
  try {
    const now = Date.now();
    const todo = jobs.filter((j) => j.htmlEtag !== null && renderAllowed(j.page, now));
    if (env.BROWSER === undefined || todo.length === 0) return done;

    const cap = dailyBudgetMs(env.OG_SHOT_DAILY_SECONDS);
    if (!budgetAllows(await readBudget(env.DB), now, cap)) {
      console.log({ event: "og_shot_skipped", ids: todo.map((j) => j.id), reason: "budget" });
      return done;
    }
    // Mark the pages as tried before launching, so the dashboard's backfill
    // doesn't draw a page that's being drawn, and a failure waits a day.
    await claim(env.DB, todo, now);

    const started = Date.now();
    let browser: Browser;
    try {
      browser = await puppeteer.launch(env.BROWSER);
    } catch (err) {
      const until = blockAfterError(String(err), Date.now());
      if (until !== null) await setBlocked(env.DB, until);
      console.log({ event: "og_shot_skipped", ids: todo.map((j) => j.id), reason: until !== null ? "limit" : "launch", err: String(err) });
      return done;
    }

    try {
      for (const job of todo) {
        if (job !== todo[0] && Date.now() - started > BATCH_START_BEFORE_MS) break;
        const t0 = Date.now();
        let images: Images;
        try {
          images = await withTimeout(capture(browser, job.id, job.html, shotAllowed(job.page, Date.now())), RENDER_TIMEOUT_MS);
        } catch (err) {
          console.log({ event: "og_shot_failed", id: job.id, err: String(err) });
          continue;
        }
        if (await store(env, job, images)) {
          done.push(job.id);
          console.log({ event: "og_shot", id: job.id, ms: Date.now() - t0, og: images.og?.byteLength ?? 0, tile: images.tile.byteLength, lqip: images.lqip.length });
        }
      }
    } finally {
      await browser.close().catch(() => {});
      await addSpent(env.DB, Date.now() - started, Date.now()).catch((err) =>
        console.error("og shot budget write failed", { err: String(err) }),
      );
    }
  } catch (err) {
    console.error("og shot failed", { ids: jobs.map((j) => j.id), err: String(err) });
  }
  return done;
}

type Images = { og: Uint8Array | null; tile: Uint8Array; lqip: string };

async function store(env: ShotEnv, job: ShotJob, images: Images): Promise<boolean> {
  // The page may have been updated or deleted while the browser ran.
  const current = await env.PAGES_BUCKET.head(`pages/${job.id}/index.html`);
  if (current === null || current.etag !== job.htmlEtag) return false;
  const meta = { httpMetadata: { contentType: SHOT_CONTENT_TYPE }, customMetadata: { html: job.htmlEtag } };
  await Promise.all([
    images.og !== null ? env.PAGES_BUCKET.put(shotKey(job.id), images.og, meta) : Promise.resolve(null),
    env.PAGES_BUCKET.put(tileKey(job.id), images.tile, meta),
  ]);
  await env.DB
    .prepare(
      "INSERT INTO page_shots (id, html_etag, lqip, tried_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT (id) DO UPDATE SET html_etag = excluded.html_etag, lqip = excluded.lqip, tried_at = excluded.tried_at",
    )
    .bind(job.id, job.htmlEtag, images.lqip, Date.now())
    .run();
  return true;
}

async function capture(browser: Browser, id: string, html: string, withOg: boolean): Promise<Images> {
  const page = await browser.newPage();
  try {
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
    await sleep(300);

    // The public preview at 1200×630 (only for pages anyone may see), then
    // the 3:2 tile at the height the dashboard draws pages at, and its
    // placeholder from the same frame.
    const og = withOg ? ((await page.screenshot({ type: "jpeg", quality: SHOT_QUALITY })) as Uint8Array) : null;
    await page.setViewport({ width: SHOT_WIDTH, height: TILE_HEIGHT, deviceScaleFactor: 1 });
    await sleep(200);
    const tile = (await page.screenshot({ type: "jpeg", quality: TILE_QUALITY })) as Uint8Array;
    const tiny = await page.screenshot({
      type: "jpeg",
      quality: PLACEHOLDER_QUALITY,
      encoding: "base64",
      clip: { x: 0, y: 0, width: SHOT_WIDTH, height: TILE_HEIGHT, scale: PLACEHOLDER_SCALE },
    });
    return { og, tile, lqip: `data:image/jpeg;base64,${tiny as string}` };
  } finally {
    await page.close().catch(() => {});
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

/** page_shots rows for these pages (the page list, the backfill). */
export async function readShotRows(db: D1Database, ids: string[]): Promise<Map<string, ShotRow>> {
  const rows = new Map<string, ShotRow>();
  // D1 takes up to 100 bound parameters per statement.
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT id, html_etag, lqip, tried_at FROM page_shots WHERE id IN (${chunk.map(() => "?").join(", ")})`)
      .bind(...chunk)
      .all<{ id: string; html_etag: string | null; lqip: string | null; tried_at: number }>();
    for (const r of results) rows.set(r.id, { htmlEtag: r.html_etag, lqip: r.lqip, triedAt: r.tried_at });
  }
  return rows;
}

async function claim(db: D1Database, jobs: ShotJob[], now: number): Promise<void> {
  await db.batch(
    jobs.map((j) =>
      db
        .prepare(
          "INSERT INTO page_shots (id, html_etag, lqip, tried_at) VALUES (?, ?, NULL, ?) " +
            "ON CONFLICT (id) DO UPDATE SET html_etag = excluded.html_etag, lqip = NULL, tried_at = excluded.tried_at",
        )
        .bind(j.id, j.htmlEtag, now),
    ),
  );
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
