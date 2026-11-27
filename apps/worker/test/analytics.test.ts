import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { fakeD1 } from "./helpers/d1.ts";
import { countCountryView, countPageView, countryTotals, pageViewCounts, viewCountOf } from "../src/lib/view-counts.ts";
import { referrerHost, viewEvent, viewerCountry } from "../src/lib/view-event.ts";
import { buildQueries, dayList, parseOffset, parseRange, runQuery, scopeFilter, shapeReport, windowDays } from "../src/lib/analytics.ts";
import { analytics } from "../src/routes/analytics.ts";
import { insertPageRow, rowFromMetadata } from "../src/lib/pages-store.ts";

const NOW = Date.parse("2026-11-27T12:00:00Z");

// ─── View counts (D1) ───

test("a page's first counted view starts from the count frozen in KV", async () => {
  const { db } = fakeD1();
  assert.deepEqual(await countPageView(db, "a", 41, null), { counted: true, count: 42 });
  // From then on D1 counts, whatever the stale KV number says.
  assert.deepEqual(await countPageView(db, "a", 41, null), { counted: true, count: 43 });
  assert.equal(viewCountOf(await pageViewCounts(db, ["a", "b"]), "a", 41), 43);
  assert.equal(viewCountOf(await pageViewCounts(db, ["a", "b"]), "b", 7), 7, "no row yet: the KV count");
});

test("a view limit holds: the view past it isn't counted", async () => {
  const { db } = fakeD1();
  assert.equal((await countPageView(db, "lim", 0, 2)).counted, true);
  assert.equal((await countPageView(db, "lim", 0, 2)).counted, true);
  assert.deepEqual(await countPageView(db, "lim", 0, 2), { counted: false });
  assert.equal((await pageViewCounts(db, ["lim"])).get("lim"), 2);
  // A page whose KV count already hit the limit never gets a row.
  assert.deepEqual(await countPageView(db, "old", 5, 5), { counted: false });
  assert.equal((await pageViewCounts(db, ["old"])).has("old"), false);
});

test("many views at once can't overshoot the limit", async () => {
  const { db } = fakeD1();
  const results = await Promise.all(Array.from({ length: 10 }, () => countPageView(db, "race", 0, 3)));
  assert.equal(results.filter((r) => r.counted).length, 3);
  assert.equal((await pageViewCounts(db, ["race"])).get("race"), 3);
});

test("view counts for a long list are read in chunks D1 accepts", async () => {
  const { db } = fakeD1();
  const ids = Array.from({ length: 250 }, (_, i) => `p${i}`);
  for (const id of ids.slice(0, 5)) await countPageView(db, id, 0, null);
  await countPageView(db, "p249", 0, null);
  const counts = await pageViewCounts(db, ids);
  assert.equal(counts.size, 6);
  assert.equal(counts.get("p249"), 1);
});

test("country totals count every view", async () => {
  const { db } = fakeD1();
  await countCountryView(db, "DE");
  await countCountryView(db, "DE");
  await countCountryView(db, "US");
  assert.deepEqual(await countryTotals(db), { DE: 2, US: 1 });
});

// ─── The Analytics Engine data point: no IP ───

const VISITOR = new Headers({
  "CF-Connecting-IP": "203.0.113.77",
  "X-Forwarded-For": "203.0.113.77, 10.0.0.1",
  "X-Real-IP": "203.0.113.77",
  "CF-IPCountry": "de",
  "User-Agent": "Mozilla/5.0 (Secret Device)",
  Cookie: "aired_session=abc123; pin_x=tok",
  Referer: "https://www.Mail.Google.com/mail/u/0/?q=private+client#inbox/123",
});

test("a view's data point has the page, owner, country, referrer host and day, and no IP", () => {
  const point = viewEvent({ pageId: "abc", ownerId: 33980210, headers: VISITOR, siteHost: "aired.sh", nowMs: NOW });
  assert.deepEqual(point, {
    indexes: ["abc"],
    blobs: ["abc", "33980210", "DE", "mail.google.com", "2026-11-27"],
    doubles: [1],
  });
  const json = JSON.stringify(point);
  for (const secret of ["203.0.113", "10.0.0.1", "Secret Device", "abc123", "tok", "private", "inbox", "/mail/"]) {
    assert.ok(!json.includes(secret), `the data point must not hold ${secret}`);
  }
});

test("viewEvent reads only the country and referrer headers", () => {
  const read: string[] = [];
  const spy = { get: (name: string) => { read.push(name.toLowerCase()); return VISITOR.get(name); } };
  viewEvent({ pageId: "abc", ownerId: null, headers: spy, siteHost: "aired.sh", nowMs: NOW });
  assert.deepEqual([...new Set(read)].sort(), ["cf-ipcountry", "referer"]);
});

test("the viewer never reads the visitor's address when serving a page", () => {
  const code = readFileSync(new URL("../src/routes/viewer.ts", import.meta.url), "utf8");
  const view = code.slice(code.indexOf('viewer.get("/p/:id"'), code.indexOf('viewer.post("/p/:id/verify-pin"'));
  assert.ok(view.includes("viewEvent("));
  assert.doesNotMatch(view, /CF-Connecting-IP|X-Forwarded-For|X-Real-IP|visitorNetwork/i);
});

test("referrers keep the host only, and aired itself counts as direct", () => {
  assert.equal(referrerHost("https://www.linkedin.com/feed/?trk=x", "aired.sh"), "linkedin.com");
  assert.equal(referrerHost("http://Slack.com./", "aired.sh"), "slack.com");
  assert.equal(referrerHost("android-app://com.slack/", "aired.sh"), "com.slack");
  assert.equal(referrerHost("https://aired.sh/p/abc", "aired.sh"), "");
  assert.equal(referrerHost("https://www.aired.sh/dashboard", "aired.sh"), "");
  assert.equal(referrerHost(null, "aired.sh"), "");
  assert.equal(referrerHost("not a url", "aired.sh"), "");
  assert.equal(referrerHost("file:///Users/me/page.html", "aired.sh"), "");
  assert.equal(referrerHost("javascript:alert(1)", "aired.sh"), "");
});

test("countries are two-letter codes or XX", () => {
  assert.equal(viewerCountry(new Headers({ "CF-IPCountry": "gb" })), "GB");
  assert.equal(viewerCountry(new Headers({ "CF-IPCountry": "T1" })), "T1");
  assert.equal(viewerCountry(new Headers({ "CF-IPCountry": "'; DROP" })), "XX");
  assert.equal(viewerCountry(new Headers()), "XX");
});

test("the dataset is bound in wrangler.toml", () => {
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /\[\[analytics_engine_datasets\]\]\s*\nbinding = "VIEWS"\s*\ndataset = "aired_views"/);
});

// ─── Query building ───

test("a page's queries filter on its index and the window's exact UTC days", () => {
  const q = buildQueries({ kind: "page", id: "Ab_9-x" }, { range: 7, offset: 0 }, NOW);
  for (const sql of [q.dayHosts, q.countries, q.referrers]) {
    assert.match(sql, /FROM aired_views WHERE index1 = 'Ab_9-x' AND timestamp > NOW\(\) - INTERVAL '8' DAY AND blob5 >= '2026-11-21' AND blob5 <= '2026-11-27'/);
    assert.match(sql, /SUM\(_sample_interval\) AS views/);
  }
  // The days query also reads the 7 days before, for the comparison.
  assert.match(q.days, /SELECT blob5 AS bucket, SUM\(_sample_interval\) AS views FROM aired_views WHERE index1 = 'Ab_9-x' AND timestamp > NOW\(\) - INTERVAL '15' DAY AND blob5 >= '2026-11-14' AND blob5 <= '2026-11-27' GROUP BY bucket ORDER BY bucket ASC/);
  assert.match(q.dayHosts, /SELECT blob5 AS bucket, blob4 AS host, .* GROUP BY bucket, host ORDER BY views DESC LIMIT 1000/);
  assert.match(q.countries, /SELECT blob3 AS code, .* ORDER BY views DESC LIMIT 50/);
  assert.match(q.referrers, /SELECT blob4 AS host, /);
  assert.equal(q.pages, undefined);
});

test("an offset steps back whole windows", () => {
  const q = buildQueries({ kind: "owner", ownerId: 33980210 }, { range: 30, offset: 2 }, NOW);
  assert.match(q.countries, /WHERE blob2 = '33980210' AND timestamp > NOW\(\) - INTERVAL '91' DAY AND blob5 >= '2026-08-30' AND blob5 <= '2026-09-28'/);
  assert.match(q.pages!, /SELECT blob1 AS id, SUM\(_sample_interval\) AS views .* LIMIT 50/);
  assert.deepEqual(windowDays({ range: 7, offset: 1 }, NOW), ["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
});

test("nothing from the request reaches the SQL unchecked", () => {
  assert.throws(() => scopeFilter({ kind: "page", id: "x' OR '1'='1" }));
  assert.throws(() => scopeFilter({ kind: "page", id: "" }));
  assert.throws(() => scopeFilter({ kind: "owner", ownerId: 1.5 }));
  assert.throws(() => scopeFilter({ kind: "owner", ownerId: -3 }));
  assert.throws(() => buildQueries({ kind: "owner", ownerId: 1 }, { range: 15 as never, offset: 0 }, NOW));
  assert.throws(() => buildQueries({ kind: "owner", ownerId: 1 }, { range: 30, offset: 3 }, NOW), "past three months");
  assert.throws(() => buildQueries({ kind: "owner", ownerId: 1 }, { range: 7, offset: -1 }, NOW));
});

test("ranges are 7, 30 or 90 days, 30 by default; offsets stay within 90 days", () => {
  assert.equal(parseRange(undefined), 30);
  assert.equal(parseRange(""), 30);
  assert.equal(parseRange("7"), 7);
  assert.equal(parseRange("90"), 90);
  assert.equal(parseRange("365"), null);
  assert.equal(parseRange("7; DROP"), null);
  assert.equal(parseOffset(undefined, 30), 0);
  assert.equal(parseOffset("2", 30), 2);
  assert.equal(parseOffset("3", 30), null);
  assert.equal(parseOffset("11", 7), 11);
  assert.equal(parseOffset("12", 7), null);
  assert.equal(parseOffset("1", 90), null);
  assert.equal(parseOffset("-1", 7), null);
  assert.equal(parseOffset("1.5", 7), null);
});

test("a report has every day in the window, zeros included, and numbers sent as strings", () => {
  const r = shapeReport({ range: 7, offset: 0 }, {
    days: [{ bucket: "2026-11-27", views: "5" }, { bucket: "2026-11-25", views: 2 }, { bucket: "2026-10-01", views: 9 }],
    countries: [{ code: "US", views: "6" }, { code: "", views: 1 }, { code: "DE", views: 0 }],
    referrers: [{ host: "", views: 4 }, { host: "slack.com", views: 3 }],
  }, NOW);
  assert.deepEqual(r.days.map((d) => d.day), dayList(7, NOW));
  assert.equal(r.days.length, 7);
  assert.deepEqual(r.days.map((d) => d.views), [0, 0, 0, 0, 2, 0, 5]);
  assert.equal(r.total, 7, "days outside the window don't count");
  assert.equal(r.previousTotal, null, "no views the week before: nothing to compare with");
  assert.deepEqual(r.countries, [{ code: "US", views: 6 }, { code: "XX", views: 1 }]);
  assert.deepEqual(r.referrers, [{ host: "", views: 4 }, { host: "slack.com", views: 3 }]);
});

test("the report compares with the window before and names the busiest day's top source", () => {
  const r = shapeReport({ range: 7, offset: 0 }, {
    days: [{ bucket: "2026-11-14", views: 3 }, { bucket: "2026-11-20", views: 7 }, { bucket: "2026-11-24", views: 9 }, { bucket: "2026-11-26", views: 4 }],
    dayHosts: [{ bucket: "2026-11-24", host: "", views: 3 }, { bucket: "2026-11-24", host: "app.slack.com", views: 6 }, { bucket: "2026-11-26", host: "t.co", views: 4 }],
    countries: [],
    referrers: [],
  }, NOW);
  assert.equal(r.total, 13);
  assert.equal(r.previousTotal, 10);
  assert.deepEqual(r.peak, { day: "2026-11-24", views: 9, host: "app.slack.com" });
  const empty = shapeReport({ range: 7, offset: 0 }, { days: [], countries: [], referrers: [] }, NOW);
  assert.equal(empty.peak, null);
  assert.equal(empty.total, 0);
});

test("runQuery posts the SQL with the token and reads the JSON rows", async () => {
  let seen: { url: string; auth: string; body: string } | null = null;
  const rows = await runQuery(async (url, init) => {
    seen = { url, auth: init.headers.Authorization!, body: init.body };
    return Response.json({ meta: [], data: [{ code: "US", views: "3" }], rows: 1 });
  }, { accountId: "a".repeat(32), token: "tok" }, "SELECT 1");
  assert.deepEqual(seen, { url: `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/analytics_engine/sql`, auth: "Bearer tok", body: "SELECT 1" });
  assert.deepEqual(rows, [{ code: "US", views: "3" }]);
  await assert.rejects(runQuery(async () => new Response("no", { status: 403 }), { accountId: "a".repeat(32), token: "t" }, "x"));
});

// ─── The route: gating and ownership ───

const PRO_UID = 33980210;
const FREE_UID = 5;

function setup(over: Record<string, unknown> = {}) {
  const { db } = fakeD1();
  const kv = {
    async get(key: string) {
      return key === `ent:${PRO_UID}` ? { status: "active", currentPeriodEnd: "2099-01-01T00:00:00Z" } : null;
    },
  };
  const env = {
    DB: db,
    PAGES_KV: kv,
    BILLING_ENABLED: "1",
    CF_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
    CF_ANALYTICS_TOKEN: "test-token",
    ...over,
  };
  return { db, env };
}

function appFor(uid: number | null) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user" as never, (uid === null ? null : { id: uid, login: "x", email: null, name: null }) as never);
    await next();
  });
  app.route("/api/me/analytics", analytics as never);
  return app;
}

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} };

async function addPage(db: D1Database, id: string, ownerId: number | null, deleted = false) {
  const row = rowFromMetadata({
    id, title: `Title ${id}`, size: 10, tokenHash: "h", pin: null, reads: null, readCount: 0, permanent: true,
    createdAt: new Date(NOW).toISOString(), expiresAt: null, ownerId, project: null,
  }, null, NOW);
  await insertPageRow(db, { ...row, deletedAt: deleted ? NOW : null });
}

/** Stub fetch for one test: records the SQL and answers with `data`. */
function stubFetch(data: (sql: string) => unknown[]) {
  const sent: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    sent.push(init.body);
    return Response.json({ data: data(init.body) });
  }) as typeof fetch;
  return { sent, restore: () => { globalThis.fetch = real; } };
}

test("signed out gets 401", async () => {
  const { env } = setup();
  const res = await appFor(null).request("/api/me/analytics", {}, env, ctx);
  assert.equal(res.status, 401);
});

test("Free gets a 402 plan_limit with an upgrade link, and nothing is queried", async () => {
  const { env, db } = setup();
  await addPage(db, "mine", FREE_UID);
  const f = stubFetch(() => []);
  try {
    for (const path of ["/api/me/analytics", "/api/me/analytics/pages/mine?range=7"]) {
      const res = await appFor(FREE_UID).request(path, {}, env, ctx);
      assert.equal(res.status, 402);
      const body = (await res.json()) as Record<string, string>;
      assert.equal(body.code, "plan_limit");
      assert.equal(body.limit, "analytics");
      assert.equal(body.upgrade_url, "https://aired.sh/pricing?ref=analytics");
    }
    assert.equal(f.sent.length, 0);
  } finally {
    f.restore();
  }
});

test("with billing off everyone is Free, so analytics is locked", async () => {
  const { env } = setup({ BILLING_ENABLED: "" });
  const res = await appFor(PRO_UID).request("/api/me/analytics", {}, env, ctx);
  assert.equal(res.status, 402);
});

test("Pro sees their own page's numbers", async () => {
  const { env, db } = setup();
  await addPage(db, "mine", PRO_UID);
  const today = new Date().toISOString().slice(0, 10);
  const f = stubFetch((sql) =>
    sql.startsWith("SELECT blob3 AS code") ? [{ code: "US", views: "4" }]
      : sql.startsWith("SELECT blob5 AS bucket, SUM") ? [{ bucket: today, views: 4 }]
        : sql.startsWith("SELECT blob5 AS bucket, blob4") ? [{ bucket: today, host: "t.co", views: 4 }]
          : []);
  try {
    const res = await appFor(PRO_UID).request("/api/me/analytics/pages/mine?range=7", {}, env, ctx);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { total: number; days: unknown[]; countries: unknown[]; page: { id: string }; peak: unknown; previousTotal: unknown };
    assert.equal(body.days.length, 7);
    assert.equal(body.total, 4);
    assert.deepEqual(body.peak, { day: today, views: 4, host: "t.co" });
    assert.equal(body.previousTotal, null);
    assert.deepEqual(body.countries, [{ code: "US", views: 4 }]);
    assert.equal(body.page.id, "mine");
    assert.equal(f.sent.length, 4);
    assert.ok(f.sent.every((sql) => sql.includes("index1 = 'mine'")));
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
  } finally {
    f.restore();
  }
});

test("someone else's page, a deleted page or a missing one is 404", async () => {
  const { env, db } = setup();
  await addPage(db, "theirs", 99);
  await addPage(db, "gone", PRO_UID, true);
  await addPage(db, "anon", null);
  const f = stubFetch(() => []);
  try {
    for (const id of ["theirs", "gone", "anon", "nope", "bad%27id"]) {
      const res = await appFor(PRO_UID).request(`/api/me/analytics/pages/${id}`, {}, env, ctx);
      assert.equal(res.status, 404, id);
    }
    assert.equal(f.sent.length, 0);
  } finally {
    f.restore();
  }
});

test("the summary lists only pages the caller still owns, with titles", async () => {
  const { env, db } = setup();
  await addPage(db, "a", PRO_UID);
  await addPage(db, "b", 99);
  const f = stubFetch((sql) => (sql.includes("blob1 AS id") ? [{ id: "a", views: 5 }, { id: "b", views: 3 }] : []));
  try {
    const res = await appFor(PRO_UID).request("/api/me/analytics?range=90", {}, env, ctx);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { pages: unknown[]; days: unknown[] };
    assert.deepEqual(body.pages, [{ id: "a", views: 5, title: "Title a" }]);
    assert.equal(body.days.length, 90);
    assert.ok(f.sent.every((sql) => sql.includes(`blob2 = '${PRO_UID}'`)));
  } finally {
    f.restore();
  }
});

test("a bad range is 400, and no token set up is 503", async () => {
  const { env } = setup();
  assert.equal((await appFor(PRO_UID).request("/api/me/analytics?range=365", {}, env, ctx)).status, 400);
  assert.equal((await appFor(PRO_UID).request("/api/me/analytics?range=30&offset=3", {}, env, ctx)).status, 400);
  const res = await appFor(PRO_UID).request("/api/me/analytics", {}, setup({ CF_ANALYTICS_TOKEN: "" }).env, ctx);
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as { code: string }).code, "analytics_unavailable");
});

test("a failed query is a 503, not a crash", async () => {
  const { env } = setup();
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response("rate limited", { status: 429 })) as typeof fetch;
  try {
    const res = await appFor(PRO_UID).request("/api/me/analytics", {}, env, ctx);
    assert.equal(res.status, 503);
  } finally {
    globalThis.fetch = real;
  }
});
