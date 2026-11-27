import puppeteer from "@cloudflare/puppeteer";
import type { Browser } from "@cloudflare/puppeteer";
import { PAGE_CSP } from "../middleware/security.js";
import { SANDBOX_SHIM, injectEarlyScript } from "./sandbox-shim.js";
import { siteOrigin } from "./origin.ts";
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
  renderOrigin,
  shotAllowed,
  shotKey,
  tileKey,
  readBudget,
  addSpent,
  setBlocked,
  BUDGET_ROW,
  type ShotPage,
  type ShotRow,
} from "./og-shot.js";
import {
  CheckUnavailable,
  CHECK_BUDGET_ROW,
  CHECK_LOAD_TIMEOUT_MS,
  CHECK_SETTLE_MS,
  CHECK_SHOT_QUALITY,
  CHECK_TIMEOUT_MS,
  CHECK_VIEWPORTS,
  DOM_PROBE,
  MAX_CONSOLE,
  MAX_REQUESTS,
  checkGate,
  checkShotPrefix,
  relativeFileMiss,
  reserveCheckTime,
  settleCheckTime,
  type CheckCaller,
  type CheckObservations,
  type CheckViewport,
} from "./page-check.ts";

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
  /** The page URL the browser is shown (lib/origin.ts siteOrigin). */
  SITE_ORIGIN?: string;
};

export type ShotJob = {
  id: string;
  page: ShotPage;
  html: string;
  /** The stored HTML's R2 etag; null (no object came back) skips the page. */
  htmlEtag: string | null;
};

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

/** Remove a page's images, its check screenshots and its page_shots row (update, delete). */
export async function forgetShots(env: Pick<ShotEnv, "PAGES_BUCKET" | "DB">, id: string): Promise<void> {
  await Promise.all([
    env.PAGES_BUCKET.delete([shotKey(id), tileKey(id)]),
    deleteCheckShots(env.PAGES_BUCKET, id, () => true),
    env.DB.prepare("DELETE FROM page_shots WHERE id = ?").bind(id).run(),
  ]);
}

/** Delete a page's check screenshots that `drop` picks (all on update or delete; old ones after a check). */
export async function deleteCheckShots(bucket: R2Bucket, id: string, drop: (o: { uploaded: Date }) => boolean): Promise<void> {
  const listed = await bucket.list({ prefix: checkShotPrefix(id), limit: 1000 });
  const keys = listed.objects.filter(drop).map((o) => o.key);
  if (keys.length > 0) await bucket.delete(keys);
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
          images = await withTimeout(capture(browser, renderOrigin(siteOrigin(env)), job.id, job.html, shotAllowed(job.page, Date.now())), RENDER_TIMEOUT_MS);
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

async function capture(browser: Browser, origin: string, id: string, html: string, withOg: boolean): Promise<Images> {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: SHOT_WIDTH, height: SHOT_HEIGHT, deviceScaleFactor: 1 });
    const url = await serveStoredPage(page, origin, id, html);

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

type BrowserPage = Awaited<ReturnType<Browser["newPage"]>>;

/**
 * Serve the stored HTML at the page's own URL, with the viewer's sandbox CSP
 * and storage shim, and keep the page in: it can't navigate the tab away (a
 * redirect would screenshot someone else's site) and can't reach aired.sh
 * (an embedded page would count a view). Returns the URL to open.
 * `onBlocked` hears about each request stopped that way.
 */
async function serveStoredPage(
  page: BrowserPage,
  origin: string,
  id: string,
  html: string,
  onBlocked?: (url: string, navigation: boolean, type: string) => void,
  extraHosts: string[] = [],
): Promise<string> {
  page.on("dialog", (d) => {
    d.dismiss().catch(() => {});
  });
  // window.open gets a tab with no interception: close it at once.
  page.on("popup", (p) => {
    p?.close().catch(() => {});
  });
  const url = `${origin}/p/${encodeURIComponent(id)}`;
  const body = injectEarlyScript(html, SANDBOX_SHIM);
  let served = false;
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const target = req.url();
    // By host and path: Chrome may upgrade an http:// SITE_ORIGIN (local dev) to https.
    if (!served && sameDocument(target, url) && req.isNavigationRequest()) {
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
    const leaving = req.isNavigationRequest() && req.frame() === page.mainFrame();
    if (leaving || isAired(target, extraHosts)) {
      onBlocked?.(target, leaving, req.resourceType());
      req.abort().catch(() => {});
      return;
    }
    req.continue().catch(() => {});
  });
  return url;
}

export type CheckEnv = ShotEnv & { CHECK_DAILY_SECONDS?: string };

/**
 * check_page: render a page and report what a visitor would hit (rules,
 * report and budget in page-check.ts). Gates on the budget, reserves the
 * longest a check can take before launching, and settles to the real time
 * after, so a request cut off mid-check stays charged. Returns what the
 * browser saw and a JPEG of the first screen.
 */
export async function checkPage(
  env: CheckEnv,
  id: string,
  html: string,
  viewport: CheckViewport,
  caller: CheckCaller,
): Promise<{ obs: CheckObservations; screenshot: Uint8Array | null }> {
  if (env.BROWSER === undefined) throw new CheckUnavailable("no_browser", null);
  await checkGate(env.DB, env, Date.now(), caller);
  let reserved: number;
  try {
    reserved = await reserveCheckTime(env.DB, caller, Date.now());
  } catch (err) {
    console.error("page check budget write failed", { err: String(err) });
    throw new CheckUnavailable("storage", 30);
  }

  const started = Date.now();
  const settle = () =>
    settleCheckTime(env.DB, caller, reserved, Date.now() - started, Date.now()).catch((err) =>
      console.error("page check budget write failed", { err: String(err) }),
    );
  let browser: Browser;
  try {
    browser = await puppeteer.launch(env.BROWSER);
  } catch (err) {
    await settle();
    const until = blockAfterError(String(err), Date.now());
    const daily = /time limit exceeded/i.test(String(err));
    // The account's daily limit stops screenshots too; "too many browsers" only holds back checks.
    if (until !== null) await setBlocked(env.DB, until, daily ? BUDGET_ROW : CHECK_BUDGET_ROW).catch(() => {});
    console.log({ event: "page_check_skipped", id, reason: daily ? "daily_limit" : until !== null ? "limit" : "launch", err: String(err) });
    const wait = until !== null ? Math.max(1, Math.ceil((until - Date.now()) / 1000)) : 60;
    throw new CheckUnavailable(daily ? "budget" : "busy", wait);
  }
  const origin = renderOrigin(siteOrigin(env));
  try {
    return await withTimeout(observe(browser, origin, id, html, viewport, blockedHosts(env)), CHECK_TIMEOUT_MS);
  } finally {
    await browser.close().catch(() => {});
    await settle();
  }
}

/** Hosts a rendered page may not reach besides aired.sh: this deploy's own host and its workers.dev name. */
function blockedHosts(env: { SITE_ORIGIN?: string }): string[] {
  try {
    return [new URL(siteOrigin(env)).hostname];
  } catch {
    return [];
  }
}

async function observe(
  browser: Browser,
  origin: string,
  id: string,
  html: string,
  viewport: CheckViewport,
  extraHosts: string[],
): Promise<{ obs: CheckObservations; screenshot: Uint8Array | null }> {
  const page = await browser.newPage();
  const obs: CheckObservations = { loadMs: 0, loaded: false, loadError: null, console: [], pageErrors: [], failedRequests: [], navigationsBlocked: [], dom: null };
  const ours = new Set<string>();
  try {
    await page.setViewport(CHECK_VIEWPORTS[viewport]);
    page.on("console", (msg) => {
      const type = String(msg.type());
      if (type !== "error" && type !== "warn" && type !== "warning") return;
      if (obs.console.length >= MAX_CONSOLE) return;
      // Chrome's "Failed to load resource" repeats a failed request, which
      // failed_requests already lists (and requests we block on purpose,
      // like aired.sh's favicon, aren't the page's fault).
      if (msg.text().startsWith("Failed to load resource")) return;
      const loc = msg.location();
      obs.console.push({ level: type === "error" ? "error" : "warning", text: msg.text(), source: loc?.url ? `${loc.url}${loc.lineNumber !== undefined ? `:${loc.lineNumber + 1}` : ""}` : null });
    });
    page.on("pageerror", (err) => {
      if (obs.pageErrors.length < MAX_CONSOLE) obs.pageErrors.push(String((err as Error)?.message ?? err));
    });
    page.on("requestfailed", (req) => {
      if (ours.has(req.url()) || obs.failedRequests.length >= MAX_REQUESTS) return;
      obs.failedRequests.push({ url: req.url(), status: null, error: req.failure()?.errorText ?? "failed", type: req.resourceType() });
    });
    page.on("response", (res) => {
      if (res.status() < 400 || obs.failedRequests.length >= MAX_REQUESTS) return;
      const req = res.request();
      obs.failedRequests.push({ url: res.url(), status: res.status(), error: null, type: req.resourceType() });
    });
    const url = await serveStoredPage(page, origin, id, html, (target, navigation, type) => {
      if (navigation) {
        ours.add(target);
        if (obs.navigationsBlocked.length < 5) obs.navigationsBlocked.push(target);
      } else if (relativeFileMiss(target, origin)) {
        // A visitor loses this file too: it's a relative path, and a page is one file.
        if (obs.failedRequests.length < MAX_REQUESTS) obs.failedRequests.push({ url: target, status: 404, error: "not on aired: a page is one file, so inline it or use an absolute URL", type });
        ours.add(target);
      } else {
        ours.add(target);
      }
    }, extraHosts);

    const t0 = Date.now();
    // A timeout is a slow page; any other failure means the document itself never loaded.
    obs.loaded = await page
      .goto(url, { waitUntil: "load", timeout: CHECK_LOAD_TIMEOUT_MS })
      .then(() => true)
      .catch((err: unknown) => {
        const message = String((err as Error)?.message ?? err);
        if (!/timeout|timed out/i.test(message)) obs.loadError = message;
        return false;
      });
    obs.loadMs = Date.now() - t0;
    await page
      .evaluate("Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(() => true)")
      .catch(() => {});
    await sleep(CHECK_SETTLE_MS);
    obs.dom = (await page.evaluate(DOM_PROBE).catch(() => null)) as CheckObservations["dom"];
    // Without a viewport tag a phone widens the layout to fit the page, so compare with the real screen.
    if (obs.dom !== null) obs.dom.viewportWidth = CHECK_VIEWPORTS[viewport].width;
    const screenshot = (await page.screenshot({ type: "jpeg", quality: CHECK_SHOT_QUALITY }).catch(() => null)) as Uint8Array | null;
    return { obs, screenshot };
  } finally {
    await page.close().catch(() => {});
  }
}

function sameDocument(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.host === y.host && x.pathname === y.pathname && x.search === y.search;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** aired.sh, this deploy's own host, and the Worker's workers.dev name (aired.<account>.workers.dev). */
function isAired(target: string, extraHosts: string[] = []): boolean {
  try {
    const host = new URL(target).hostname;
    return host === "aired.sh" || host.endsWith(".aired.sh") || extraHosts.includes(host) || (host.startsWith("aired.") && host.endsWith(".workers.dev"));
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
