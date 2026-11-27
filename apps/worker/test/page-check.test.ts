import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeD1 } from "./helpers/d1.ts";
import {
  buildReport,
  checkBudgetMs,
  checkGate,
  CheckUnavailable,
  checkShotKey,
  DEFAULT_CHECK_BUDGET_MS,
  MAX_CONSOLE,
  parseViewport,
  recordCheckTime,
  reportText,
  secondsToNextUtcDay,
  shotKeyValid,
  type CheckObservations,
} from "../src/lib/page-check.ts";
import { addSpent, readBudget, setBlocked, utcDay } from "../src/lib/og-shot.ts";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const NOW = Date.UTC(2026, 10, 27, 15, 0, 0);

const dom = (over: Partial<NonNullable<CheckObservations["dom"]>> = {}): NonNullable<CheckObservations["dom"]> => ({
  title: "Report",
  textChars: 500,
  visibleMedia: 1,
  brokenImages: 0,
  scrollWidth: 1280,
  scrollHeight: 2000,
  viewportWidth: 1280,
  hasViewportMeta: true,
  transferBytes: 50_000,
  resourceCount: 3,
  ...over,
});
const obs = (over: Partial<CheckObservations> = {}): CheckObservations => ({
  loadMs: 420,
  loaded: true,
  loadError: null,
  console: [],
  pageErrors: [],
  failedRequests: [],
  navigationsBlocked: [],
  dom: dom(),
  ...over,
});
const report = (o: CheckObservations, htmlBytes = 4000) =>
  buildReport({ id: "abc", url: "https://aired.sh/p/abc", viewport: "desktop", htmlBytes, obs: o, now: NOW, screenshotUrl: "https://aired.sh/api/pages/abc/check.jpg?k=0123456789abcdef0123456789abcdef" });

test("a clean page is ok with no issues, and says so", () => {
  const r = report(obs());
  assert.equal(r.ok, true);
  assert.equal(r.blank, false);
  assert.deepEqual(r.issues, []);
  assert.equal(r.screenshot_expires_at, new Date(NOW + 24 * 3600 * 1000).toISOString());
  assert.match(reportText(r), /works \(desktop, loaded in 0\.4 s\)/);
  assert.match(reportText(r), /Screenshot \(24 h\)/);
});

test("script errors, console errors, failed files and broken images each fail the check", () => {
  for (const o of [
    obs({ pageErrors: ["ReferenceError: chart is not defined"] }),
    obs({ console: [{ level: "error", text: "Refused to load the script", source: "https://cdn.x/a.js:1" }] }),
    obs({ failedRequests: [{ url: "https://cdn.x/missing.css", status: 404, error: null, type: "stylesheet" }] }),
    obs({ failedRequests: [{ url: "https://nope.invalid/a.js", status: null, error: "net::ERR_NAME_NOT_RESOLVED", type: "script" }] }),
    obs({ dom: dom({ brokenImages: 2 }) }),
  ]) {
    const r = report(o);
    assert.equal(r.ok, false, JSON.stringify(r.issues));
    assert.ok(r.issues.some((i) => i.severity === "error"));
  }
  const r = report(obs({ failedRequests: [{ url: "https://cdn.x/missing.css", status: 404, error: null, type: "stylesheet" }] }));
  assert.match(r.issues[0]!.message, /1 file didn't load, e\.g\. https:\/\/cdn\.x\/missing\.css \(HTTP 404\)/);
  assert.match(reportText(r), /^https:\/\/aired\.sh\/p\/abc has problems/);
});

test("blank: no text and no media is an error; media alone or text alone isn't", () => {
  assert.equal(report(obs({ dom: dom({ textChars: 0, visibleMedia: 0 }) })).blank, true);
  assert.equal(report(obs({ dom: dom({ textChars: 0, visibleMedia: 0 }) })).ok, false);
  assert.equal(report(obs({ dom: dom({ textChars: 0, visibleMedia: 1 }) })).ok, true, "a canvas-only page is fine");
  assert.equal(report(obs({ dom: dom({ textChars: 3, visibleMedia: 0 }) })).ok, true);
  const none = report(obs({ dom: null }));
  assert.equal(none.blank, true);
  assert.deepEqual(none.issues.map((i) => i.code), ["no_render"]);
});

test("a document that never loads is an error, not a slow page", () => {
  const r = report(obs({ loaded: false, loadError: "net::ERR_CONNECTION_REFUSED at http://localhost:8821/p/abc", dom: dom({ title: "localhost", textChars: 74 }) }));
  assert.equal(r.ok, false);
  assert.equal(r.blank, true, "Chrome's error page isn't the page");
  assert.deepEqual(r.issues.map((i) => i.code), ["no_render"]);
  assert.match(r.issues[0]!.message, /The page didn't load: net::ERR_CONNECTION_REFUSED/);
});

test("heavy, tall, wide, slow and navigating pages warn but still pass", () => {
  const r = report(
    obs({
      loaded: false,
      navigationsBlocked: ["https://elsewhere.example/"],
      console: [{ level: "warning", text: "deprecated API", source: null }],
      dom: dom({ transferBytes: 6 * 1024 * 1024, scrollHeight: 40_000, scrollWidth: 1600 }),
    }),
    1.5 * 1024 * 1024,
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues.map((i) => i.code).sort(), ["console_warning", "heavy_html", "heavy_page", "navigates_away", "slow_load", "too_wide", "very_tall"]);
  assert.ok(r.issues.every((i) => i.severity === "warning"));
});

test("on a phone, a page with no viewport tag gets a warning (only on mobile)", () => {
  const o = obs({ dom: dom({ hasViewportMeta: false, scrollWidth: 980, viewportWidth: 390 }) });
  const mobile = buildReport({ id: "abc", url: "u", viewport: "mobile", htmlBytes: 100, obs: o, now: NOW, screenshotUrl: null });
  assert.equal(mobile.ok, true);
  assert.deepEqual(mobile.issues.map((i) => i.code), ["no_viewport_meta", "too_wide"]);
  const desktop = report(obs({ dom: dom({ hasViewportMeta: false }) }));
  assert.deepEqual(desktop.issues, []);
});

test("a noisy page can't flood the report", () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ level: "error" as const, text: "x".repeat(5000) + i, source: null }));
  const r = report(obs({ console: many, pageErrors: ["boom"] }));
  assert.equal(r.console.length, MAX_CONSOLE);
  assert.ok(r.console.every((m) => m.text.length <= 300));
  assert.equal(r.console[0]!.text, "boom", "uncaught errors come first");
});

test("viewports: desktop by default, mobile on request, anything else refused", () => {
  assert.equal(parseViewport(undefined), "desktop");
  assert.equal(parseViewport(""), "desktop");
  assert.equal(parseViewport("mobile"), "mobile");
  assert.equal(parseViewport("tablet"), null);
  assert.equal(parseViewport(3), null);
});

test("the checks' budget: 3 minutes by default, never more than the whole browser budget, 0 turns it off", () => {
  const total = 8 * 60 * 1000;
  assert.equal(checkBudgetMs(undefined, total), DEFAULT_CHECK_BUDGET_MS);
  assert.equal(checkBudgetMs("60", total), 60_000);
  assert.equal(checkBudgetMs("9999", total), total);
  assert.equal(checkBudgetMs("0", total), 0);
  assert.equal(checkBudgetMs("junk", total), DEFAULT_CHECK_BUDGET_MS);
  assert.equal(checkBudgetMs(undefined, 0), 0, "screenshots off means checks off");
});

const gateFails = async (db: D1Database, vars = {}, now = NOW) => {
  try {
    await checkGate(db as never, vars, now);
    return null;
  } catch (err) {
    assert.ok(err instanceof CheckUnavailable);
    return err;
  }
};

test("gate: a fresh day allows a check; spent check time stops checks but not link previews", async () => {
  const { db } = fakeD1();
  assert.equal(await gateFails(db), null);
  await addSpent(db as never, DEFAULT_CHECK_BUDGET_MS, NOW, "check");
  const err = await gateFails(db);
  assert.equal(err?.reason, "budget");
  assert.equal(err?.waitSeconds, secondsToNextUtcDay(NOW));
  assert.equal(err?.waitSeconds, 9 * 3600, "until 00:00 UTC");
  // Screenshots read only the shared row, which has nothing in it yet.
  assert.equal(await readBudget(db as never), null);
  // The next UTC day starts over.
  assert.equal(await gateFails(db, {}, Date.UTC(2026, 10, 28, 0, 0, 1)), null);
});

test("gate: screenshots using up the shared budget stop checks too", async () => {
  const { db } = fakeD1();
  await addSpent(db as never, 8 * 60 * 1000, NOW);
  assert.equal((await gateFails(db))?.reason, "budget");
  assert.equal(await gateFails(db, { OG_SHOT_DAILY_SECONDS: "900" }), null, "a bigger budget lets it run");
  assert.equal((await gateFails(fakeD1().db, { CHECK_DAILY_SECONDS: "0" }))?.reason, "budget", "0 turns checks off");
});

test("gate: a Browser Rendering block stops checks until it lifts", async () => {
  const { db } = fakeD1();
  await setBlocked(db as never, NOW + 60_000);
  const err = await gateFails(db);
  assert.equal(err?.reason, "budget");
  assert.equal(err?.waitSeconds, 60);
  assert.equal(await gateFails(db, {}, NOW + 61_000), null);
});

test("a check's time counts against both rows", async () => {
  const { db } = fakeD1();
  await recordCheckTime(db as never, 12_000, NOW);
  await recordCheckTime(db as never, 8_000, NOW);
  assert.deepEqual(await readBudget(db as never), { day: utcDay(NOW), spentMs: 20_000, blockedUntil: 0 });
  assert.deepEqual(await readBudget(db as never, "check"), { day: utcDay(NOW), spentMs: 20_000, blockedUntil: 0 });
});

test("screenshot keys: only the exact, unexpired key opens it", () => {
  const key = "0123456789abcdef0123456789abcdef";
  const exp = String(NOW + 1000);
  assert.equal(shotKeyValid(key, key, exp, NOW), true);
  assert.equal(shotKeyValid(key.replace("0", "1"), key, exp, NOW), false);
  assert.equal(shotKeyValid(key, key, exp, NOW + 1000), false, "expired");
  assert.equal(shotKeyValid(key, key, undefined, NOW), false);
  assert.equal(shotKeyValid("", "", exp, NOW), false);
  assert.equal(shotKeyValid(null, key, exp, NOW), false);
  assert.equal(shotKeyValid("short", "short", exp, NOW), false);
  assert.equal(checkShotKey("abc"), "pages/abc/check.jpg");
});

test("wiring: the check route asks for the owner, rate-limits, and spends the budget only after that", () => {
  const route = src("src/routes/page-tools.ts");
  const check = route.slice(route.indexOf('pageTools.post("/pages/:id/check"'), route.indexOf('pageTools.get("/pages/:id/check.jpg"'));
  assert.match(check, /pageTools\.post\("\/pages\/:id\/check", requireCsrfHeader, rateLimit\(TIERS\.page_check\), async/);
  const access = check.indexOf("const access = await ownerAccess(c, page, sentUpdateToken(c, body.update_token));");
  const refused = check.indexOf("if (!access.ok) return c.json({ error: access.error }, access.status);");
  const burst = check.indexOf("underBurstLimit(c.env.CHECK_BURST, await callerKey(c))");
  const render = check.indexOf("await checkPage(c.env, id, html, viewport)");
  assert.ok(access > 0 && refused > access && burst > refused && render > burst, "owner check, then the burst guard, then the browser");
  assert.match(check, /err\.reason === "budget" \? 429 : 503/);
  // The screenshot is served only for a live page, with its key, never cached by a shared cache.
  const shot = route.slice(route.indexOf('pageTools.get("/pages/:id/check.jpg"'), route.indexOf('pageTools.get("/pages/:id/source"'));
  assert.match(shot, /live = await loadPage\(c\.env, id\)/);
  assert.match(shot, /shotKeyValid\(sent, obj\.customMetadata\?\.key, obj\.customMetadata\?\.expires, Date\.now\(\)\)/);
  assert.match(shot, /"Cache-Control": "private, max-age=3600"/);
  // Source is owner-only too.
  const source = route.slice(route.indexOf('pageTools.get("/pages/:id/source"'));
  assert.match(source, /const access = await ownerAccess\(c, page, sentUpdateToken\(c\)\);\s*if \(!access\.ok\) return/);
  // checkPage gates on the budget before launching, and always records the time and closes the browser.
  const render2 = src("src/lib/og-render.ts");
  const fn = render2.slice(render2.indexOf("export async function checkPage"), render2.indexOf("async function observe("));
  assert.ok(fn.indexOf("await checkGate(env.DB, env, Date.now());") < fn.indexOf("puppeteer.launch(env.BROWSER)"));
  assert.match(fn, /finally \{\s*await browser\.close\(\)\.catch\(\(\) => \{\}\);\s*await recordCheckTime\(/);
  assert.match(src("src/lib/rate-limit-tiers.ts"), /page_check: +\{ bucketPrefix: 'rl:check', +limit: 20, windowSeconds: 3600 \}/);
  assert.match(src("wrangler.toml"), /name = "CHECK_BURST"\s*\nnamespace_id = "1008"\s*\nsimple = \{ limit = 3, period = 60 \}/);
  // Mounted before api.ts, so /api/pages/:id/check isn't taken by another route.
  const index = src("src/index.ts");
  assert.ok(index.indexOf('app.route("/api", pageTools);') < index.indexOf('app.route("/api", api);'));
});

test("local origins render at aired.sh, since Browser Rendering refuses local addresses", async () => {
  const { renderOrigin } = await import("../src/lib/og-shot.ts");
  for (const o of ["http://localhost:8821", "http://127.0.0.1:8787", "http://app.localhost", "http://192.168.1.5:8787", "http://10.0.0.2", "http://172.20.0.1"]) {
    assert.equal(renderOrigin(o), "https://aired.sh", o);
  }
  assert.equal(renderOrigin("https://aired.sh"), "https://aired.sh");
  assert.equal(renderOrigin("https://staging.example.com"), "https://staging.example.com");
  assert.equal(renderOrigin("http://172.32.0.1"), "http://172.32.0.1", "not private");
});
