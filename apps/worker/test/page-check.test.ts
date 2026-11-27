import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeD1 } from "./helpers/d1.ts";
import {
  buildReport,
  checkBudgetMs,
  CALLER_BUDGET_MS,
  callerRow,
  CHECK_RESERVE_MS,
  checkGate,
  CheckUnavailable,
  checkShotKey,
  checkShotPrefix,
  relativeFileMiss,
  reserveCheckTime,
  settleCheckTime,
  SHOT_URL_KEY,
  shotUnexpired,
  DEFAULT_CHECK_BUDGET_MS,
  MAX_CONSOLE,
  parseViewport,
  reportText,
  secondsToNextUtcDay,
  type CheckObservations,
} from "../src/lib/page-check.ts";
import { addSpent, DEFAULT_DAILY_BUDGET_MS, readBudget, setBlocked, utcDay } from "../src/lib/og-shot.ts";

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

test("the checks' budget: 10 minutes by default, never more than the whole browser budget, 0 turns it off", () => {
  const total = 40 * 60 * 1000;
  assert.equal(checkBudgetMs(undefined, total), DEFAULT_CHECK_BUDGET_MS);
  assert.equal(checkBudgetMs("60", total), 60_000);
  assert.equal(checkBudgetMs("9999", total), total);
  assert.equal(checkBudgetMs("0", total), 0);
  assert.equal(checkBudgetMs("junk", total), DEFAULT_CHECK_BUDGET_MS);
  assert.equal(checkBudgetMs(undefined, 0), 0, "screenshots off means checks off");
});

const ANON = { key: "ip:abc", signedIn: false };
const KIM = { key: "u:7", signedIn: true };
const gateFails = async (db: D1Database, vars = {}, now = NOW, caller = KIM) => {
  try {
    await checkGate(db as never, vars, now, caller);
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
  await addSpent(db as never, DEFAULT_DAILY_BUDGET_MS, NOW);
  assert.equal((await gateFails(db))?.reason, "budget");
  assert.equal(await gateFails(db, { OG_SHOT_DAILY_SECONDS: String(DEFAULT_DAILY_BUDGET_MS / 1000 + 60) }), null, "a bigger budget lets it run");
  assert.equal((await gateFails(fakeD1().db, { CHECK_DAILY_SECONDS: "0" }))?.reason, "budget", "0 turns checks off");
});

test("gate: each caller has a daily share, smaller without an account", async () => {
  const { db } = fakeD1();
  await addSpent(db as never, CALLER_BUDGET_MS.anonymous, NOW, callerRow(ANON));
  assert.equal((await gateFails(db, {}, NOW, ANON))?.reason, "budget", "this IP's share is spent");
  assert.equal(await gateFails(db, {}, NOW, KIM), null, "everyone else can still check");
  await addSpent(db as never, CALLER_BUDGET_MS.signedIn - 1, NOW, callerRow(KIM));
  assert.equal(await gateFails(db, {}, NOW, KIM), null);
  await addSpent(db as never, 1, NOW, callerRow(KIM));
  assert.equal((await gateFails(db, {}, NOW, KIM))?.reason, "budget");
});

test("gate: a short Browser Rendering block is 'busy' with its seconds, a spent cap is 'budget' until midnight", async () => {
  const { db } = fakeD1();
  await setBlocked(db as never, NOW + 60_000);
  let err = await gateFails(db);
  assert.equal(err?.reason, "busy");
  assert.equal(err?.waitSeconds, 60);
  assert.equal(await gateFails(db, {}, NOW + 61_000), null);
  await setBlocked(db as never, NOW + 30_000, "check");
  assert.equal((await gateFails(db))?.reason, "busy", "a block on the checks' row holds back checks");
  await addSpent(db as never, DEFAULT_CHECK_BUDGET_MS, NOW, "check");
  err = await gateFails(db);
  assert.equal(err?.reason, "budget", "spent wins over a short block");
  assert.equal(err?.waitSeconds, 9 * 3600);
});

test("gate: a D1 error is 'storage', not a broken page", async () => {
  const d = fakeD1();
  d.fail(/og_shot_budget/);
  assert.equal((await gateFails(d.db))?.reason, "storage");
});

test("reserve then settle: time is charged before the browser starts, and only the real time stays", async () => {
  const { db } = fakeD1();
  const reserved = await reserveCheckTime(db as never, KIM, NOW);
  assert.equal(reserved, CHECK_RESERVE_MS);
  for (const name of ["browser", "check", callerRow(KIM)]) assert.equal((await readBudget(db as never, name))?.spentMs, CHECK_RESERVE_MS, name);
  // A second check started now sees the first one's reservation.
  await addSpent(db as never, DEFAULT_CHECK_BUDGET_MS - 2 * CHECK_RESERVE_MS, NOW, "check");
  await reserveCheckTime(db as never, ANON, NOW);
  assert.equal((await gateFails(db, {}, NOW, { key: "u:9", signedIn: true }))?.reason, "budget", "two in-flight checks fill the share");
  await settleCheckTime(db as never, KIM, reserved, 9_000, NOW);
  assert.equal((await readBudget(db as never, callerRow(KIM)))?.spentMs, 9_000);
  assert.equal((await readBudget(db as never))?.spentMs, CHECK_RESERVE_MS * 2 - reserved + 9_000);
  // Settling never takes a row below zero, and callers' rows from earlier days are dropped.
  await settleCheckTime(db as never, ANON, 999_999, 0, NOW);
  assert.equal((await readBudget(db as never, callerRow(ANON)))?.spentMs, 0);
  await addSpent(db as never, 5_000, NOW - 2 * 86_400_000, "check:ip:old");
  await settleCheckTime(db as never, KIM, 0, 0, NOW);
  assert.equal(await readBudget(db as never, "check:ip:old"), null);
});

test("screenshots: one object per check under the page, named by the key's hash, for 24 hours", () => {
  assert.equal(checkShotKey("abc", "f00d"), "pages/abc/checks/f00d.jpg");
  assert.ok(checkShotKey("abc", "x").startsWith(checkShotPrefix("abc")));
  assert.ok(SHOT_URL_KEY.test("0123456789abcdef0123456789abcdef"));
  assert.ok(!SHOT_URL_KEY.test("0123456789abcdef"));
  assert.ok(!SHOT_URL_KEY.test("../../pages/abc/index.html"));
  assert.equal(shotUnexpired(String(NOW + 1000), NOW), true);
  assert.equal(shotUnexpired(String(NOW), NOW), false);
  assert.equal(shotUnexpired(undefined, NOW), false);
});

test("relative files a visitor would also lose are told apart from aired requests blocked on purpose", () => {
  const o = "https://aired.sh";
  for (const t of ["https://aired.sh/p/app.js", "https://aired.sh/p/data.json", "https://aired.sh/p/img/x.png"]) assert.equal(relativeFileMiss(t, o), true, t);
  for (const t of ["https://aired.sh/p/AbC123", "https://aired.sh/favicon.ico", "https://aired.sh/api/stats", "https://cdn.example/p/app.js"]) assert.equal(relativeFileMiss(t, o), false, t);
});

test("wiring: the check route asks for the owner, rate-limits, and spends the budget only after that", () => {
  const route = src("src/routes/page-tools.ts");
  const check = route.slice(route.indexOf('pageTools.post("/pages/:id/check"'), route.indexOf('pageTools.get("/pages/:id/check.jpg"'));
  assert.match(check, /pageTools\.post\("\/pages\/:id\/check", requireCsrfHeader, rateLimit\(TIERS\.page_check\), async/);
  const access = check.indexOf("const access = await ownerAccess(c, page, sentUpdateToken(c, body.update_token));");
  const refused = check.indexOf("if (!access.ok) return apiError(c, access.status, access.code, access.error);");
  const burst = check.indexOf("underBurstLimit(c.env.CHECK_BURST, caller.key)");
  const render = check.indexOf("await checkPage(c.env, id, html, viewport, caller)");
  assert.ok(access > 0 && refused > access && burst > refused && render > burst, "owner check, then the burst guard, then the browser");
  // A page changed mid-check gets no screenshot of its old version.
  assert.match(check, /if \(current !== null && current\.etag === obj\.etag\) \{/);
  // The screenshot needs its key (looked up by hash), a live page, and is never cached.
  const shot = route.slice(route.indexOf('pageTools.get("/pages/:id/check.jpg"'), route.indexOf('pageTools.get("/pages/:id/source"'));
  assert.match(shot, /checkShotKey\(id, await hashToHex\(sent, 32\)\)/);
  assert.match(shot, /live = await loadPage\(c\.env, id\)/);
  assert.match(shot, /"Cache-Control": "private, no-store"/);
  // Source is owner-only too.
  const source = route.slice(route.indexOf('pageTools.get("/pages/:id/source"'));
  assert.match(source, /const access = await ownerAccess\(c, page, sentUpdateToken\(c\)\);\s*if \(!access\.ok\) return/);
  // checkPage gates and reserves before launching, and always settles and closes the browser.
  const render2 = src("src/lib/og-render.ts");
  const fn = render2.slice(render2.indexOf("export async function checkPage"), render2.indexOf("async function observe("));
  const gate = fn.indexOf("await checkGate(env.DB, env, Date.now(), caller);");
  const reserve = fn.indexOf("reserved = await reserveCheckTime(env.DB, caller, Date.now());");
  assert.ok(gate > 0 && reserve > gate && fn.indexOf("puppeteer.launch(env.BROWSER)") > reserve);
  assert.match(fn, /finally \{\s*await browser\.close\(\)\.catch\(\(\) => \{\}\);\s*await settle\(\);/);
  // Only the account's daily limit blocks screenshots; "too many browsers" blocks checks.
  assert.match(fn, /setBlocked\(env\.DB, until, daily \? BUDGET_ROW : CHECK_BUDGET_ROW\)/);
  // Popups are closed, and aired's own hosts stay blocked.
  assert.match(render2, /page\.on\("popup", \(p\) => \{\s*p\?\.close\(\)/);
  assert.match(render2, /host\.startsWith\("aired\."\) && host\.endsWith\("\.workers\.dev"\)/);
  assert.match(src("src/lib/rate-limit-tiers.ts"), /page_check: +\{ bucketPrefix: 'rl:check', +limit: 20, windowSeconds: 3600 \}/);
  assert.match(src("wrangler.toml"), /name = "CHECK_BURST"\s*\nnamespace_id = "1009"\s*\nsimple = \{ limit = 3, period = 60 \}/);
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
