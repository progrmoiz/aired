import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BACKFILL_MAX,
  DEFAULT_DAILY_BUDGET_MS,
  RETRY_AFTER_MS,
  needsBackfill,
  renderAllowed,
  tileCacheControl,
  tileInfo,
  tileKey,
  RATE_LIMIT_BACKOFF_MS,
  SHOT_MAX_BYTES,
  blockAfterError,
  budgetAllows,
  dailyBudgetMs,
  ogCacheControl,
  shotAllowed,
  shotKey,
  utcDay,
  versionFromEtag,
  type ShotPage,
} from "../src/lib/og-shot.ts";
import { pageIdFromKey } from "../src/lib/expired-sweep.ts";
import { injectAiredBar } from "../src/lib/aired-bar.ts";

const NOW = Date.parse("2026-11-26T15:30:00Z");
const page = (over: Partial<ShotPage> = {}): ShotPage =>
  ({ pin: null, reads: null, size: 2000, permanent: true, expiresAt: null, ...over });
const src = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("a plain page gets a screenshot", () => {
  assert.equal(shotAllowed(page(), NOW), true);
  assert.equal(shotAllowed(page({ permanent: false, expiresAt: new Date(NOW + 60_000).toISOString() }), NOW), true);
});

test("PIN and view-limited pages never get one: it would leak or spend them", () => {
  assert.equal(shotAllowed(page({ pin: "pbkdf2$..." }), NOW), false);
  assert.equal(shotAllowed(page({ reads: 5 }), NOW), false);
});

test("pages over the size cap and expired pages keep the card", () => {
  assert.equal(shotAllowed(page({ size: SHOT_MAX_BYTES }), NOW), true);
  assert.equal(shotAllowed(page({ size: SHOT_MAX_BYTES + 1 }), NOW), false);
  assert.equal(shotAllowed(page({ permanent: false, expiresAt: new Date(NOW - 1).toISOString() }), NOW), false);
});

test("the screenshot sits next to the page HTML, where the expired sweep finds it", () => {
  assert.equal(shotKey("abc_-1"), "pages/abc_-1/shot.jpg");
  assert.equal(pageIdFromKey(shotKey("abc_-1")), "abc_-1");
  assert.equal(pageIdFromKey("pages/abc/shot.jpg.bak"), null);
  assert.equal(pageIdFromKey("pages/abc/shot.png"), null);
});

test("the daily budget reads OG_SHOT_DAILY_SECONDS, with 0 turning screenshots off", () => {
  assert.equal(dailyBudgetMs(undefined), DEFAULT_DAILY_BUDGET_MS);
  assert.equal(dailyBudgetMs(""), DEFAULT_DAILY_BUDGET_MS);
  assert.equal(dailyBudgetMs("junk"), DEFAULT_DAILY_BUDGET_MS);
  assert.equal(dailyBudgetMs("-5"), DEFAULT_DAILY_BUDGET_MS);
  assert.equal(dailyBudgetMs("1200"), 1_200_000);
  assert.equal(dailyBudgetMs("0"), 0);
  assert.equal(budgetAllows(null, NOW, 0), false);
  // Workers Paid: a whole month at the default cap stays near the included 10
  // hours (at most 21 hours, about $1 more at $0.09 an hour).
  assert.ok((DEFAULT_DAILY_BUDGET_MS * 31) / 3_600_000 <= 21);
});

test("the budget stops screenshots once today's time is spent, and resets on the next UTC day", () => {
  const cap = 60_000;
  const today = utcDay(NOW);
  assert.equal(today, "2026-11-26");
  assert.equal(budgetAllows(null, NOW, cap), true);
  assert.equal(budgetAllows({ day: today, spentMs: 59_999, blockedUntil: 0 }, NOW, cap), true);
  assert.equal(budgetAllows({ day: today, spentMs: 60_000, blockedUntil: 0 }, NOW, cap), false);
  assert.equal(budgetAllows({ day: "2026-11-25", spentMs: 600_000, blockedUntil: 0 }, NOW, cap), true);
});

test("after a 429 nothing tries again until the limit lifts", () => {
  assert.equal(budgetAllows({ day: utcDay(NOW), spentMs: 0, blockedUntil: NOW + 1 }, NOW, 60_000), false);
  assert.equal(budgetAllows({ day: utcDay(NOW), spentMs: 0, blockedUntil: NOW }, NOW, 60_000), true);
});

test("the daily-limit 429 blocks until the next UTC day; other 429s for a minute", () => {
  const daily = "Error processing the request: Unable to create new browser: code: 429: message: Browser time limit exceeded for today";
  assert.equal(blockAfterError(daily, NOW), Date.parse("2026-11-27T00:00:00Z"));
  const busy = "Unable to create new browser: code: 429: message: Too many browsers already running";
  assert.equal(blockAfterError(busy, NOW), NOW + RATE_LIMIT_BACKOFF_MS);
  assert.equal(blockAfterError("Rate limit exceeded", NOW), NOW + RATE_LIMIT_BACKOFF_MS);
  // Anything else costs only that page its screenshot.
  assert.equal(blockAfterError("Error: net::ERR_ABORTED", NOW), null);
  assert.equal(blockAfterError("socket hang up 4290ms", NOW), null);
});

test("og:image carries a version from the HTML etag, so an update busts preview caches", () => {
  assert.equal(versionFromEtag('"a1b2c3d4e5f6a7b8c9d0"'), "a1b2c3d4e5f6");
  const out = injectAiredBar("<head></head><body></body>", { origin: "https://aired.sh", id: "abc", title: "t", readCount: 0, imageVersion: "a1b2c3d4e5f6" });
  assert.ok(out.includes('content="https://aired.sh/og/abc?v=a1b2c3d4e5f6"'));
  const plain = injectAiredBar("<head></head><body></body>", { origin: "https://aired.sh", id: "abc", title: "t", readCount: 0 });
  assert.ok(plain.includes('content="https://aired.sh/og/abc"'));
});

test("a screenshot asked for by its version keeps longer than the card", () => {
  assert.equal(ogCacheControl("shot", true), "public, max-age=3600");
  assert.equal(ogCacheControl("shot", false), "public, max-age=300");
  assert.equal(ogCacheControl("card", false), "public, max-age=300");
  assert.equal(ogCacheControl("card", true), "public, max-age=300");
});

// --- Source tripwires ---------------------------------------------------------

test("pages-service.ts: every page HTML write queues a screenshot after the response", () => {
  assert.doesNotMatch(src("../src/routes/api.ts"), /PAGES_BUCKET\.put\(|await (createPage|updatePage)\(/);
  const code = src("../src/lib/pages-service.ts");
  // HTML is written only through lib/page-write.ts.
  assert.doesNotMatch(code, /PAGES_BUCKET\.put\(/);
  const writes = code.match(/await (createPage|updatePage)\(c\.env, /g) ?? [];
  const shots = code.match(/c\.executionCtx\.waitUntil\(refreshShot\(/g) ?? [];
  assert.equal(writes.length, 2, "create, and the update both publish-update and PUT use");
  assert.equal(shots.length, writes.length);
  // Updates drop the old image first; the create has none to drop.
  assert.equal((code.match(/refreshShot\([^)]*\{ replacing: true \}\)/g) ?? []).length, 1);
  assert.equal((code.match(/refreshShot\([^)]*\{ replacing: false \}\)/g) ?? []).length, 1);
});

test("api.ts: deleting a page deletes its screenshots and placeholder", () => {
  const api = src("../src/routes/api.ts");
  const del = api.slice(api.indexOf('api.delete("/pages/:id"'));
  assert.match(del.slice(0, del.indexOf("\n});")), /await deletePage\(c\.env, page, /);
  const write = src("../src/lib/page-write.ts");
  const fn = write.slice(write.indexOf("export async function deletePage"));
  assert.match(fn.slice(0, fn.indexOf("\n}\n")), /await forgetShots\(env, row\.id\)/);
  const render = src("../src/lib/og-render.ts");
  assert.match(render, /PAGES_BUCKET\.delete\(\[shotKey\(id\), tileKey\(id\)\]\)/);
  assert.match(render, /deleteCheckShots\(env\.PAGES_BUCKET, id, \(\) => true\)/);
  assert.match(render, /DELETE FROM page_shots WHERE id = \?/);
});

test("versions.ts: a restore writes through updatePage and queues a screenshot", () => {
  const code = src("../src/routes/versions.ts");
  assert.doesNotMatch(code, /PAGES_BUCKET\.put\(/);
  assert.equal((code.match(/await updatePage\(c\.env, /g) ?? []).length, 1);
  assert.equal((code.match(/c\.executionCtx\.waitUntil\(refreshShot\([^)]*\{ replacing: true \}\)/g) ?? []).length, 1);
});

test("mcp.ts: the anonymous publish tool writes nothing itself, so the API's screenshot rule covers it", () => {
  const code = src("../src/routes/mcp.ts");
  assert.doesNotMatch(code, /PAGES_BUCKET\.put\(|createPage|updatePage|refreshShot/);
  assert.match(code, /createAiredMcpServer\(c\.env, signedIn, callApi\)/);
});

test("og.ts: serves a screenshot only for a live page allowed one, else the card", () => {
  const code = src("../src/routes/og.ts");
  const guard = code.indexOf("shotAllowed(metadata, Date.now())");
  const read = code.indexOf("PAGES_BUCKET.get(shotKey(id))");
  assert.ok(guard > 0 && read > guard, "checks the page before reading the image");
  assert.match(code, /"Content-Type": "image\/svg\+xml"/);
});

test("og-render.ts: renders the stored HTML in the sandbox, never through /p/:id", () => {
  const code = src("../src/lib/og-render.ts");
  // The document comes from req.respond with the viewer's CSP and shim.
  assert.match(code, /req\s*\.respond\(/);
  assert.match(code, /"Content-Security-Policy": PAGE_CSP/);
  assert.match(code, /injectEarlyScript\(html, SANDBOX_SHIM\)/);
  // Nothing else reaches aired.sh, and the page can't navigate away.
  assert.match(code, /if \(leaving \|\| isAired\(target, extraHosts\)\)/);
  // It never touches KV, so no view count or page record is written.
  assert.doesNotMatch(code, /PAGES_KV/);
  // The browser always closes, and a 429 sets the block rather than retrying.
  assert.match(code, /finally \{\s*await browser\.close\(\)/);
  assert.match(code, /blockAfterError\(/);
  assert.doesNotMatch(code, /retry/i);
  // A page updated or deleted mid-render doesn't get the old image.
  assert.match(code, /current === null \|\| current\.etag !== job\.htmlEtag/);
  // The public preview is only taken for pages allowed one; the tile always.
  assert.match(code, /capture\(browser, renderOrigin\(siteOrigin\(env\)\), job\.id, job\.html, shotAllowed\(job\.page, Date\.now\(\)\)\)/);
  assert.match(code, /const og = withOg \?/);
});

test("viewer.ts passes the HTML etag as the og:image version", () => {
  assert.match(src("../src/routes/viewer.ts"), /imageVersion: versionFromEtag\(obj\.etag\)/);
});

test("wrangler.toml binds Browser Rendering and the budget table has a migration", () => {
  assert.match(src("../wrangler.toml"), /\[browser\]\s*\nbinding = "BROWSER"/);
  assert.match(src("../migrations/0008_og_shot_budget.sql"), /CREATE TABLE og_shot_budget/);
});

// --- Dashboard tiles ------------------------------------------------------------

test("PIN and view-limited pages are drawn for their owner's tile, but get no public preview", () => {
  assert.equal(renderAllowed(page({ pin: "pbkdf2$..." }), NOW), true);
  assert.equal(renderAllowed(page({ reads: 3 }), NOW), true);
  assert.equal(shotAllowed(page({ pin: "pbkdf2$..." }), NOW), false);
  assert.equal(renderAllowed(page({ size: SHOT_MAX_BYTES + 1 }), NOW), false);
  assert.equal(renderAllowed(page({ permanent: false, expiresAt: new Date(NOW - 1).toISOString() }), NOW), false);
});

test("the tile sits next to the HTML, where the expired sweep finds it", () => {
  assert.equal(tileKey("abc"), "pages/abc/tile.jpg");
  assert.equal(pageIdFromKey(tileKey("abc")), "abc");
});

test("the page list gets a tile only once its images exist", () => {
  assert.equal(tileInfo(undefined), null);
  assert.equal(tileInfo({ htmlEtag: '"abc"', lqip: null, triedAt: NOW }), null);
  assert.deepEqual(tileInfo({ htmlEtag: '"a1b2c3d4e5f6a7"', lqip: "data:image/jpeg;base64,xx", triedAt: NOW }), { v: "a1b2c3d4e5f6", lqip: "data:image/jpeg;base64,xx" });
});

test("backfill draws pages with no row, and retries a failed one only after a day", () => {
  assert.equal(needsBackfill(undefined, NOW), true);
  assert.equal(needsBackfill({ htmlEtag: "e", lqip: "data:x", triedAt: 0 }, NOW), false);
  assert.equal(needsBackfill({ htmlEtag: "e", lqip: null, triedAt: NOW - 1000 }, NOW), false);
  assert.equal(needsBackfill({ htmlEtag: "e", lqip: null, triedAt: NOW - RETRY_AFTER_MS }, NOW), true);
  assert.ok(BACKFILL_MAX <= 3, "one browser draws them in turn inside a request");
});

test("a tile asked for by its version is cached for good, privately", () => {
  assert.equal(tileCacheControl(true), "private, max-age=31536000, immutable");
  assert.equal(tileCacheControl(false), "private, max-age=60");
});

test("me.ts: the tile route is owner-only and the list carries tiles", () => {
  const code = src("../src/routes/me.ts");
  const start = code.indexOf("me.get('/pages/:id/tile'");
  assert.ok(start > 0);
  const route = code.slice(start, code.indexOf("\n});", start));
  assert.match(route, /ownedPage\(c, user\.id, id\)\) === null\) return c\.json\(\{ error: 'Page not found' \}, 404\)/);
  assert.match(route, /PAGES_BUCKET\.get\(tileKey\(id\)\)/);
  assert.doesNotMatch(route, /shotKey|PAGES_KV\.put|readCount/);
  // ownedPage uses the preview route's owner/expiry rule.
  const helper = code.slice(code.indexOf("async function ownedPage"), code.indexOf("me.get('/pages/:id/tile'"));
  assert.match(helper, /previewDecision\(facts, userId, false, Date\.now\(\)\)\.ok \? facts : null/);
  assert.match(code, /p\.tile = tileInfo\(rows\.get\(p\.id\)\)/);
});

test("me.ts: the backfill checks ownership, skips recent tries and caps the batch", () => {
  const code = src("../src/routes/me.ts");
  const start = code.indexOf("me.post('/pages/shots', requireCsrfHeader");
  assert.ok(start > 0, "route exists behind the CSRF header");
  const route = code.slice(start, code.indexOf("\n});", start));
  assert.match(route, /needsBackfill\(rows\.get\(id\), now\)/);
  assert.match(route, /jobs\.length >= BACKFILL_MAX/);
  assert.match(route, /ownedPage\(c, user\.id, id\)/);
  assert.match(route, /renderShots\(c\.env, jobs\)/);
});

test("og.ts never serves the tile", () => {
  assert.doesNotMatch(src("../src/routes/og.ts"), /tileKey|tile\.jpg/);
});

test("the expired sweep drops a page's page_shots row with its HTML", () => {
  const code = src("../src/index.ts");
  assert.match(code, /DELETE FROM page_shots WHERE id = \?/);
  assert.match(src("../migrations/0009_page_shots.sql"), /CREATE TABLE page_shots/);
});
