import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./helpers/worker-loader.ts";
import "./helpers/worker-stubs.ts";
import { fakeD1 } from "./helpers/d1.ts";

// Per-slide analytics for decks: the beacon a deck's viewer sends
// (lib/slide-beacon.ts, POST /c/:id/slide), the data point it writes
// (lib/slide-event.ts), and the owner's read (GET /api/pages/:id/slides,
// lib/slide-analytics.ts). Real routes on fake bindings.
const { Hono } = await import("hono");
const { viewer } = await import("../src/routes/viewer.ts");
const { collect } = await import("../src/routes/collect.ts");
const { slides } = await import("../src/routes/slides.ts");
const { insertPageRow, rowFromMetadata } = await import("../src/lib/pages-store.ts");
const { serializeMetadata, hashToken } = await import("@aired/core");
const { mintSlideToken, verifySlideToken, mintWatchToken, pageGate } = await import("../src/lib/collect-token.ts");
const { loadPage, deletePage } = await import("../src/lib/page-write.ts");
const { injectDeckRuntime, parseHtmlDeck, MAX_SLIDES } = await import("../src/lib/deck.ts");
const { buildContent: prepareContent } = await import("../src/lib/page-content.ts");
const { SLIDE_EVENT_LIMIT, SLIDE_TOKEN_SECONDS } = await import("../src/lib/collect-limits.ts");
const { SLIDES_DATASET, SLIDE_MAX_SLIDE, dwellBucket, parseBeacon, slideEvent } = await import("../src/lib/slide-event.ts");
const { buildSlideQuery, shapeSlides, weightedMedian } = await import("../src/lib/slide-analytics.ts");
const { slideBeaconWanted } = await import("../src/lib/slide-beacon.ts");

const SECRET = "test-session-secret-0123456789abcdef";
const NOW = Date.now();
const PRO = 7;
const FREE = 8;

const DECK_SOURCE = `<!doctype html><html><head><meta name="aired" content="deck"><title>Pitch</title></head><body>
<section><h1>Hello</h1><aside class="notes">secret note</aside></section>
<section><h2>Problem</h2></section>
<section><p>No heading here</p></section>
</body></html>`;
const PLAIN = "<html><head></head><body>Just a page</body></html>";

function fakeR2() {
  const objects = new Map<string, string>();
  const etags = new Map<string, string>();
  let n = 0;
  return {
    objects,
    async get(key: string) {
      const v = objects.get(key);
      return v === undefined ? null : { etag: etags.get(key) ?? "e1", async text() { return v; }, body: new Blob([v]).stream() };
    },
    async head(key: string) { return objects.has(key) ? { key, etag: etags.get(key) ?? "e1" } : null; },
    async put(key: string, v: string) { objects.set(key, v); etags.set(key, `e${++n}`); return { key, etag: etags.get(key) }; },
    async delete(keys: string | string[]) { for (const k of Array.isArray(keys) ? keys : [keys]) { objects.delete(k); etags.delete(k); } },
    async list() { return { objects: [], truncated: false }; },
  };
}

function fakeKv(store: Map<string, string>) {
  return {
    async get(key: string, opts?: unknown) {
      const v = store.get(key) ?? null;
      return v !== null && typeof opts === "object" && opts !== null && (opts as { type?: string }).type === "json" ? JSON.parse(v) : v;
    },
    async put(key: string, v: string) { store.set(key, v); },
    async delete(key: string) { store.delete(key); },
  };
}

type Limiter = { limit(o: { key: string }): Promise<{ success: boolean }> };

async function setup(over: Record<string, unknown> = {}) {
  const { db, raw } = fakeD1();
  const r2 = fakeR2();
  const kv = new Map<string, string>();
  kv.set(`ent:${PRO}`, JSON.stringify({ status: "active", currentPeriodEnd: "2099-01-01T00:00:00Z" }));
  const tokenHash = await hashToken("tok_page_update_secret");
  const add = async (id: string, ownerId: number | null, source: string) => {
    const content = prepareContent({ html: source });
    const meta = {
      id, title: id, size: content.html.length, tokenHash, pin: null, reads: null, readCount: 0, permanent: true,
      createdAt: new Date(NOW - 1000).toISOString(), expiresAt: null, ownerId, project: null,
    };
    await insertPageRow(db, rowFromMetadata(meta as never, null, NOW));
    kv.set(`page:${id}`, serializeMetadata(meta as never));
    await r2.put(`pages/${id}/index.html`, content.html);
    if (content.sidecar !== null) await r2.put(`pages/${id}/doc.json`, JSON.stringify(content.sidecar));
  };
  await add("deck", PRO, DECK_SOURCE);
  await add("deck2", PRO, DECK_SOURCE);
  await add("freedeck", FREE, DECK_SOURCE);
  await add("anondeck", null, DECK_SOURCE);
  await add("plain", PRO, PLAIN);
  const points: Array<{ indexes: string[]; blobs: string[]; doubles: number[] }> = [];
  const env: Record<string, unknown> = {
    DB: db, PAGES_BUCKET: r2, PAGES_KV: fakeKv(kv), SESSION_SECRET: SECRET, SITE_ORIGIN: "https://aired.test", BILLING_ENABLED: "1",
    SLIDES: { writeDataPoint(p: never) { points.push(p); } },
    CF_ACCOUNT_ID: "0123456789abcdef0123456789abcdef", CF_ANALYTICS_TOKEN: "test-token",
    ...over,
  };
  const app = new Hono();
  app.use("*", async (c, next) => {
    const uid = c.req.header("X-Test-User");
    c.set("user" as never, (uid ? { id: Number(uid), login: `u${uid}`, email: null, name: null } : null) as never);
    await next();
  });
  app.route("/", collect);
  app.route("/api", slides);
  app.route("/", viewer);
  const fetch = (path: string, init: RequestInit & { user?: number; ip?: string } = {}) => {
    const headers = new Headers(init.headers);
    headers.set("CF-Connecting-IP", init.ip ?? "198.51.100.9");
    if (init.user !== undefined) headers.set("X-Test-User", String(init.user));
    return app.fetch(new Request(`https://aired.test${path}`, { ...init, headers }), env as never, { waitUntil() {}, passThroughOnException() {} } as never);
  };
  /** Open a page; returns the slide beacon's config if the page got one. */
  const open = async (id: string, user?: number) => {
    const res = await fetch(`/p/${id}`, user !== undefined ? { user } : {});
    const html = await res.text();
    const m = /var S=(\{[^;]*\}),d=document/.exec(html);
    const live = /var L=(\{[^;]*\}),F=/.exec(html);
    return {
      html,
      beacon: m ? (JSON.parse(m[1]!) as { url: string; token: string }) : null,
      live: live ? (JSON.parse(live[1]!) as { token: string; etag: string }) : null,
    };
  };
  /** A beacon as navigator.sendBeacon sends it: text/plain JSON, no cookies. */
  const beacon = (id: string, body: Record<string, unknown>, ip?: string) =>
    fetch(`/c/${id}/slide`, { method: "POST", headers: { "Content-Type": "text/plain", Origin: "null" }, body: JSON.stringify(body), ...(ip ? { ip } : {}) });
  return { db, raw, env, kv, r2, points, fetch, open, beacon };
}

const json = async (res: Response) => (await res.json()) as Record<string, any>;

// --- The token --------------------------------------------------------------

test("a slide token is for one page, signed, and expires", async () => {
  const gate = await pageGate(SECRET, "deck", null);
  const exp = Math.floor(NOW / 1000) + 60;
  const token = await mintSlideToken(SECRET, "deck", exp, gate);
  assert.match(token, /^s1\.deck\.\d+\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(await verifySlideToken(SECRET, "deck", token, exp - 1), { ok: true, gate });
  assert.deepEqual(await verifySlideToken(SECRET, "deck2", token, exp - 1), { ok: false, reason: "wrong_page" });
  assert.deepEqual(await verifySlideToken(SECRET, "deck", token, exp), { ok: false, reason: "expired" });
  assert.deepEqual(await verifySlideToken("another-secret-0123456789", "deck", token, exp - 1), { ok: false, reason: "bad_signature" });
  // Signed for its own purpose: a watch token with the same fields isn't one.
  const watch = await mintWatchToken(SECRET, "deck", exp, gate);
  assert.equal((await verifySlideToken(SECRET, "deck", "s1" + watch.slice(2), exp - 1)).ok, false);
  for (const bad of [undefined, 42, "", "s1.deck", "x".repeat(400)]) assert.equal((await verifySlideToken(SECRET, "deck", bad, exp - 1)).ok, false);
});

// --- Who gets the beacon -----------------------------------------------------

test("only a Pro owner's deck, opened by someone else, gets the beacon", () => {
  const deckHtml = injectDeckRuntime(parseHtmlDeck(DECK_SOURCE).html);
  const base = { html: deckHtml, ownerId: PRO, viewerId: null, plan: "pro" as const };
  assert.equal(slideBeaconWanted(base), true);
  assert.equal(slideBeaconWanted({ ...base, html: PLAIN }), false, "not a deck");
  assert.equal(slideBeaconWanted({ ...base, ownerId: null }), false, "anonymous deck: nobody to see the numbers");
  assert.equal(slideBeaconWanted({ ...base, plan: "free" }), false, "Free owner: nothing is collected");
  assert.equal(slideBeaconWanted({ ...base, viewerId: PRO }), false, "the owner's own views don't count");
  assert.equal(slideBeaconWanted({ ...base, viewerId: 99 }), true, "another signed-in person counts");
});

test("serving: a deck gets the beacon script; a plain page, a Free deck, an anonymous deck and the owner don't", async () => {
  const t = await setup();
  const deck = await t.open("deck");
  assert.ok(deck.beacon !== null, "the deck has the beacon");
  assert.equal(deck.beacon!.url, "https://aired.test/c/deck/slide");
  assert.match(deck.beacon!.token, /^s1\.deck\./);
  assert.ok(deck.html.includes("sendBeacon"), "uses sendBeacon");
  assert.ok(deck.html.includes("visibilitychange") && deck.html.includes("pagehide"), "flushes when the tab hides or closes");
  assert.ok(!deck.html.includes("secret note"), "notes stay out of the page");
  for (const [id, user] of [["plain", undefined], ["freedeck", undefined], ["anondeck", undefined], ["deck", PRO]] as const) {
    const got = await t.open(id, user);
    assert.equal(got.beacon, null, `${id} as ${user ?? "visitor"}`);
    assert.ok(!got.html.includes("/slide\""), id);
  }
});

// --- The beacon ---------------------------------------------------------------

test("a beacon's fields: a whole slide number, at least a second on screen, dwell clamped", () => {
  assert.equal(SLIDE_MAX_SLIDE, MAX_SLIDES);
  assert.deepEqual(parseBeacon({ slide: 3, ms: 4200, first: true }), { ok: true, beacon: { slide: 3, ms: 4200, first: true } });
  assert.deepEqual(parseBeacon({ slide: 1, ms: 9_999_999 }), { ok: true, beacon: { slide: 1, ms: 1_800_000, first: false } });
  for (const bad of [{ slide: 0, ms: 2000 }, { slide: 301, ms: 2000 }, { slide: 2.5, ms: 2000 }, { slide: "2", ms: 2000 }, { slide: 2, ms: 999 }, { slide: 2, ms: "5000" }, { slide: 2, ms: NaN }, { slide: 2 }]) {
    assert.equal(parseBeacon(bad as Record<string, unknown>).ok, false, JSON.stringify(bad));
  }
});

test("dwell is kept in buckets: seconds, then coarser steps, at most 30 minutes", () => {
  assert.equal(dwellBucket(1000), 1);
  assert.equal(dwellBucket(1499), 1);
  assert.equal(dwellBucket(7600), 8);
  assert.equal(dwellBucket(12_400), 10);
  assert.equal(dwellBucket(13_000), 15);
  assert.equal(dwellBucket(95_000), 90);
  assert.equal(dwellBucket(400_000), 420);
  assert.equal(dwellBucket(10_000_000), 1800);
});

test("a slide's data point: page, day, slide, dwell bucket, first visit; nothing about the viewer", () => {
  const point = slideEvent({ pageId: "deck", beacon: { slide: 4, ms: 6100, first: true }, nowMs: Date.parse("2026-11-28T09:00:00Z") });
  assert.deepEqual(point, { indexes: ["deck"], blobs: ["deck", "2026-11-28"], doubles: [4, 6, 1] });
  assert.equal(SLIDES_DATASET, "aired_slides");
});

test("a beacon from the deck is written to Analytics Engine and answered 204", async () => {
  const t = await setup();
  const { beacon } = await t.open("deck");
  const res = await t.beacon("deck", { token: beacon!.token, slide: 2, ms: 3400, first: true });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(t.points.length, 1);
  assert.deepEqual(t.points[0]!.indexes, ["deck"]);
  assert.deepEqual(t.points[0]!.doubles, [2, 3, 1]);
  const stored = JSON.stringify(t.points);
  for (const secret of ["198.51.100", beacon!.token]) assert.ok(!stored.includes(secret), `the data point must not hold ${secret}`);
});

test("the beacon refuses bad, forged, other pages' and watch tokens, and bad fields, writing nothing", async () => {
  const t = await setup();
  const { beacon } = await t.open("deck");
  const plain = await t.open("plain");
  assert.ok(plain.live !== null);
  const send = (id: string, body: Record<string, unknown>) => t.beacon(id, body);
  // Another page's slide token.
  assert.equal((await send("deck2", { token: beacon!.token, slide: 1, ms: 2000 })).status, 403);
  // A plain page has no slide token; its watch token isn't one.
  assert.equal((await send("plain", { token: plain.live!.token, slide: 1, ms: 2000 })).status, 403);
  // Forged and expired.
  const [s1, page, , gate, sig] = beacon!.token.split(".");
  assert.equal((await send("deck", { token: `${s1}.${page}.9999999999.${gate}.${sig}`, slide: 1, ms: 2000 })).status, 403);
  const old = await mintSlideToken(SECRET, "deck", Math.floor(NOW / 1000) - 5, gate!);
  const expired = await send("deck", { token: old, slide: 1, ms: 2000 });
  assert.equal(expired.status, 403);
  assert.equal((await json(expired)).code, "expired");
  // Bad fields.
  assert.equal((await send("deck", { token: beacon!.token, slide: 500, ms: 2000 })).status, 422);
  assert.equal((await send("deck", { token: beacon!.token, slide: 1, ms: 10 })).status, 422);
  assert.equal((await t.fetch("/c/deck/slide", { method: "POST", body: "not json" })).status, 400);
  assert.equal((await t.fetch("/c/deck/slide", { method: "GET" })).status, 404);
  assert.equal(t.points.length, 0);
});

test("the token lasts a day; a deleted page or a new PIN ends it", async () => {
  assert.equal(SLIDE_TOKEN_SECONDS, 24 * 3600);
  const t = await setup();
  const a = (await t.open("deck")).beacon!;
  const b = (await t.open("deck2")).beacon!;
  // A new PIN: the gate changes.
  t.raw.prepare("UPDATE pages SET pin = 'pbkdf2$new' WHERE id = 'deck'").run();
  const meta = JSON.parse(t.kv.get("page:deck")!);
  t.kv.set("page:deck", JSON.stringify({ ...meta, pin: "pbkdf2$new" }));
  const res = await t.beacon("deck", { token: a.token, slide: 1, ms: 2000 });
  assert.equal(res.status, 403);
  // Deleted.
  await deletePage(t.env as never, (await loadPage(t.env as never, "deck2"))!, () => {});
  assert.equal((await t.beacon("deck2", { token: b.token, slide: 1, ms: 2000 })).status, 410);
  assert.equal(t.points.length, 0);
});

test("rate limit: per network per minute (SLIDE_BURST), before anything is read or written", async () => {
  const keys: string[] = [];
  const denying: Limiter = { async limit({ key }) { keys.push(key); return { success: false }; } };
  const t = await setup({ SLIDE_BURST: denying });
  const { beacon } = await t.open("deck");
  const res = await t.beacon("deck", { token: beacon!.token, slide: 1, ms: 2000 }, "2001:db8:1:2:aaaa::1");
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "60");
  assert.equal(t.points.length, 0);
  // Keyed by a hash of the network (an IPv6 visitor by /64), never the address.
  assert.equal(keys.length, 1);
  assert.match(keys[0]!, /^[0-9a-f]{16}$/);
});

test("cap: a page takes at most SLIDE_EVENT_LIMIT beacons a day, then nothing more is written", async () => {
  assert.deepEqual(SLIDE_EVENT_LIMIT, { limit: 20_000, windowSeconds: 24 * 3600 });
  const t = await setup();
  const { beacon } = await t.open("deck");
  // The page's day is almost used up.
  t.raw.prepare("INSERT INTO rate_limits (bucket, window_start, count, expires_at) VALUES (?, ?, ?, ?)")
    .run("slides:p:deck", NOW - 1000, SLIDE_EVENT_LIMIT.limit - 1, NOW + 3_600_000);
  assert.equal((await t.beacon("deck", { token: beacon!.token, slide: 1, ms: 2000, first: true })).status, 204);
  const over = await t.beacon("deck", { token: beacon!.token, slide: 2, ms: 2000, first: true });
  assert.equal(over.status, 429);
  assert.equal((await json(over)).code, "rate_limited");
  assert.equal(t.points.length, 1);
  // Another deck has its own day.
  const other = (await t.open("deck2")).beacon!;
  assert.equal((await t.beacon("deck2", { token: other.token, slide: 1, ms: 2000 })).status, 204);
});

test("the slide route reads no cookies and never stores the address", () => {
  const code = readFileSync(new URL("../src/routes/collect.ts", import.meta.url), "utf8");
  const route = code.slice(code.indexOf('collect.post("/c/:id/slide"'), code.indexOf("collect.on("));
  assert.ok(route.includes("slideEvent("));
  assert.doesNotMatch(route, /getCookie|Cookie/);
  const event = readFileSync(new URL("../src/lib/slide-event.ts", import.meta.url), "utf8");
  assert.doesNotMatch(event, /CF-Connecting-IP|headers/i);
});

test("wrangler.toml binds the dataset and the per-network limit", () => {
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /\[\[analytics_engine_datasets\]\]\s*\nbinding = "SLIDES"\s*\ndataset = "aired_slides"/);
  assert.match(toml, /name = "SLIDE_BURST"\s*\nnamespace_id = "1022"\s*\nsimple = \{ limit = 300, period = 60 \}/);
});

// --- Reading: the query and the numbers --------------------------------------

test("the query filters on the page's index and the window's UTC days", () => {
  const sql = buildSlideQuery("Ab_9-x", { range: 7, offset: 0 }, Date.parse("2026-11-28T12:00:00Z"));
  assert.match(sql, /^SELECT double1 AS slide, double2 AS sec, double3 AS first, SUM\(_sample_interval\) AS n FROM aired_slides WHERE index1 = 'Ab_9-x' AND timestamp > NOW\(\) - INTERVAL '8' DAY AND blob2 >= '2026-11-22' AND blob2 <= '2026-11-28' GROUP BY slide, sec, first LIMIT 10000 FORMAT JSON$/);
  assert.throws(() => buildSlideQuery("x' OR '1'='1", { range: 7, offset: 0 }, NOW));
  assert.throws(() => buildSlideQuery("ok", { range: 30, offset: 3 }, NOW));
});

test("weighted median: the middle visit's dwell", () => {
  assert.equal(weightedMedian([]), null);
  assert.equal(weightedMedian([[5, 1]]), 5);
  assert.equal(weightedMedian([[2, 1], [10, 1], [4, 1]]), 4);
  assert.equal(weightedMedian([[2, 3], [60, 1]]), 2);
  assert.equal(weightedMedian([[2, 1], [8, 1]]), 5, "an even count: halfway between the two middle visits");
});

test("the numbers: reached per slide, median dwell, drop-off to the next slide, and the biggest drop", () => {
  const rows = [
    // slide 1: 10 first visits, dwell 4s (6) and 8s (4); 2 revisits at 1s.
    { slide: 1, sec: 4, first: 1, n: 6 }, { slide: 1, sec: 8, first: 1, n: "4" }, { slide: 1, sec: 1, first: 0, n: 2 },
    // slide 2: 8 reached.
    { slide: 2, sec: 20, first: 1, n: 8 },
    // slide 3: 3 reached: the big drop is after slide 2.
    { slide: 3, sec: 30, first: 1, n: 3 },
    // A slide past the deck's end (it got shorter): left out.
    { slide: 9, sec: 5, first: 1, n: 50 },
  ];
  const r = shapeSlides(rows, { slides: 3, titles: ["Hello", "Problem", null] });
  assert.deepEqual(r.slides, [
    { slide: 1, title: "Hello", reached: 10, median_seconds: 4, drop_off: 2 },
    { slide: 2, title: "Problem", reached: 8, median_seconds: 20, drop_off: 5 },
    { slide: 3, title: null, reached: 3, median_seconds: 30, drop_off: null },
  ]);
  assert.equal(r.viewers, 10);
  assert.equal(r.finished, 3);
  assert.equal(r.biggest_drop, 2);
  const empty = shapeSlides([], { slides: 2, titles: [] });
  assert.deepEqual(empty.slides.map((s) => s.reached), [0, 0]);
  assert.equal(empty.viewers, 0);
  assert.equal(empty.biggest_drop, null);
  assert.equal(empty.slides[0]!.median_seconds, null);
});

test("people who jump ahead don't make a negative drop-off", () => {
  const r = shapeSlides([{ slide: 1, sec: 3, first: 1, n: 2 }, { slide: 2, sec: 3, first: 1, n: 5 }], { slides: 2, titles: [] });
  assert.equal(r.slides[0]!.drop_off, 0);
  assert.equal(r.biggest_drop, null);
});

// --- Reading: the route -------------------------------------------------------

function stubFetch(data: (sql: string) => unknown[]) {
  const sent: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    sent.push(init.body);
    return Response.json({ data: data(init.body) });
  }) as typeof fetch;
  return { sent, restore: () => { globalThis.fetch = real; } };
}

test("reading: signed out 401, someone else's or a missing page 404, a plain page 422, all in the API's error shape", async () => {
  const t = await setup();
  const f = stubFetch(() => []);
  try {
    const out = await t.fetch("/api/pages/deck/slides");
    assert.equal(out.status, 401);
    assert.equal((await json(out)).error.code, "unauthorized");
    for (const id of ["freedeck", "nope", "bad%27id"]) {
      const res = await t.fetch(`/api/pages/${id}/slides`, { user: PRO });
      assert.equal(res.status, 404, id);
      assert.equal((await json(res)).error.code, "not_found");
    }
    const plain = await t.fetch("/api/pages/plain/slides", { user: PRO });
    assert.equal(plain.status, 422);
    assert.equal((await json(plain)).error.code, "not_a_deck");
    assert.equal(f.sent.length, 0);
  } finally {
    f.restore();
  }
});

test("reading: Free gets a 402 plan_limit with an upgrade link and a plain message, and nothing is queried", async () => {
  const t = await setup();
  const f = stubFetch(() => []);
  try {
    const res = await t.fetch("/api/pages/freedeck/slides", { user: FREE });
    assert.equal(res.status, 402);
    const { error } = await json(res);
    assert.equal(error.code, "plan_limit");
    assert.equal(error.limit, "slide_analytics");
    assert.equal(error.upgrade_url, "https://aired.test/pricing?ref=slides");
    assert.match(error.message, /Pro/);
    assert.equal(f.sent.length, 0);
  } finally {
    f.restore();
  }
});

test("reading: the Pro owner gets every slide with titles, reached, median dwell and drop-off", async () => {
  const t = await setup();
  const f = stubFetch(() => [
    { slide: 1, sec: 6, first: 1, n: "5" }, { slide: 2, sec: 12, first: 1, n: 2 }, { slide: 2, sec: 3, first: 0, n: 1 },
  ]);
  try {
    const res = await t.fetch("/api/pages/deck/slides?days=7", { user: PRO });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    const body = await json(res);
    assert.equal(body.id, "deck");
    assert.equal(body.days, 7);
    assert.equal(body.slide_count, 3);
    assert.equal(body.viewers, 5);
    assert.equal(body.finished, 0);
    assert.equal(body.biggest_drop, 1);
    assert.deepEqual(body.slides, [
      { slide: 1, title: "Hello", reached: 5, median_seconds: 6, drop_off: 3 },
      { slide: 2, title: "Problem", reached: 2, median_seconds: 12, drop_off: 2 },
      { slide: 3, title: null, reached: 0, median_seconds: null, drop_off: null },
    ]);
    assert.match(body.from, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(f.sent.length, 1);
    assert.match(f.sent[0]!, /index1 = 'deck'/);
  } finally {
    f.restore();
  }
});

test("reading: a bad window is 400; no token set up is 503 analytics_unavailable; a failed query 503", async () => {
  const t = await setup();
  assert.equal((await t.fetch("/api/pages/deck/slides?days=365", { user: PRO })).status, 400);
  assert.equal((await t.fetch("/api/pages/deck/slides?days=30&offset=3", { user: PRO })).status, 400);
  const off = await setup({ CF_ANALYTICS_TOKEN: "" });
  const res = await off.fetch("/api/pages/deck/slides", { user: PRO });
  assert.equal(res.status, 503);
  assert.equal((await json(res)).error.code, "analytics_unavailable");
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  try {
    assert.equal((await t.fetch("/api/pages/deck/slides", { user: PRO })).status, 503);
  } finally {
    globalThis.fetch = real;
  }
});

test("reading: ANALYTICS_DEMO=1 answers made-up numbers for local dev, shaped the same", async () => {
  const t = await setup({ ANALYTICS_DEMO: "1", CF_ANALYTICS_TOKEN: "" });
  const res = await t.fetch("/api/pages/deck/slides", { user: PRO });
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.slides.length, 3);
  assert.ok(body.slides[0].reached >= body.slides[2].reached);
});

// --- Agents: the hosted MCP's get_page --------------------------------------

const { createAiredMcpServer } = await import("../src/routes/mcp.ts");
const { pageResult } = await import("../src/lib/mcp-account.ts");
const { outputShapes } = await import("../src/lib/mcp-shapes.ts");
const { z } = await import("zod");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

const DETAILS = {
  id: "deck", url: "https://aired.sh/p/deck", title: "Pitch", size: 10, views: 3, view_limit: null, has_pin: false, access: "public",
  permanent: true, created_at: null, expires_at: null, project: null, kind: "deck", slides: 3,
};
const STATS = {
  id: "deck", title: "Pitch", days: 30, offset: 0, from: "2026-10-30", to: "2026-11-28", slide_count: 3, viewers: 10, finished: 3, biggest_drop: 2,
  slides: [
    { slide: 1, title: "Hello", reached: 10, median_seconds: 4, drop_off: 2 },
    { slide: 2, title: "Problem", reached: 8, median_seconds: 20, drop_off: 5 },
    { slide: 3, title: null, reached: 3, median_seconds: 30, drop_off: null },
  ],
};

test("get_page's answer carries a deck's slide numbers, valid against its output schema", () => {
  const r = pageResult(DETAILS, "https://aired.sh", undefined, { stats: STATS });
  const parsed = z.object(outputShapes.get_page).strict().safeParse(r.structuredContent);
  assert.ok(parsed.success, parsed.success ? "" : parsed.error.message);
  assert.deepEqual((r.structuredContent as any).slide_stats.slides[1], STATS.slides[1]);
  const text = r.content[0]!.text;
  assert.match(text, /10 started, 3 reached the end \(30%\)/);
  assert.match(text, /Most people stopped after slide 2/);
  assert.match(text, /2\. Problem: 8 reached, median 20s, 5 stopped here/);
  const locked = pageResult(DETAILS, "https://aired.sh", undefined, { upgradeUrl: "https://aired.sh/pricing?ref=slides" });
  assert.ok(z.object(outputShapes.get_page).strict().safeParse(locked.structuredContent).success);
  assert.match(locked.content[0]!.text, /need Pro: https:\/\/aired\.sh\/pricing\?ref=slides/);
});

async function mcpWith(signedIn: boolean, slidesAnswer: { status: number; body: unknown }) {
  const calls: string[] = [];
  const server = createAiredMcpServer({ SITE_ORIGIN: "https://aired.sh", BILLING_ENABLED: "1" }, signedIn ? { login: "me", origin: "https://aired.sh" } : null, async (_m, path) => {
    calls.push(path);
    return path.includes("/slides") ? slidesAnswer : { status: 200, body: DETAILS };
  });
  const client = new Client({ name: "t", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { calls, call: async (args: Record<string, unknown>) => (await client.callTool({ name: "get_page", arguments: args })) as { structuredContent?: Record<string, any>; content: Array<{ text: string }> } };
}

test("hosted MCP get_page: the signed-in owner's deck gets its slide numbers; a token caller doesn't ask", async () => {
  const owner = await mcpWith(true, { status: 200, body: STATS });
  const got = await owner.call({ id: "deck" });
  assert.deepEqual(owner.calls, ["/api/pages/deck/details", "/api/pages/deck/slides?days=30"]);
  assert.equal(got.structuredContent?.slide_stats.viewers, 10);
  const free = await mcpWith(true, { status: 402, body: { error: { code: "plan_limit", message: "x" } } });
  const locked = await free.call({ id: "deck" });
  assert.equal(locked.structuredContent?.slide_stats, undefined);
  assert.equal(locked.structuredContent?.slide_stats_upgrade_url, "https://aired.sh/pricing?ref=slides");
  const anon = await mcpWith(false, { status: 200, body: STATS });
  const viaToken = await anon.call({ id: "deck", update_token: "at_x" });
  assert.deepEqual(anon.calls, ["/api/pages/deck/details"]);
  assert.equal(viaToken.structuredContent?.slide_stats, undefined);
});
