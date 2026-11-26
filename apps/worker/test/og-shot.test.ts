import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_DAILY_BUDGET_MS,
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
  // The default stays inside Workers Free's 10 minutes a day.
  assert.ok(DEFAULT_DAILY_BUDGET_MS < 10 * 60 * 1000);
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
  const out = injectAiredBar("<head></head><body></body>", { id: "abc", title: "t", readCount: 0, imageVersion: "a1b2c3d4e5f6" });
  assert.ok(out.includes('content="https://aired.sh/og/abc?v=a1b2c3d4e5f6"'));
  const plain = injectAiredBar("<head></head><body></body>", { id: "abc", title: "t", readCount: 0 });
  assert.ok(plain.includes('content="https://aired.sh/og/abc"'));
});

test("a screenshot asked for by its version keeps longer than the card", () => {
  assert.equal(ogCacheControl("shot", true), "public, max-age=3600");
  assert.equal(ogCacheControl("shot", false), "public, max-age=300");
  assert.equal(ogCacheControl("card", false), "public, max-age=300");
  assert.equal(ogCacheControl("card", true), "public, max-age=300");
});

// --- Source tripwires ---------------------------------------------------------

test("api.ts: every page HTML write queues a screenshot after the response", () => {
  const code = src("../src/routes/api.ts");
  const writes = code.match(/PAGES_BUCKET\.put\(`pages\/\$\{\w+\}\/index\.html`/g) ?? [];
  const shots = code.match(/c\.executionCtx\.waitUntil\(refreshShot\(/g) ?? [];
  assert.equal(writes.length, 3, "publish create, publish update, PUT");
  assert.equal(shots.length, writes.length);
  // Updates drop the old image first; the create has none to drop.
  assert.equal((code.match(/refreshShot\([^)]*\{ replacing: true \}\)/g) ?? []).length, 2);
  assert.equal((code.match(/refreshShot\([^)]*\{ replacing: false \}\)/g) ?? []).length, 1);
});

test("api.ts: deleting a page deletes its screenshot", () => {
  const code = src("../src/routes/api.ts");
  assert.match(code, /PAGES_BUCKET\.delete\(\[`pages\/\$\{id\}\/index\.html`, shotKey\(id\)\]\)/);
});

test("mcp.ts: the anonymous publish tool queues screenshots too", () => {
  const code = src("../src/routes/mcp.ts");
  const writes = code.match(/PAGES_BUCKET\.put\(\s*`pages\/\$\{\w+\}\/index\.html`/g) ?? [];
  const shots = code.match(/background\(refreshShot\(/g) ?? [];
  assert.equal(writes.length, 2);
  assert.equal(shots.length, 2);
  assert.match(code, /createAiredMcpServer\(c\.env, signedIn, \(work\) => c\.executionCtx\.waitUntil\(work\)\)/);
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
  assert.match(code, /if \(leaving \|\| isAired\(target\)\)/);
  // It never touches KV, so no view count or page record is written.
  assert.doesNotMatch(code, /PAGES_KV/);
  // The browser always closes, and a 429 sets the block rather than retrying.
  assert.match(code, /finally \{\s*await browser\.close\(\)/);
  assert.match(code, /blockAfterError\(/);
  assert.doesNotMatch(code, /retry/i);
  // A page updated or deleted mid-render doesn't get the old image.
  assert.match(code, /current === null \|\| current\.etag !== htmlEtag/);
});

test("viewer.ts passes the HTML etag as the og:image version", () => {
  assert.match(src("../src/routes/viewer.ts"), /imageVersion: versionFromEtag\(obj\.etag\)/);
});

test("wrangler.toml binds Browser Rendering and the budget table has a migration", () => {
  assert.match(src("../wrangler.toml"), /\[browser\]\s*\nbinding = "BROWSER"/);
  assert.match(src("../migrations/0008_og_shot_budget.sql"), /CREATE TABLE og_shot_budget/);
});
