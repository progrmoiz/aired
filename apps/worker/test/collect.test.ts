import { test } from "node:test";
import assert from "node:assert/strict";
import "./helpers/worker-loader.ts";
import { fakeD1 } from "./helpers/d1.ts";

// The real viewer, collect and responses routes, on fake bindings.
const { Hono } = await import("hono");
const { viewer } = await import("../src/routes/viewer.ts");
const { collect } = await import("../src/routes/collect.ts");
const { responses } = await import("../src/routes/responses.ts");
const { insertPageRow, rowFromMetadata } = await import("../src/lib/pages-store.ts");
const { serializeMetadata, hashToken } = await import("@aired/core");
const { mintViewerToken, verifyViewerToken, viewerKey } = await import("../src/lib/collect-token.ts");
const { saveEntry, getPageData, pruneCollectData, deletePageCollectData } = await import("../src/lib/collect-store.ts");
const { COLLECT_LIMITS, COLLECT_WRITE_LIMITS } = await import("../src/lib/collect-limits.ts");

type User = { id: number; login: string; email: null; name: null };

const SECRET = "test-session-secret-0123456789abcdef";
const NOW = Date.now();
const COLLECT_HTML = `<!doctype html><html><head><title>Programme</title></head><body><button onclick="aired.collect.save({done:true})">Done</button></body></html>`;

function fakeR2() {
  const objects = new Map<string, string>();
  return {
    objects,
    async get(key: string) {
      const v = objects.get(key);
      return v === undefined ? null : { etag: "e1", async text() { return v; }, body: new Blob([v]).stream() };
    },
    async put(key: string, v: string) { objects.set(key, v); },
    async delete() {},
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

async function setup() {
  const { db, raw } = fakeD1();
  const r2 = fakeR2();
  const kv = new Map<string, string>();
  const tokenHash = await hashToken("tok_page_update_secret");
  const add = async (id: string, ownerId: number | null, html: string) => {
    const meta = {
      id, title: id, size: html.length, tokenHash, pin: null, reads: null, readCount: 0, permanent: true,
      createdAt: new Date(NOW - 1000).toISOString(), expiresAt: null, ownerId, project: null,
    };
    await insertPageRow(db, rowFromMetadata(meta as never, null, NOW));
    kv.set(`page:${id}`, serializeMetadata(meta as never));
    await r2.put(`pages/${id}/index.html`, html);
  };
  await add("trainer", 7, COLLECT_HTML);
  await add("poll", 7, COLLECT_HTML.replace("Programme", "Poll"));
  await add("other", 8, COLLECT_HTML);
  await add("anon", null, COLLECT_HTML);
  await add("plain", 7, "<html><head></head><body>No data layer here</body></html>");
  const env = { DB: db, PAGES_BUCKET: r2, PAGES_KV: fakeKv(kv), SESSION_SECRET: SECRET, SITE_ORIGIN: "https://aired.test" };
  const app = new Hono();
  app.use("*", async (c, next) => {
    const uid = c.req.header("X-Test-User");
    c.set("user" as never, (uid ? ({ id: Number(uid), login: `u${uid}`, email: null, name: null } satisfies User) : null) as never);
    c.set("via" as never, (uid ? "key" : null) as never);
    await next();
  });
  app.route("/", collect);
  app.route("/api", responses);
  app.route("/", viewer);
  let ipN = 0;
  const fetch = (path: string, init: RequestInit & { user?: number; ip?: string } = {}) => {
    const headers = new Headers(init.headers);
    headers.set("CF-Connecting-IP", init.ip ?? `198.51.100.${++ipN % 250}`);
    headers.set("X-Aired-Request", "1");
    if (init.user !== undefined) headers.set("X-Test-User", String(init.user));
    return app.fetch(new Request(`https://aired.test${path}`, { ...init, headers }), env as never, { waitUntil() {}, passThroughOnException() {} } as never);
  };
  /** Open a page as a browser would; returns the token, viewer id and cookie it got. */
  const open = async (id: string, cookie?: string) => {
    const res = await fetch(`/p/${id}`, cookie ? { headers: { Cookie: cookie } } : {});
    const html = await res.text();
    const cfg = /var C=(\{[^;]*\}),F=/.exec(html);
    const setCookie = res.headers.get("Set-Cookie");
    return {
      res, html,
      config: cfg ? (JSON.parse(cfg[1]!) as { on: boolean; token?: string; viewer?: string; reason?: string; base?: string }) : null,
      cookie: setCookie ? setCookie.split(";")[0]! : cookie,
      setCookie,
    };
  };
  /** A call from the page, as its script makes it: text/plain JSON, no cookies. */
  const page = (id: string, op: string, body: Record<string, unknown>, ip?: string) =>
    fetch(`/c/${id}/${op}`, { method: "POST", headers: { "Content-Type": "text/plain", Origin: "null" }, body: JSON.stringify(body), ...(ip ? { ip } : {}) });
  const owner = (method: string, path: string, user: number | undefined, body?: unknown) =>
    fetch(path, { method, user, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) });
  return { db, raw, env, fetch, open, page, owner };
}

const json = async (res: Response) => (await res.json()) as Record<string, any>;

// --- Serving pages ----------------------------------------------------------

test("a page that doesn't use the data layer is served as before: no script, cookie or token", async () => {
  const t = await setup();
  const { res, html, config } = await t.open("plain");
  assert.equal(res.status, 200);
  assert.equal(config, null);
  assert.equal(res.headers.get("Set-Cookie"), null);
  assert.ok(!html.includes("aired.collect"));
  assert.equal(res.headers.get("Cache-Control"), null);
});

test("an owned page that names aired.collect gets a token, a viewer cookie and no caching", async () => {
  const t = await setup();
  const first = await t.open("trainer");
  assert.equal(first.config?.on, true);
  assert.equal(first.config?.base, "https://aired.test/c/trainer");
  assert.match(first.setCookie ?? "", /^aired_v=[A-Za-z0-9_-]{22}; Path=\/p\/; HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/);
  assert.equal(first.res.headers.get("Cache-Control"), "private, no-store");
  // The sandbox is unchanged: still no allow-same-origin.
  assert.ok(!(first.res.headers.get("Content-Security-Policy") ?? "").includes("allow-same-origin"));
  // The runtime parses as JavaScript, and comes after the shim, before page scripts.
  const scripts = [...first.html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  for (const s of scripts) new Function(s);
  assert.ok(first.html.indexOf("window.aired=a") < first.html.indexOf("aired.collect.save({done:true})"));
  // Same browser, same viewer; no new cookie.
  const again = await t.open("trainer", first.cookie);
  assert.equal(again.config?.viewer, first.config?.viewer);
  assert.equal(again.setCookie, null);
  // The same browser is a different viewer on another page.
  const poll = await t.open("poll", first.cookie);
  assert.notEqual(poll.config?.viewer, first.config?.viewer);
});

test("an anonymous page gets the API with saving off, and no cookie", async () => {
  const t = await setup();
  const { config, setCookie } = await t.open("anon");
  assert.deepEqual(config, { on: false, reason: "sign_in_required" });
  assert.equal(setCookie, null);
  // A token minted for it (as if someone had the secret) still can't save: no owner.
  const token = await mintViewerToken(SECRET, "anon", await viewerKey(SECRET, "anon", "x".repeat(22)), Math.floor(NOW / 1000) + 60);
  const res = await t.page("anon", "save", { token, record: { a: 1 } });
  assert.equal(res.status, 403);
  assert.equal((await json(res)).code, "sign_in_required");
});

// --- Isolation and forged ids ---------------------------------------------

test("a token works only on its own page", async () => {
  const t = await setup();
  const { config } = await t.open("trainer");
  for (const target of ["poll", "other"]) {
    const res = await t.page(target, "save", { token: config!.token, record: { sneaky: true } });
    assert.equal(res.status, 403, target);
    const mine = await t.page(target, "mine", { token: config!.token });
    assert.equal(mine.status, 403, target);
  }
  assert.equal((await getPageData(t.db, "poll"))?.entries ?? 0, 0);
  assert.equal((await getPageData(t.db, "other"))?.entries ?? 0, 0);
});

test("a forged or changed token is refused: another viewer, another page, no signature, expired", async () => {
  const t = await setup();
  const { config } = await t.open("trainer");
  const token = config!.token!;
  const [v, page, viewer, exp, sig] = token.split(".");
  const forged = [
    [v, page, "A".repeat(22), exp, sig].join("."), // claim another viewer
    [v, "poll", viewer, exp, sig].join("."), // claim another page
    [v, page, viewer, String(Number(exp) + 10_000), sig].join("."), // extend it
    [v, page, viewer, exp].join("."), // no signature
    "", null, 42, "v1.trainer.x.1.y",
  ];
  for (const f of forged) {
    const res = await t.page("trainer", "save", { token: f, record: { a: 1 } });
    assert.equal(res.status, 403, String(f));
  }
  const expired = await mintViewerToken(SECRET, "trainer", viewer!, Math.floor(NOW / 1000) - 1);
  const res = await t.page("trainer", "save", { token: expired, record: { a: 1 } });
  assert.equal(res.status, 403);
  assert.equal((await json(res)).code, "expired");
  // A token signed with another secret is refused too.
  const wrongKey = await mintViewerToken("another-secret", "trainer", viewer!, Math.floor(NOW / 1000) + 60);
  assert.deepEqual(await verifyViewerToken(SECRET, "trainer", wrongKey, Math.floor(NOW / 1000)), { ok: false, reason: "bad_signature" });
  assert.equal((await getPageData(t.db, "trainer"))?.entries ?? 0, 0);
});

test("viewers see only their own entries until the owner makes results public, and never each other's ids", async () => {
  const t = await setup();
  const a = (await t.open("poll")).config!;
  const b = (await t.open("poll")).config!;
  assert.notEqual(a.viewer, b.viewer);
  assert.equal((await t.page("poll", "save", { token: a.token, record: { choice: "red" }, key: "vote" })).status, 200);
  assert.equal((await t.page("poll", "save", { token: b.token, record: { choice: "blue" }, key: "vote" })).status, 200);

  const mineA = await json(await t.page("poll", "mine", { token: a.token }));
  assert.deepEqual(mineA.entries.map((e: any) => e.data), [{ choice: "red" }]);
  const mineB = await json(await t.page("poll", "mine", { token: b.token }));
  assert.deepEqual(mineB.entries.map((e: any) => e.data), [{ choice: "blue" }]);

  const closed = await t.page("poll", "all", { token: a.token });
  assert.equal(closed.status, 403);
  assert.equal((await json(closed)).code, "private");

  assert.equal((await t.owner("PATCH", "/api/pages/poll/responses", 7, { public_results: true })).status, 200);
  const all = await json(await t.page("poll", "all", { token: a.token }));
  assert.equal(all.entries.length, 2);
  assert.deepEqual(all.entries.map((e: any) => e.mine).sort(), [false, true]);
  for (const e of all.entries) assert.ok(!("viewer" in e), "all() never shows viewer ids");
});

test("a keyed save replaces the viewer's entry and counts once; remove takes only their own", async () => {
  const t = await setup();
  const a = (await t.open("trainer")).config!;
  const b = (await t.open("trainer")).config!;
  for (const done of [true, false, true]) {
    const res = await json(await t.page("trainer", "save", { token: a.token, record: { week: 1, done }, key: "w1" }));
    assert.equal(res.entry.key, "w1");
  }
  const mine = await json(await t.page("trainer", "mine", { token: a.token }));
  assert.equal(mine.entries.length, 1);
  assert.deepEqual(mine.entries[0].data, { week: 1, done: true });
  const row = await getPageData(t.db, "trainer");
  assert.equal(row?.entries, 1);
  assert.equal(row?.monthCount, 1);

  // B can't remove A's entry, by id or key.
  assert.equal((await json(await t.page("trainer", "remove", { token: b.token, id: mine.entries[0].id }))).removed, false);
  assert.equal((await json(await t.page("trainer", "remove", { token: b.token, id: "w1" }))).removed, false);
  assert.equal((await json(await t.page("trainer", "remove", { token: a.token, id: "w1" }))).removed, true);
  assert.equal((await getPageData(t.db, "trainer"))?.entries, 0);
});

// --- Validation, abuse, caps and rate limits ------------------------------

test("records must be small JSON objects, and secrets or card numbers are refused", async () => {
  const t = await setup();
  const { token } = (await t.open("trainer")).config!;
  const cases: Array<[unknown, number, string]> = [
    ["just text", 422, "invalid_record"],
    [[1, 2], 422, "invalid_record"],
    [{ big: "x".repeat(9000) }, 413, "too_large"],
    [{ a: { b: { c: { d: { e: { f: 1 } } } } } }, 422, "invalid_record"],
    [{ email: "a@b.co", password: "hunter2" }, 422, "blocked"],
    [{ cardNumber: "x" }, 422, "blocked"],
    [{ note: "4242 4242 4242 4242" }, 422, "blocked"],
  ];
  for (const [record, status, code] of cases) {
    const res = await t.page("trainer", "save", { token, record });
    assert.equal(res.status, status, JSON.stringify(record).slice(0, 40));
    assert.equal((await json(res)).code, code);
  }
  for (const key of ["", "has space", "x".repeat(65), 5]) {
    assert.equal((await t.page("trainer", "save", { token, record: { a: 1 }, key })).status, 422, String(key));
  }
  // Ordinary answers pass: names, emails, a phone number, a quiz score.
  const ok = await t.page("trainer", "save", { token, record: { name: "Sam", email: "sam@example.com", phone: "+1 415 555 0100", score: 7, answers: ["b", "c"] } });
  assert.equal(ok.status, 200);
  assert.equal((await t.page("trainer", "save", { token: "x", record: {} }, undefined)).status, 403);
  // Not JSON at all.
  const raw = await t.fetch("/c/trainer/save", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "nope" });
  assert.equal(raw.status, 400);
});

test("one viewer is limited to 30 writes in 10 minutes", async () => {
  const t = await setup();
  const { token } = (await t.open("trainer")).config!;
  for (let i = 0; i < COLLECT_WRITE_LIMITS.viewer.limit; i++) {
    assert.equal((await t.page("trainer", "save", { token, record: { i } })).status, 200, `save ${i}`);
  }
  const over = await t.page("trainer", "save", { token, record: { i: "over" } });
  assert.equal(over.status, 429);
  assert.equal((await json(over)).code, "rate_limited");
  // Another viewer on the page still gets through.
  const other = (await t.open("trainer")).config!;
  assert.equal((await t.page("trainer", "save", { token: other.token, record: { i: 0 } })).status, 200);
});

test("one network is limited across viewers, so minting new viewers doesn't get round it", async () => {
  const t = await setup();
  const ip = "203.0.113.50";
  const tokens: string[] = [];
  for (let i = 0; i < 12; i++) tokens.push((await t.open("trainer")).config!.token!);
  let ok = 0;
  let limited = 0;
  for (let i = 0; i < COLLECT_WRITE_LIMITS.ip.limit + 5; i++) {
    const res = await t.page("trainer", "save", { token: tokens[i % tokens.length], record: { i } }, ip);
    if (res.status === 200) ok++;
    else if (res.status === 429) limited++;
  }
  // 12 viewers × 30 is more than the network's 300: the network limit decides.
  assert.equal(ok, COLLECT_WRITE_LIMITS.ip.limit);
  assert.equal(limited, 5);
});

test("plan caps hold: monthly, stored entries and bytes; closed pages refuse", async () => {
  const t = await setup();
  const limits = { ...COLLECT_LIMITS.free, responsesPerMonth: 3, storedResponses: 5, storedBytes: 60 };
  const base = { pageId: "trainer", ownerId: 7, key: null, limits, now: NOW };
  const save = (viewer: string, json = '{"a":1}', key: string | null = null) =>
    saveEntry(t.db, { ...base, viewer, key, json, size: json.length });
  for (let i = 0; i < 3; i++) assert.equal((await save(`viewer${i}`)).ok, true);
  assert.deepEqual(await save("viewer9"), { ok: false, reason: "monthly" });
  // Replacing a keyed entry doesn't count toward the month... but a new key does.
  const row = await getPageData(t.db, "trainer");
  assert.equal(row?.monthCount, 3);
  assert.equal(row?.entries, 3);
  assert.equal(row?.bytes, 21);

  const roomy = { ...limits, responsesPerMonth: 100 };
  const big = '{"a":"' + "x".repeat(40) + '"}';
  assert.deepEqual(await saveEntry(t.db, { ...base, limits: roomy, viewer: "v", json: big, size: big.length }), { ok: false, reason: "bytes" });
  assert.equal((await saveEntry(t.db, { ...base, limits: roomy, viewer: "v", json: '{"b":1}', size: 7 })).ok, true);
  assert.equal((await saveEntry(t.db, { ...base, limits: roomy, viewer: "v", json: '{"b":2}', size: 7 })).ok, true);
  assert.deepEqual(await saveEntry(t.db, { ...base, limits: roomy, viewer: "v", json: '{"b":3}', size: 7 }), { ok: false, reason: "stored" });

  assert.equal((await t.owner("PATCH", "/api/pages/trainer/responses", 7, { closed: true })).status, 200);
  assert.deepEqual(await saveEntry(t.db, { ...base, limits: roomy, viewer: "new", json: "{}", size: 2 }), { ok: false, reason: "closed" });
  const { token } = (await t.open("trainer")).config!;
  const res = await t.page("trainer", "save", { token, record: { a: 1 } });
  assert.equal(res.status, 409);
  assert.equal((await json(res)).code, "closed");
});

// --- The owner's side -------------------------------------------------------

test("only the signed-in owner reads, exports or deletes responses", async () => {
  const t = await setup();
  const { token } = (await t.open("trainer")).config!;
  await t.page("trainer", "save", { token, record: { name: "Sam" } });
  for (const path of ["/api/pages/trainer/responses", "/api/pages/trainer/responses.csv", "/api/pages/trainer/data"]) {
    assert.equal((await t.owner("GET", path, undefined)).status, 401, `${path} anonymous`);
    assert.equal((await t.owner("GET", path, 8)).status, 404, `${path} another account`);
    // The page's update token is not enough.
    assert.equal((await t.fetch(path, { headers: { "X-Update-Token": "tok_page_update_secret" } })).status, 401, `${path} update token`);
  }
  assert.equal((await t.owner("DELETE", "/api/pages/trainer/responses", 8, { all: true })).status, 404);
  assert.equal((await t.owner("PATCH", "/api/pages/trainer/responses", 8, { public_results: true })).status, 404);
  assert.equal((await t.owner("PUT", "/api/pages/trainer/data", 8, { data: { x: 1 } })).status, 404);
  assert.equal((await getPageData(t.db, "trainer"))?.entries, 1, "nothing was deleted");

  const list = await json(await t.owner("GET", "/api/pages/trainer/responses", 7));
  assert.equal(list.responses.length, 1);
  assert.deepEqual(list.responses[0].data, { name: "Sam" });
  assert.match(list.responses[0].viewer, /^[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(list.settings, { public_results: false, closed: false });
  assert.equal(list.usage.entries, 1);
  assert.equal(list.usage.limits.responses_per_month, COLLECT_LIMITS.free.responsesPerMonth);
});

test("the owner pages through responses newest first and deletes some or all", async () => {
  const t = await setup();
  const a = (await t.open("trainer")).config!;
  for (let i = 0; i < 5; i++) await t.page("trainer", "save", { token: a.token, record: { i } });
  const first = await json(await t.owner("GET", "/api/pages/trainer/responses?limit=2", 7));
  assert.equal(first.responses.length, 2);
  assert.ok(first.cursor);
  const second = await json(await t.owner("GET", `/api/pages/trainer/responses?limit=2&cursor=${encodeURIComponent(first.cursor)}`, 7));
  assert.equal(second.responses.length, 2);
  assert.equal(new Set([...first.responses, ...second.responses].map((r: any) => r.id)).size, 4);
  assert.equal((await t.owner("GET", "/api/pages/trainer/responses?cursor=garbage", 7)).status, 400);

  const del = await json(await t.owner("DELETE", "/api/pages/trainer/responses", 7, { ids: [first.responses[0].id] }));
  assert.equal(del.deleted, 1);
  assert.equal((await getPageData(t.db, "trainer"))?.entries, 4);
  assert.equal((await t.owner("DELETE", "/api/pages/trainer/responses", 7, { ids: ["../etc"] })).status, 400);
  assert.equal((await t.owner("DELETE", "/api/pages/trainer/responses", 7, {})).status, 400);
  assert.equal((await json(await t.owner("DELETE", "/api/pages/trainer/responses", 7, { all: true }))).deleted, 4);
  const after = await getPageData(t.db, "trainer");
  assert.equal(after?.entries, 0);
  assert.equal(after?.bytes, 0);
});

test("CSV export: a column per field, quoting, and formulas defused", async () => {
  const t = await setup();
  const { token } = (await t.open("trainer")).config!;
  await t.page("trainer", "save", { token, record: { name: "Sam, Jr.", note: "=HYPERLINK(\"http://x\")", score: -3 } });
  await t.page("trainer", "save", { token, record: { name: "Ana", tags: ["a", "b"] }, key: "k1" });
  const res = await t.owner("GET", "/api/pages/trainer/responses.csv", 7);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type") ?? "", /^text\/csv/);
  assert.match(res.headers.get("Content-Disposition") ?? "", /^attachment; filename="aired-trainer-responses-\d{4}-\d{2}-\d{2}\.csv"$/);
  const lines = (await res.text()).trimEnd().split("\r\n");
  assert.ok(lines[0]!.startsWith("id,viewer,key,created_at,updated_at,name,"), lines[0]);
  assert.deepEqual(lines[0]!.split(",").slice(5).sort(), ["name", "note", "score", "tags"]);
  assert.equal(lines.length, 3);
  const sam = lines.find((l) => l.includes("Sam"))!;
  assert.ok(sam.includes('"Sam, Jr."'));
  assert.ok(sam.includes(`"'=HYPERLINK(""http://x"")"`), sam);
  assert.match(sam, /(^|,)-3(,|$)/, "numbers are left alone");
  const ana = lines.find((l) => l.includes("Ana"))!;
  assert.ok(ana.includes(',k1,'));
  assert.ok(ana.includes('"[""a"",""b""]"'));
});

// --- Live data ---------------------------------------------------------------

test("update_data: the owner pushes JSON, pages read it, and an unchanged poll is cheap", async () => {
  const t = await setup();
  const { token } = (await t.open("trainer")).config!;
  const empty = await json(await t.page("trainer", "data", { token, since: -1 }));
  assert.deepEqual([empty.version, empty.data], [0, null]);

  const put = await json(await t.owner("PUT", "/api/pages/trainer/data", 7, { data: { revenue: [1, 2, 3] } }));
  assert.equal(put.version, 1);
  const got = await json(await t.page("trainer", "data", { token, since: 0 }));
  assert.deepEqual([got.version, got.data], [1, { revenue: [1, 2, 3] }]);
  assert.deepEqual(await json(await t.page("trainer", "data", { token, since: 1 })), { version: 1, changed: false });

  // Another page's token can't read it.
  const other = (await t.open("poll")).config!;
  assert.equal((await t.page("trainer", "data", { token: other.token, since: -1 })).status, 403);
  // Too big for the plan.
  const big = { rows: "x".repeat(COLLECT_LIMITS.free.liveDataBytes) };
  assert.equal((await t.owner("PUT", "/api/pages/trainer/data", 7, { data: big })).status, 413);
  assert.equal((await t.owner("PUT", "/api/pages/trainer/data", 7, {})).status, 400);
  const owner = await json(await t.owner("GET", "/api/pages/trainer/data", 7));
  assert.deepEqual([owner.version, owner.data], [1, { revenue: [1, 2, 3] }]);
});

// --- Deletion and retention ---------------------------------------------------

test("deleting a page, or its expiry, takes its entries and data; retention prunes old entries", async () => {
  const t = await setup();
  const { token } = (await t.open("trainer")).config!;
  await t.page("trainer", "save", { token, record: { a: 1 } });
  await t.owner("PUT", "/api/pages/trainer/data", 7, { data: [1] });
  await deletePageCollectData(t.db, "trainer");
  assert.equal(await getPageData(t.db, "trainer"), null);
  assert.equal((t.raw.prepare("SELECT COUNT(*) AS n FROM responses WHERE page_id = 'trainer'").get() as { n: number }).n, 0);

  // Retention: an entry past expires_at goes; the counters follow.
  const poll = (await t.open("poll")).config!;
  await t.page("poll", "save", { token: poll.token, record: { keep: true } });
  await t.page("poll", "save", { token: poll.token, record: { old: true } });
  t.raw.prepare("UPDATE responses SET expires_at = ? WHERE data LIKE '%old%'").run(NOW - 1);
  // A page that was deleted without cleanup is swept too.
  const other = (await t.open("other")).config!;
  await t.page("other", "save", { token: other.token, record: { a: 1 } });
  t.raw.prepare("UPDATE pages SET deleted_at = ? WHERE id = 'other'").run(NOW);
  assert.equal(await pruneCollectData(t.db, NOW), 2);
  assert.equal((await getPageData(t.db, "poll"))?.entries, 1);
  assert.equal(await getPageData(t.db, "other"), null);
  // A deleted page refuses saves.
  assert.equal((await t.page("other", "save", { token: other.token, record: { a: 1 } })).status, 410);
});

test("free entries get the plan's retention; Pro keeps them while the page lives", async () => {
  const t = await setup();
  const base = { pageId: "trainer", ownerId: 7, viewer: "v", key: null, json: "{}", size: 2, now: NOW };
  const free = await saveEntry(t.db, { ...base, limits: COLLECT_LIMITS.free });
  const pro = await saveEntry(t.db, { ...base, limits: COLLECT_LIMITS.pro });
  assert.ok(free.ok && pro.ok);
  const rows = t.raw.prepare("SELECT id, expires_at FROM responses ORDER BY created_at").all() as { id: string; expires_at: number | null }[];
  const byId = new Map(rows.map((r) => [r.id, r.expires_at]));
  assert.equal(byId.get(free.ok ? free.entry.id : ""), NOW + 90 * 86_400_000);
  assert.equal(byId.get(pro.ok ? pro.entry.id : ""), null);
});
