import { test } from "node:test";
import assert from "node:assert/strict";
import "./helpers/worker-loader.ts";
import { fakeD1 } from "./helpers/d1.ts";

// "Only these people": the real viewer, access and API routes on fake bindings.
const { Hono } = await import("hono");
const { viewer } = await import("../src/routes/viewer.ts");
const { access, BAD_CODE_MESSAGE, SENT_MESSAGE } = await import("../src/routes/access.ts");
const { api } = await import("../src/routes/api.ts");
const { og } = await import("../src/routes/og.ts");
const { insertPageRow, rowFromMetadata, getPageRow } = await import("../src/lib/pages-store.ts");
const { serializeMetadata, parseMetadata, hashToken } = await import("@aired/core");
const { onList, parseAccess, overLimit, normalizeDomain, isEmail, toEntries, fromEntries } = await import("../src/lib/access-list.ts");
const { newCode, cleanCode, accessCookieValue, verifyAccessCookie, emailKey } = await import("../src/lib/access-code.ts");
const { ACCESS_LIMITS, ACCESS_RATE_LIMITS, CODE_MAX_ATTEMPTS, CODE_TTL_MS } = await import("../src/lib/access-limits.ts");
const { pruneAccessData, getAccessEntries } = await import("../src/lib/access-store.ts");
const { parseOptions, settingsChange } = await import("../src/lib/page-options.ts");
const { emailSenderFor, accessCodeEmail, parseFrom } = await import("../src/lib/email-sender.ts");
const { publicPageMeta, cardTitle } = await import("../src/lib/public-meta.ts");
const { shotAllowed } = await import("../src/lib/og-shot.ts");

const SECRET = "test-session-secret-0123456789abcdef";
const TOKEN = "tok_page_update_secret";
const NOW = Date.now();

// --- The list ----------------------------------------------------------------

test("an email matches itself and its whole domain, whatever the case, and nothing else", () => {
  const entries = toEntries({ emails: ["alice@client.com"], domains: ["agency.io"] });
  assert.deepEqual(entries, ["alice@client.com", "@agency.io"]);
  assert.equal(onList("alice@client.com", entries), true);
  assert.equal(onList("  ALICE@Client.COM ", entries), true);
  assert.equal(onList("bob@agency.io", entries), true);
  assert.equal(onList("Bob@AGENCY.io", entries), true);
  // Not the same person, not the same domain.
  assert.equal(onList("bob@client.com", entries), false);
  assert.equal(onList("alice+x@client.com", entries), false);
  assert.equal(onList("bob@eu.agency.io", entries), false, "subdomains aren't the domain");
  assert.equal(onList("bob@agency.io.evil.com", entries), false);
  assert.equal(onList("bob@notagency.io", entries), false);
  assert.equal(onList("agency.io", entries), false);
  assert.equal(onList("@agency.io", entries), false, "a domain entry isn't an email");
  assert.equal(onList("alice@client.com", []), false, "an empty list lets nobody in");
});

test("emails and domains are checked, lowercased and deduplicated", () => {
  const ok = parseAccess({ mode: "people", emails: ["Alice@Client.com", "alice@client.com ", "bob@client.com"], domains: ["@Agency.io", "agency.io"] });
  assert.deepEqual(ok, { ok: true, access: { mode: "people", emails: ["alice@client.com", "bob@client.com"], domains: ["agency.io"] } });
  assert.deepEqual(fromEntries(toEntries((ok as { access: { emails: string[]; domains: string[] } }).access)), { emails: ["alice@client.com", "bob@client.com"], domains: ["agency.io"] });
  for (const bad of ["alice", "alice@", "@client.com", "a b@client.com", "alice@client", "alice@@client.com", "<x>@client.com", ".a@client.com", "a..b@client.com", "x".repeat(250) + "@client.com"]) {
    assert.equal(parseAccess({ mode: "people", emails: [bad] }).ok, false, bad);
  }
  assert.match((parseAccess({ mode: "people", emails: ["@client.com"] }) as { error: string }).error, /domain: put it in access.domains/);
  assert.match((parseAccess({ mode: "people", domains: ["gmail.com"] }) as { error: string }).error, /anyone with an address there/);
  assert.match((parseAccess({ mode: "people", domains: ["@Outlook.com"] }) as { error: string }).error, /anyone/);
  assert.equal(parseAccess({ mode: "people", domains: ["not a domain"] }).ok, false);
  assert.match((parseAccess({ mode: "people" }) as { error: string }).error, /at least one email or domain/);
  assert.equal(parseAccess({ mode: "public", emails: ["a@b.co"] }).ok, false);
  assert.equal(parseAccess({ mode: "everyone" }).ok, false);
  assert.equal(parseAccess({ mode: "people", emails: "a@b.co" }).ok, false);
  assert.equal(parseAccess({ mode: "people", emails: [1] }).ok, false);
  assert.equal(parseAccess({ mode: "people", emails: ["a@b.co"], extra: 1 }).ok, false);
  assert.equal(parseAccess("people").ok, false);
  assert.deepEqual(parseAccess({ mode: "public" }), { ok: true, access: { mode: "public", emails: [], domains: [] } });
  assert.equal(normalizeDomain("@Client.COM"), "client.com");
  assert.equal(isEmail("a@b.co"), true);
});

test("set_options validation: access in the PATCH body, and how it goes with a PIN", () => {
  const parsed = parseOptions({ access: { mode: "people", emails: ["a@client.com"] } });
  assert.equal(parsed.ok, true);
  assert.equal(parseOptions({ access: { mode: "people", emails: ["a@client.com"] }, pin: "1234" }).ok, false);
  assert.equal(parseOptions({ access: { mode: "public" }, pin: "1234" }).ok, false);
  assert.equal(parseOptions({ access: { mode: "pin" }, pin: null }).ok, false);
  assert.equal(parseOptions({ access: { mode: "pin" }, pin: "4821" }).ok, true);
  assert.equal(parseOptions({ access: { mode: "people", emails: ["nope"] } }).ok, false);
  assert.match((parseOptions({ acess: {} }) as { error: string }).error, /Unknown field: acess/);

  // The columns each change writes: one way in at a time.
  const people = settingsChange((parseOptions({ access: { mode: "people", emails: ["a@client.com"] } }) as { change: never }).change, null, NOW, { access: null });
  assert.deepEqual(people, { access: "people", pin: null });
  const pub = settingsChange((parseOptions({ access: { mode: "public" } }) as { change: never }).change, null, NOW, { access: "people" });
  assert.deepEqual(pub, { access: null, pin: null });
  // A new PIN on a people page makes it a PIN page.
  const pin = settingsChange((parseOptions({ pin: "4821" }) as { change: never }).change, "hash", NOW, { access: "people" });
  assert.deepEqual(pin, { pin: "hash", access: null });
  // A title change leaves access alone.
  assert.deepEqual(settingsChange((parseOptions({ title: "T" }) as { change: never }).change, null, NOW, { access: "people" }), { title: "T" });
});

test("plan limits: Free lists 3 people and no domains; Pro 500 people and 25 domains", () => {
  assert.deepEqual(ACCESS_LIMITS.free, { people: 3, domains: 0, sendsPerDay: 100 });
  assert.deepEqual(ACCESS_LIMITS.pro, { people: 500, domains: 25, sendsPerDay: 2000 });
  const emails = (n: number) => Array.from({ length: n }, (_, i) => `p${i}@client.com`);
  assert.equal(overLimit({ emails: emails(3), domains: [] }, ACCESS_LIMITS.free), null);
  assert.equal(overLimit({ emails: emails(4), domains: [] }, ACCESS_LIMITS.free)?.limit, "access_people");
  assert.equal(overLimit({ emails: [], domains: ["client.com"] }, ACCESS_LIMITS.free)?.limit, "access_domains");
  assert.equal(overLimit({ emails: emails(500), domains: ["a.com"] }, ACCESS_LIMITS.pro), null);
  assert.equal(overLimit({ emails: emails(501), domains: [] }, ACCESS_LIMITS.pro)?.limit, "access_people");
});

// --- Codes and the cookie ------------------------------------------------------

test("codes are 6 digits, zeros kept; typed codes may have a space or dash", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const c = newCode();
    assert.match(c, /^\d{6}$/);
    seen.add(c);
  }
  assert.ok(seen.size > 1990, "codes don't repeat much");
  assert.equal(cleanCode("123 456"), "123456");
  assert.equal(cleanCode("123-456"), "123456");
  assert.equal(cleanCode("004211"), "004211");
  for (const bad of ["12345", "1234567", "abcdef", 123456, null, "1".repeat(30)]) assert.equal(cleanCode(bad), null, String(bad));
});

test("the access cookie opens one page for one email, until it expires", async () => {
  const now = Math.floor(NOW / 1000);
  const v = await accessCookieValue(SECRET, "pageA", "alice@client.com", now + 60);
  assert.equal(await verifyAccessCookie(SECRET, "pageA", v, now), "alice@client.com");
  assert.equal(await verifyAccessCookie(SECRET, "pageB", v, now), null, "another page");
  assert.equal(await verifyAccessCookie("another-secret-0123456789abcdef0", "pageA", v, now), null);
  assert.equal(await verifyAccessCookie(SECRET, "pageA", v, now + 61), null, "expired");
  // Swapping in another email breaks the MAC.
  const [exp, , mac] = v.split(".");
  const forged = `${exp}.${Buffer.from("bob@client.com").toString("base64url")}.${mac}`;
  assert.equal(await verifyAccessCookie(SECRET, "pageA", forged, now), null);
  // A later expiry breaks it too.
  assert.equal(await verifyAccessCookie(SECRET, "pageA", `${now + 9999}.${v.split(".").slice(1).join(".")}`, now), null);
  for (const junk of ["", "x", "1.2", "a.b.c", `${now + 60}..`, "9".repeat(2000)]) assert.equal(await verifyAccessCookie(SECRET, "pageA", junk, now), null, junk);
});

test("the email key never holds the address", async () => {
  const k = await emailKey(SECRET, "alice@client.com");
  assert.match(k, /^[0-9a-f]{32}$/);
  assert.notEqual(k, await emailKey(SECRET, "bob@client.com"));
});

test("the code email: the code, no page title, plain words", () => {
  const m = accessCodeEmail({ to: "a@client.com", code: "042117", pageUrl: "https://aired.sh/p/abc", minutes: 10 });
  assert.equal(m.subject, "042 117 is your aired code");
  assert.match(m.text, /042 117/);
  assert.match(m.text, /10 minutes, once/);
  assert.match(m.text, /ignore this email/);
  assert.ok(!/!/.test(m.text), "no exclamation marks");
  assert.deepEqual(parseFrom("aired <access@aired.sh>"), { email: "access@aired.sh", name: "aired" });
  assert.equal(parseFrom("access@aired.sh"), "access@aired.sh");
});

test("email sending: log mode only off production, the binding, Resend, or nothing", async () => {
  assert.equal(emailSenderFor({}), null);
  assert.equal(emailSenderFor({ EMAIL_MODE: "log" }), null, "no SITE_ORIGIN: production, so no codes in logs");
  assert.equal(emailSenderFor({ EMAIL_MODE: "log", SITE_ORIGIN: "http://localhost:8787" })?.kind, "log");
  const sent: unknown[] = [];
  const cf = emailSenderFor({ ACCESS_EMAIL: { async send(m) { sent.push(m); return {}; } }, EMAIL_FROM: "aired <access@aired.sh>" });
  assert.equal(cf?.kind, "cloudflare");
  await cf!.send({ to: "a@client.com", subject: "s", text: "t", html: "h" });
  assert.deepEqual(sent, [{ to: "a@client.com", from: { email: "access@aired.sh", name: "aired" }, subject: "s", text: "t", html: "h" }]);
  const calls: Array<[string, RequestInit]> = [];
  const resend = emailSenderFor({ RESEND_API_KEY: "re_x" }, (async (url: string, init: RequestInit) => { calls.push([url, init]); return new Response("{}", { status: 200 }); }) as never);
  await resend!.send({ to: "a@client.com", subject: "s", text: "t", html: "h" });
  assert.equal(calls[0]![0], "https://api.resend.com/emails");
});

// --- Routes ---------------------------------------------------------------------

function fakeR2() {
  const objects = new Map<string, string>();
  return {
    objects,
    async get(key: string) {
      const v = objects.get(key);
      return v === undefined ? null : { etag: "e1", async text() { return v; }, body: new Blob([v]).stream() };
    },
    async put(key: string, v: string) { objects.set(key, v); return { etag: "e1" }; },
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

const PAGE_HTML = `<!doctype html><html><head><title>Q4 client report</title></head><body><h1>Secret numbers</h1></body></html>`;

async function setup(opts: { email?: boolean } = {}) {
  const { db, raw } = fakeD1();
  const r2 = fakeR2();
  const kv = new Map<string, string>();
  const tokenHash = await hashToken(TOKEN);
  const add = async (id: string, ownerId: number | null) => {
    const meta = {
      id, title: "Q4 client report", size: PAGE_HTML.length, tokenHash, pin: null, reads: null, readCount: 0, permanent: true,
      createdAt: new Date(NOW - 1000).toISOString(), expiresAt: null, ownerId, project: null,
    };
    await insertPageRow(db, rowFromMetadata(meta as never, null, NOW));
    kv.set(`page:${id}`, serializeMetadata(meta as never));
    await r2.put(`pages/${id}/index.html`, PAGE_HTML);
  };
  await add("report", 7);
  await add("other", 7);
  await add("theirs", 8);
  await add("anon", null);
  const mail: Array<{ to: string; subject: string; text: string }> = [];
  const env = {
    DB: db, PAGES_BUCKET: r2, PAGES_KV: fakeKv(kv), SESSION_SECRET: SECRET, SITE_ORIGIN: "https://aired.test",
    ...(opts.email === false ? {} : { ACCESS_EMAIL: { async send(m: { to: string; subject: string; text: string }) { mail.push(m); return {}; } } }),
  };
  const app = new Hono();
  app.use("*", async (c, next) => {
    const uid = c.req.header("X-Test-User");
    c.set("user" as never, (uid ? { id: Number(uid), login: `u${uid}`, email: null, name: null } : null) as never);
    c.set("via" as never, (uid ? "key" : null) as never);
    await next();
  });
  app.route("/", access);
  app.route("/api", api);
  app.route("/", og);
  app.route("/", viewer);
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil(p: Promise<unknown>) { pending.push(p); }, passThroughOnException() {} };
  const flush = async () => { while (pending.length) await pending.shift(); };
  let ipN = 0;
  const fetch = async (path: string, init: RequestInit & { user?: number; ip?: string } = {}) => {
    const headers = new Headers(init.headers);
    headers.set("CF-Connecting-IP", init.ip ?? `198.51.100.${++ipN % 250}`);
    headers.set("X-Aired-Request", "1");
    if (init.user !== undefined) headers.set("X-Test-User", String(init.user));
    const res = await app.fetch(new Request(`https://aired.test${path}`, { ...init, headers }), env as never, ctx as never);
    await flush();
    return res;
  };
  const jsonReq = (method: string, path: string, body: unknown, extra: { user?: number; ip?: string; headers?: Record<string, string> } = {}) =>
    fetch(path, { method, body: JSON.stringify(body), user: extra.user, ip: extra.ip, headers: { "Content-Type": "application/json", ...extra.headers } });
  const share = (id: string, accessBody: unknown, user: number | undefined = 7, headers: Record<string, string> = {}) =>
    jsonReq("PATCH", `/api/pages/${id}`, { access: accessBody }, { user, headers });
  const send = (id: string, email: string, ip?: string) => jsonReq("POST", `/p/${id}/access/send`, { email }, { ip });
  const verify = (id: string, email: string, code: string, ip?: string) => jsonReq("POST", `/p/${id}/access/verify`, { email, code }, { ip });
  const lastCode = () => /(\d{3}) (\d{3})/.exec(mail.at(-1)?.text ?? "")?.slice(1).join("") ?? null;
  /** Share, ask for a code and enter it: the cookie a listed person ends up with. */
  const signInAs = async (id: string, email: string) => {
    await send(id, email);
    const res = await verify(id, email, lastCode()!);
    assert.equal(res.status, 200);
    return res.headers.get("Set-Cookie")!.split(";")[0]!;
  };
  return { db, raw, env, kv, mail, fetch, jsonReq, share, send, verify, lastCode, signInAs };
}

const body = async (res: Response) => (await res.json()) as Record<string, any>;

test("the owner shares a page with people: the row and KV record say so, the list is stored", async () => {
  const t = await setup();
  const res = await t.share("report", { mode: "people", emails: ["Alice@Client.com", "bob@client.com"] });
  assert.equal(res.status, 200);
  const b = await body(res);
  assert.equal(b.access, "people");
  assert.equal(b.hasPin, false);
  assert.deepEqual(b.changed, ["access"]);
  assert.deepEqual(b.allowed, { emails: ["alice@client.com", "bob@client.com"], domains: [] });
  assert.equal((await getPageRow(t.db, "report"))!.access, "people");
  assert.equal(parseMetadata(t.kv.get("page:report")!)!.access, "people");
  assert.deepEqual(await getAccessEntries(t.db, "report"), ["alice@client.com", "bob@client.com"]);
  // Details for the owner list them too.
  const details = await body(await t.fetch("/api/pages/report/details", { user: 7 }));
  assert.equal(details.access, "people");
  assert.deepEqual(details.allowed.emails, ["alice@client.com", "bob@client.com"]);
});

test("a visitor without a cookie gets the gate, which gives nothing about the page away", async () => {
  const t = await setup();
  await t.share("report", { mode: "people", emails: ["alice@client.com"] });
  const res = await t.fetch("/p/report");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /This page is private/);
  assert.ok(!html.includes("Q4 client report") && !html.includes("Secret numbers"), "no title, no content");
  assert.equal(res.headers.get("Cache-Control"), "private, no-store");
  assert.match(res.headers.get("X-Robots-Tag") ?? "", /noindex/);
  assert.match(res.headers.get("Content-Security-Policy") ?? "", /script-src 'nonce-[A-Za-z0-9]+'/);
  // Public metadata and the preview card hide the title and views, as for a PIN.
  const meta = await body(await t.fetch("/api/pages/report"));
  assert.equal(meta.title, null);
  assert.equal(meta.readCount, 0);
  assert.equal(meta.restricted, true);
  assert.equal(publicPageMeta({ id: "x", title: "T", size: 1, pin: null, expiresAt: null, access: "people" }, 9).title, null);
  assert.equal(cardTitle({ title: "T", pin: null, access: "people" }), "Private page");
  assert.equal(shotAllowed({ pin: null, access: "people", reads: null, size: 10, permanent: true, expiresAt: null }, NOW), false);
  const card = await (await t.fetch("/og/report")).text();
  assert.ok(!card.includes("Q4 client report"));
});

test("email, then code, then the page: a listed person gets in for 30 days", async () => {
  const t = await setup();
  await t.share("report", { mode: "people", emails: ["alice@client.com"] });
  const sent = await t.send("report", "ALICE@client.com");
  assert.equal(sent.status, 200);
  assert.equal((await body(sent)).message, SENT_MESSAGE);
  assert.equal(t.mail.length, 1);
  assert.equal(t.mail[0]!.to, "alice@client.com");
  assert.ok(!t.mail[0]!.text.includes("Q4 client report"), "the email doesn't name the page");
  const code = t.lastCode()!;
  const ok = await t.verify("report", "alice@client.com", `${code.slice(0, 3)} ${code.slice(3)}`);
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get("Set-Cookie")!;
  assert.match(cookie, /^acc_report=\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; Path=\/p\/report; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$/);
  const page = await t.fetch("/p/report", { headers: { Cookie: cookie.split(";")[0]! } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Secret numbers/);
  assert.equal(page.headers.get("Cache-Control"), "private, no-store");
  assert.match(page.headers.get("X-Robots-Tag") ?? "", /noindex/, "a private page is never indexed");
});

test("a code works once, only for its email and page, and not after it expires", async () => {
  const t = await setup();
  await t.share("report", { mode: "people", emails: ["alice@client.com", "bob@client.com"] });
  await t.share("other", { mode: "people", emails: ["alice@client.com"] });
  await t.send("report", "alice@client.com");
  const code = t.lastCode()!;
  assert.equal((await t.verify("report", "bob@client.com", code)).status, 400, "another email");
  assert.equal((await t.verify("other", "alice@client.com", code)).status, 400, "another page");
  assert.equal((await t.verify("report", "alice@client.com", code)).status, 200);
  const again = await t.verify("report", "alice@client.com", code);
  assert.equal(again.status, 400, "single use");
  assert.equal((await body(again)).error, BAD_CODE_MESSAGE);

  // Expired: move the row's expiry into the past.
  await t.send("report", "alice@client.com");
  const late = t.lastCode()!;
  t.raw.exec(`UPDATE access_codes SET expires_at = ${NOW - 1}`);
  assert.equal((await t.verify("report", "alice@client.com", late)).status, 400);
  assert.equal(CODE_TTL_MS, 10 * 60 * 1000);
});

test("five wrong tries use a code up, even if the right one comes next", async () => {
  const t = await setup();
  await t.share("report", { mode: "people", emails: ["alice@client.com"] });
  await t.send("report", "alice@client.com");
  const code = t.lastCode()!;
  const wrong = code === "000000" ? "111111" : "000000";
  for (let i = 0; i < CODE_MAX_ATTEMPTS; i++) assert.equal((await t.verify("report", "alice@client.com", wrong)).status, 400);
  assert.equal((await t.verify("report", "alice@client.com", code)).status, 400);
  // A new code starts again.
  await t.send("report", "alice@client.com");
  assert.equal((await t.verify("report", "alice@client.com", t.lastCode()!)).status, 200);
});

test("no enumeration: listed, unlisted, unknown page and public page all get the same answer, and only the listed person gets mail", async () => {
  const t = await setup();
  await t.share("report", { mode: "people", emails: ["alice@client.com"] });
  const answers = [];
  for (const [id, email] of [["report", "alice@client.com"], ["report", "mallory@client.com"], ["nosuchpage", "alice@client.com"], ["theirs", "alice@client.com"]] as const) {
    const res = await t.send(id, email);
    answers.push([res.status, await res.text()]);
  }
  for (const a of answers) assert.deepEqual(a, answers[0]);
  assert.equal(t.mail.length, 1);
  assert.equal(t.mail[0]!.to, "alice@client.com");
  // Verify: a wrong code for a listed email reads the same as any code for an unlisted one.
  const listed = await t.verify("report", "alice@client.com", "000000");
  const unlisted = await t.verify("report", "mallory@client.com", "000000");
  const unknown = await t.verify("nosuchpage", "alice@client.com", "000000");
  assert.deepEqual([listed.status, await listed.text()], [unlisted.status, await unlisted.text()]);
  assert.deepEqual([listed.status, await t.verify("report", "alice@client.com", "000000").then((r) => r.text())], [unknown.status, await unknown.text()]);
});

test("domains: anyone at the domain gets in; Free can't list one", async () => {
  const t = await setup();
  const free = await t.share("report", { mode: "people", domains: ["client.com"] });
  assert.equal(free.status, 402);
  assert.equal((await body(free)).limit, "access_domains");
  const tooMany = await t.share("report", { mode: "people", emails: ["a@c.com", "b@c.com", "c@c.com", "d@c.com"] });
  assert.equal(tooMany.status, 402);
  assert.equal((await body(tooMany)).limit, "access_people");
  // Pro (billing on, an active subscription in ent:<uid>).
  (t.env as Record<string, unknown>).BILLING_ENABLED = "1";
  t.kv.set("ent:7", JSON.stringify({ status: "active", currentPeriodEnd: new Date(NOW + 86_400_000).toISOString() }));
  assert.equal((await t.share("report", { mode: "people", domains: ["client.com"] })).status, 200);
  const cookie = await t.signInAs("report", "Carol@Client.com");
  assert.match(await (await t.fetch("/p/report", { headers: { Cookie: cookie } })).text(), /Secret numbers/);
});

test("rate limits: per email on a page, per address, and they count unlisted emails the same", async () => {
  const t = await setup();
  await t.share("report", { mode: "people", emails: ["alice@client.com"] });
  const ip = "203.0.113.50";
  for (let i = 0; i < ACCESS_RATE_LIMITS.pageEmail.limit; i++) assert.equal((await t.send("report", "nobody@client.com", ip)).status, 200);
  assert.equal((await t.send("report", "nobody@client.com", ip)).status, 429, "unlisted emails hit the same limit");
  for (let i = 0; i < ACCESS_RATE_LIMITS.pageEmail.limit; i++) assert.equal((await t.send("report", "alice@client.com")).status, 200);
  assert.equal((await t.send("report", "alice@client.com")).status, 429);
  assert.equal(t.mail.length, ACCESS_RATE_LIMITS.pageEmail.limit);
  // Guesses from one address on one page.
  const guesser = "203.0.113.77";
  for (let i = 0; i < ACCESS_RATE_LIMITS.verifyIp.limit; i++) assert.equal((await t.verify("report", `x${i}@client.com`, "123456", guesser)).status, 400);
  assert.equal((await t.verify("report", "alice@client.com", "123456", guesser)).status, 429);
});

test("the cookie is scoped to one page", async () => {
  const t = await setup();
  await t.share("report", { mode: "people", emails: ["alice@client.com"] });
  await t.share("other", { mode: "people", emails: ["alice@client.com"] });
  const cookie = await t.signInAs("report", "alice@client.com");
  // Sent to the other page (a browser wouldn't, given the Path), it still doesn't open it.
  const swapped = cookie.replace("acc_report=", "acc_other=");
  assert.match(await (await t.fetch("/p/other", { headers: { Cookie: swapped } })).text(), /This page is private/);
  assert.match(await (await t.fetch("/p/report", { headers: { Cookie: cookie } })).text(), /Secret numbers/);
});

test("taking someone off the list locks them out on their next visit and clears the cookie", async () => {
  const t = await setup();
  await t.share("report", { mode: "people", emails: ["alice@client.com", "bob@client.com"] });
  const cookie = await t.signInAs("report", "alice@client.com");
  await t.share("report", { mode: "people", emails: ["bob@client.com"] });
  const res = await t.fetch("/p/report", { headers: { Cookie: cookie } });
  assert.match(await res.text(), /This page is private/);
  assert.match(res.headers.get("Set-Cookie") ?? "", /^acc_report=; Path=\/p\/report;.*Max-Age=0/);
});

test("the signed-in owner always gets in, and isn't logged; another account gets the gate", async () => {
  const t = await setup();
  await t.share("report", { mode: "people", emails: ["alice@client.com"] });
  assert.match(await (await t.fetch("/p/report", { user: 7 })).text(), /Secret numbers/);
  assert.match(await (await t.fetch("/p/report", { user: 8 })).text(), /This page is private/);
  const log = await body(await t.fetch("/api/pages/report/access", { user: 7 }));
  assert.deepEqual(log.visitors, []);
});

test("the access log: who opened it, owner only", async () => {
  const t = await setup();
  await t.share("report", { mode: "people", emails: ["alice@client.com", "bob@client.com"] });
  const cookie = await t.signInAs("report", "alice@client.com");
  await t.fetch("/p/report", { headers: { Cookie: cookie } });
  await t.fetch("/p/report", { headers: { Cookie: cookie } });
  const res = await t.fetch("/api/pages/report/access", { user: 7 });
  assert.equal(res.status, 200);
  const b = await body(res);
  assert.equal(b.mode, "people");
  assert.deepEqual(b.emails, ["alice@client.com", "bob@client.com"]);
  assert.equal(b.visitors.length, 1);
  assert.equal(b.visitors[0].email, "alice@client.com");
  assert.equal(b.visitors[0].views, 2);
  assert.ok(b.visitors[0].first_opened_at <= b.visitors[0].last_opened_at);
  assert.equal(b.email_ready, true);
  // Nobody else: not signed out, not another account, not the update token.
  assert.equal((await t.fetch("/api/pages/report/access")).status, 401);
  assert.equal((await t.fetch("/api/pages/report/access", { user: 8 })).status, 403);
  assert.equal((await t.fetch("/api/pages/report/access", { headers: { "X-Update-Token": TOKEN } })).status, 401);
  // Details through the token say the mode, never the list.
  const viaToken = await body(await t.fetch("/api/pages/report/details", { headers: { "X-Update-Token": TOKEN } }));
  assert.equal(viaToken.access, "people");
  assert.equal(viaToken.allowed, undefined);
});

test("only the signed-in owner changes who can open a page; anonymous pages can't be restricted", async () => {
  const t = await setup();
  const viaToken = await t.jsonReq("PATCH", "/api/pages/report", { access: { mode: "people", emails: ["a@client.com"] }, update_token: TOKEN });
  assert.equal(viaToken.status, 403);
  assert.equal((await body(viaToken)).code, "owner_required");
  assert.equal((await t.share("theirs", { mode: "people", emails: ["a@client.com"] }, 7)).status, 403);
  const anon = await t.jsonReq("PATCH", "/api/pages/anon", { access: { mode: "people", emails: ["a@client.com"] }, update_token: TOKEN });
  assert.equal(anon.status, 403);
  assert.equal((await getPageRow(t.db, "anon"))!.access, null);
  // Out of "people" mode needs the owner too, a new PIN included.
  await t.share("report", { mode: "people", emails: ["a@client.com"] });
  assert.equal((await t.jsonReq("PATCH", "/api/pages/report", { pin: "4821", update_token: TOKEN })).status, 403);
  assert.equal((await t.jsonReq("PATCH", "/api/pages/report", { access: { mode: "public" }, update_token: TOKEN })).status, 403);
  assert.equal((await getPageRow(t.db, "report"))!.access, "people");
  // A token holder can still retitle it.
  assert.equal((await t.jsonReq("PATCH", "/api/pages/report", { title: "New", update_token: TOKEN })).status, 200);
  assert.equal((await getPageRow(t.db, "report"))!.access, "people");
  assert.equal(parseMetadata(t.kv.get("page:report")!)!.access, "people", "a KV rebuild keeps the flag");
});

test("back to public, or to a PIN: the list goes and the page opens accordingly", async () => {
  const t = await setup();
  await t.share("report", { mode: "people", emails: ["alice@client.com"] });
  const pub = await t.share("report", { mode: "public" });
  assert.equal(pub.status, 200);
  assert.equal((await body(pub)).access, "public");
  assert.deepEqual(await getAccessEntries(t.db, "report"), []);
  assert.match(await (await t.fetch("/p/report")).text(), /Secret numbers/);
  await t.share("report", { mode: "people", emails: ["alice@client.com"] });
  const pin = await t.jsonReq("PATCH", "/api/pages/report", { pin: "4821" }, { user: 7 });
  assert.equal(pin.status, 200);
  assert.equal((await body(pin)).access, "pin");
  assert.deepEqual(await getAccessEntries(t.db, "report"), []);
  assert.match(await (await t.fetch("/p/report")).text(), /PIN Required/);
  // mode "pin" with no PIN anywhere is refused.
  await t.share("other", { mode: "public" });
  assert.equal((await t.share("other", { mode: "pin" })).status, 400);
});

test("without email set up, a page can't be made people-only", async () => {
  const t = await setup({ email: false });
  const res = await t.share("report", { mode: "people", emails: ["a@client.com"] });
  assert.equal(res.status, 503);
  assert.equal((await body(res)).code, "email_unavailable");
  assert.equal((await getPageRow(t.db, "report"))!.access, null);
});

test("a people page whose list can't be read fails closed", async () => {
  const t = await setup();
  await t.share("report", { mode: "people", emails: ["alice@client.com"] });
  const cookie = await t.signInAs("report", "alice@client.com");
  t.raw.exec("DROP TABLE page_access");
  const res = await t.fetch("/p/report", { headers: { Cookie: cookie } });
  assert.equal(res.status, 503);
  assert.ok(!(await res.text()).includes("Secret numbers"));
});

test("housekeeping prunes spent codes and the data of deleted pages", async () => {
  const t = await setup();
  await t.share("report", { mode: "people", emails: ["alice@client.com"] });
  await t.fetch("/p/report", { headers: { Cookie: await t.signInAs("report", "alice@client.com") } });
  await t.send("report", "alice@client.com");
  const count = (table: string) => (t.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  assert.equal(count("access_codes"), 1);
  const later = Date.now() + CODE_TTL_MS + 1000;
  await pruneAccessData(t.db, later);
  assert.equal(count("access_codes"), 0);
  assert.equal(count("page_access"), 1);
  assert.equal(count("access_log"), 1);
  t.raw.exec(`UPDATE pages SET deleted_at = ${NOW} WHERE id = 'report'`);
  await pruneAccessData(t.db, later);
  assert.equal(count("page_access"), 0);
  assert.equal(count("access_log"), 0);
});

test("wiring: the gate runs before the page is read from R2 or a view is counted", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/routes/viewer.ts", import.meta.url), "utf8");
  const get = src.slice(src.indexOf('viewer.get("/p/:id"'), src.indexOf('viewer.post("/p/:id/verify-pin"'));
  assert.ok(get.indexOf("accessGate(") > 0);
  assert.ok(get.indexOf("accessGate(") < get.indexOf("countPageView("), "gate before counting");
  assert.ok(get.indexOf("accessGate(") < get.indexOf("PAGES_BUCKET.get("), "gate before reading the HTML");
});

// --- Surfaces: MCP set_options and `aired set --only` ----------------------------

test("set_options passes access through and shows the list to the owner", async () => {
  const { patchBody, setOptionsOut, pageText, changesPageSettings } = await import("../src/lib/mcp-shapes.ts");
  assert.deepEqual(patchBody({ access: { mode: "people", emails: ["a@client.com"], domains: ["client.com"] } }), { access: { mode: "people", emails: ["a@client.com"], domains: ["client.com"] } });
  assert.equal(changesPageSettings({ access: { mode: "public" } }), true);
  const out = setOptionsOut({
    id: "p1", url: "https://aired.sh/p/p1", title: "Q4", size: 1, readCount: 0, reads: null, hasPin: false, access: "people",
    permanent: true, createdAt: null, expiresAt: null, project: null, changed: ["access"], allowed: { emails: ["a@client.com"], domains: ["client.com"] },
  }, "https://aired.sh");
  assert.equal(out.access, "people");
  assert.deepEqual(out.allowed, { emails: ["a@client.com"], domains: ["client.com"] });
  assert.match(pageText(out, "Changed access of"), /Access: only the people on its list\nPeople: a@client\.com, anyone @client\.com/);
});

test("aired set --only splits emails and @domains", async () => {
  const { accessFromOnly } = await import("../../cli/src/lib/access-flags.ts");
  assert.deepEqual(accessFromOnly("alice@x.com, @client.com bob@x.com"), { access: { mode: "people", emails: ["alice@x.com", "bob@x.com"], domains: ["client.com"] } });
  assert.ok("error" in accessFromOnly(""));
  assert.match((accessFromOnly("client.com") as { error: string }).error, /@client\.com/);
});
