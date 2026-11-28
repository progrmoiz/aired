import { test } from "node:test";
import assert from "node:assert/strict";
import "./helpers/worker-loader.ts";
import { fakeD1 } from "./helpers/d1.ts";

// The real PDF routes, page store, budget and access rules, on fake
// bindings. The fake browser records the HTML it was served and the
// options page.pdf() got, so the tests see exactly what would be printed.
const { Hono } = await import("hono");
const { pdf } = await import("../src/routes/pdf.ts");
const { insertPageRow, rowFromMetadata } = await import("../src/lib/pages-store.ts");
const { buildContent, writeSidecar } = await import("../src/lib/page-content.ts");
const { replaceAccessList } = await import("../src/lib/access-store.ts");
const { accessCookieValue } = await import("../src/lib/access-code.ts");
const { pinCookieValue } = await import("../src/lib/pin-hash.ts");
const { addSpent, readBudget } = await import("../src/lib/og-shot.ts");
const { forgetShots } = await import("../src/lib/og-render.ts");
const { pdfPrefix, pdfViewerGrant, DEFAULT_PDF_BUDGET_MS, PDF_CALLER_BUDGET_MS } = await import("../src/lib/pdf-export.ts");
const { hashToken } = await import("@aired/core");

type User = { id: number; login: string; email: null; name: null };
const kim: User = { id: 7, login: "kim", email: null, name: null };
const ana: User = { id: 9, login: "ana", email: null, name: null };
const SECRET = "test-session-secret-0123456789abcdef";
const TOKEN = "tok_owner_secret_value";
const PIN_HASH = "pbkdf2$100000$c2FsdA$aGFzaA";
const NOW = Date.now();
const NOTE = "Pause here and ask about the Q3 budget";

/** R2 with a new etag on every write, as R2 gives each version its own. */
function fakeR2() {
  const objects = new Map<string, { body: Uint8Array; etag: string; customMetadata?: Record<string, string> }>();
  let n = 0;
  const obj = (o: { body: Uint8Array; etag: string; customMetadata?: Record<string, string> }) => ({
    body: new Blob([o.body]).stream(),
    etag: o.etag,
    customMetadata: o.customMetadata,
    async text() { return new TextDecoder().decode(o.body); },
    async arrayBuffer() { return o.body.slice().buffer; },
  });
  return {
    objects,
    async get(key: string) { const o = objects.get(key); return o ? obj(o) : null; },
    async head(key: string) { const o = objects.get(key); return o ? { etag: o.etag } : null; },
    async put(key: string, v: string | Uint8Array, opts?: { customMetadata?: Record<string, string> }) {
      const etag = `etag${++n}abcdef`;
      objects.set(key, { body: typeof v === "string" ? new TextEncoder().encode(v) : v, etag, customMetadata: opts?.customMetadata });
      return { etag };
    },
    async delete(keys: string | string[]) { for (const k of [keys].flat()) objects.delete(k); },
    async list({ prefix = "" }: { prefix?: string } = {}) {
      return { objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, uploaded: new Date() })), truncated: false };
    },
  };
}

function fakeBrowser() {
  const runs: Array<{ html: string; options: Record<string, unknown> }> = [];
  let failWith: string | null = null;
  const browser = {
    runs,
    failNext(message: string) { failWith = message; },
    async launch() {
      if (failWith !== null) { const m = failWith; failWith = null; throw new Error(m); }
      const handlers: Record<string, (x: unknown) => void> = {};
      const mainFrame = {};
      let served = "";
      const page = {
        async setViewport() {},
        on(event: string, h: (x: unknown) => void) { handlers[event] = h; },
        async setRequestInterception() {},
        mainFrame: () => mainFrame,
        async goto(url: string) {
          handlers.request?.({ url: () => url, isNavigationRequest: () => true, frame: () => mainFrame, resourceType: () => "document", respond: async (r: { body: string }) => { served = r.body; }, abort: async () => {}, continue: async () => {} });
        },
        async evaluate() { return true; },
        async pdf(options: Record<string, unknown>) {
          runs.push({ html: served, options });
          const pages = (served.match(/data-aired-notes=/g) ?? []).length + 2;
          return new TextEncoder().encode(`%PDF-1.7\n${"<< /Type /Page >>\n".repeat(pages)}<< /Type /Pages >>\n%%EOF`);
        },
        async close() {},
      };
      return { newPage: async () => page, close: async () => {} };
    },
  };
  return browser;
}

const DECK_HTML = `<!DOCTYPE html><html><head><title>Q3 review</title></head><body>
<section><h1>Q3 review</h1><aside class="notes">${NOTE}</aside></section>
<section><h2>Next steps</h2></section>
</body></html>`;

async function setup(opts: { user?: User | null; pro?: boolean; burst?: boolean } = {}) {
  const { db } = fakeD1();
  const r2 = fakeR2();
  const browser = fakeBrowser();
  const hash = await hashToken(TOKEN);
  const meta = (id: string, extra: Record<string, unknown> = {}) => ({
    id, title: `Page ${id}`, size: 40, tokenHash: hash, pin: null, reads: null, readCount: 0, permanent: true,
    createdAt: new Date(NOW - 1000).toISOString(), expiresAt: null, ownerId: 7, project: null, allowPdf: false, ...extra,
  });
  const pages: Array<[string, Record<string, unknown>]> = [
    ["closed", {}],
    ["open", { allowPdf: true }],
    ["pinned", { pin: PIN_HASH, allowPdf: true }],
    ["pinclosed", { pin: PIN_HASH }],
    ["people", { access: "people", allowPdf: true }],
    ["limited", { reads: 5, allowPdf: true }],
    ["deck", { allowPdf: true }],
    ["anon", { ownerId: null, allowPdf: true }],
  ];
  for (const [id, extra] of pages) {
    await insertPageRow(db, rowFromMetadata(meta(id, extra) as never, null, NOW));
    await r2.put(`pages/${id}/index.html`, `<html><head><title>${id}</title></head><body><h1>${id}</h1></body></html>`);
  }
  const deck = buildContent({ html: DECK_HTML, deck: true });
  await r2.put("pages/deck/index.html", deck.html);
  await writeSidecar(r2 as never, "deck", deck.sidecar);
  await replaceAccessList(db, "people", 7, ["ana@client.com"], NOW);

  let burstLeft = opts.burst === false ? 0 : 1000;
  const env = {
    DB: db,
    PAGES_BUCKET: r2,
    PAGES_KV: {
      async get(key: string) {
        if (opts.pro && key === "ent:7") return { status: "active", currentPeriodEnd: new Date(NOW + 30 * 86_400_000).toISOString() };
        return null;
      },
      async put() {}, async delete() {},
    },
    BROWSER: browser,
    SESSION_SECRET: SECRET,
    SITE_ORIGIN: "https://aired.test",
    ...(opts.pro ? { BILLING_ENABLED: "1" } : {}),
    PDF_BURST: { async limit() { return { success: burstLeft-- > 0 }; } },
  };
  let user = opts.user ?? null;
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user" as never, user as never);
    c.set("via" as never, (user ? "key" : null) as never);
    await next();
  });
  app.route("/", pdf);
  let ipN = 0;
  const call = (method: string, path: string, o: { body?: unknown; cookie?: string; ip?: string; country?: string } = {}) =>
    app.fetch(
      new Request(`https://aired.test${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          // A different network per call by default, so the hourly limit never decides a test.
          "CF-Connecting-IP": o.ip ?? `198.51.100.${++ipN}`,
          ...(o.country ? { "CF-IPCountry": o.country } : {}),
          ...(o.cookie ? { Cookie: o.cookie } : {}),
        },
        ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
      }),
      env as never,
      { waitUntil() {}, passThroughOnException() {} } as never,
    );
  return { call, db, r2, browser, env, as(u: User | null) { user = u; } };
}

const isPdf = async (res: Response) => {
  const bytes = new Uint8Array(await res.arrayBuffer());
  return new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
};
const pinCookie = async (id: string) => `pin_${id}=${await pinCookieValue(SECRET, id, Math.floor(NOW / 1000) + 3600)}`;

// --- Who may download ---------------------------------------------------------

test("a viewer gets the PDF of an open page; without allow_pdf they're refused, and a view-limited page is never offered", async () => {
  const t = await setup();
  const ok = await t.call("GET", "/p/open/pdf");
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("Content-Type"), "application/pdf");
  assert.match(ok.headers.get("Content-Disposition") ?? "", /^attachment; filename="page-open\.pdf"$/);
  assert.equal(ok.headers.get("Cache-Control"), "private, no-store");
  assert.ok(await isPdf(ok));

  const closed = await t.call("GET", "/p/closed/pdf");
  assert.equal(closed.status, 403);
  assert.match(await closed.text(), /hasn't turned on PDF downloads/);
  const limited = await t.call("GET", "/p/limited/pdf");
  assert.equal(limited.status, 403, "a file would outlive the view limit");
  assert.equal((await t.call("GET", "/p/nope/pdf")).status, 404);
  assert.equal(t.browser.runs.length, 1, "refusals never start a browser");
});

test("a PIN page: locked without the cookie, and the refusal is the same whether or not PDFs are on", async () => {
  const t = await setup();
  const locked = await t.call("GET", "/p/pinned/pdf");
  const lockedOff = await t.call("GET", "/p/pinclosed/pdf");
  assert.equal(locked.status, 403);
  assert.equal(lockedOff.status, 403);
  assert.equal(await locked.text(), await lockedOff.text(), "nothing about a locked page leaks");
  assert.equal((await t.call("GET", "/p/pinned/pdf", { cookie: `pin_pinned=999.forged` })).status, 403);
  // Another page's cookie doesn't unlock this one.
  assert.equal((await t.call("GET", "/p/pinned/pdf", { cookie: (await pinCookie("open")).replace("pin_open", "pin_pinned") })).status, 403);
  assert.equal(t.browser.runs.length, 0);

  const unlocked = await t.call("GET", "/p/pinned/pdf", { cookie: await pinCookie("pinned") });
  assert.equal(unlocked.status, 200);
  assert.ok(await isPdf(unlocked));
});

test("a PIN page's button grant works, until it expires or the PIN changes", async () => {
  const t = await setup();
  const now = Math.floor(Date.now() / 1000);
  const grant = await pdfViewerGrant(SECRET, "pinned", PIN_HASH, now + 3600);
  assert.equal((await t.call("GET", `/p/pinned/pdf?g=${encodeURIComponent(grant)}`)).status, 200);
  const old = await pdfViewerGrant(SECRET, "pinned", PIN_HASH, now - 1);
  assert.equal((await t.call("GET", `/p/pinned/pdf?g=${encodeURIComponent(old)}`)).status, 403, "expired");
  const otherPin = await pdfViewerGrant(SECRET, "pinned", "pbkdf2$100000$b2xk$b2xk", now + 3600);
  assert.equal((await t.call("GET", `/p/pinned/pdf?g=${encodeURIComponent(otherPin)}`)).status, 403, "made for a PIN the page no longer has");
  const forOther = await pdfViewerGrant(SECRET, "open", PIN_HASH, now + 3600);
  assert.equal((await t.call("GET", `/p/pinned/pdf?g=${encodeURIComponent(forOther)}`)).status, 403, "made for another page");
});

test("an 'only these people' page: a listed person's cookie gets the PDF; anyone else, or someone taken off the list, is locked out", async () => {
  const t = await setup();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  assert.equal((await t.call("GET", "/p/people/pdf")).status, 403);
  const listed = `acc_people=${await accessCookieValue(SECRET, "people", "ana@client.com", exp)}`;
  const res = await t.call("GET", "/p/people/pdf", { cookie: listed });
  assert.equal(res.status, 200);
  assert.ok(await isPdf(res));
  const stranger = `acc_people=${await accessCookieValue(SECRET, "people", "eve@else.com", exp)}`;
  const refused = await t.call("GET", "/p/people/pdf", { cookie: stranger });
  assert.equal(refused.status, 403);
  assert.match(await refused.text(), /unlock it first/);
  await replaceAccessList(t.db, "people", 7, ["bob@client.com"], NOW);
  assert.equal((await t.call("GET", "/p/people/pdf", { cookie: listed })).status, 403, "the list as it is now decides");
});

test("the signed-in owner downloads any of their pages: locked, view-limited or with PDFs off", async () => {
  const t = await setup({ user: kim });
  for (const id of ["closed", "pinclosed", "people", "limited"]) {
    const res = await t.call("GET", `/p/${id}/pdf`);
    assert.equal(res.status, 200, id);
  }
  t.as(ana);
  assert.equal((await t.call("GET", "/p/pinclosed/pdf")).status, 403, "another account is a viewer");
});

// --- Speaker notes --------------------------------------------------------------

test("speaker notes: never printed for a viewer; the signed-in owner can ask for them", async () => {
  const t = await setup();
  const viewer = await t.call("GET", "/p/deck/pdf");
  assert.equal(viewer.status, 200);
  assert.ok(!t.browser.runs[0]!.html.includes(NOTE), "the public deck has no notes");
  const asked = await t.call("GET", "/p/deck/pdf?notes=1");
  assert.equal(asked.status, 403);
  assert.match(await asked.text(), /only for the deck's owner/);
  // Asking for notes on a page with none, or on a locked page, gets the same answer as on a deck.
  assert.equal(await (await t.call("GET", "/p/open/pdf?notes=1")).text(), "Speaker notes are only for the deck's owner, signed in.");

  t.as(kim);
  const owner = await t.call("GET", "/p/deck/pdf?notes=1");
  assert.equal(owner.status, 200);
  assert.match(owner.headers.get("Content-Disposition") ?? "", /page-deck-notes\.pdf/);
  const printed = t.browser.runs.at(-1)!.html;
  assert.ok(printed.includes(NOTE), "the notes page is printed");
  assert.match(printed, /Speaker notes · slide 1 of 2/);
  assert.equal((printed.match(/data-aired-notes=/g) ?? []).length, 1, "only slides with notes get a notes page");
  // The notes version is its own cached file: the viewer's copy never has them.
  const again = await t.call("GET", "/p/deck/pdf");
  assert.equal(again.status, 200);
  assert.equal(t.browser.runs.length, 2, "the viewer's version came from the cache");
});

test("POST: notes need the signed-in owner; an update token isn't enough", async () => {
  const t = await setup();
  const byToken = await t.call("POST", "/api/pages/deck/pdf", { body: { update_token: TOKEN, notes: true } });
  assert.equal(byToken.status, 403);
  assert.equal(((await byToken.json()) as { error: { code: string } }).error.code, "owner_required");
  const plain = await t.call("POST", "/api/pages/deck/pdf", { body: { update_token: TOKEN } });
  assert.equal(plain.status, 200);
  assert.equal(((await plain.json()) as { notes: boolean }).notes, false);
  t.as(kim);
  const owner = await t.call("POST", "/api/pages/deck/pdf", { body: { notes: true } });
  const body = (await owner.json()) as { notes: boolean; kind: string; paper: string | null; pages: number };
  assert.equal(owner.status, 200);
  assert.deepEqual([body.notes, body.kind, body.paper, body.pages], [true, "deck", null, 3]);
});

// --- The API and its download links ------------------------------------------------

test("POST: owner only, then a 15-minute link that serves the cached PDF without a browser", async () => {
  const t = await setup();
  assert.equal((await t.call("POST", "/api/pages/open/pdf", { body: {} })).status, 401);
  assert.equal((await t.call("POST", "/api/pages/open/pdf", { body: { update_token: "wrong" } })).status, 403);
  assert.equal((await t.call("POST", "/api/pages/open/pdf", { body: { paper: "A5" } })).status, 400);
  t.as(ana);
  assert.equal((await t.call("POST", "/api/pages/open/pdf", { body: {} })).status, 403);
  t.as(null);

  const res = await t.call("POST", "/api/pages/open/pdf", { body: { update_token: TOKEN, paper: "letter" } });
  assert.equal(res.status, 200);
  const out = (await res.json()) as Record<string, unknown>;
  assert.equal(out.paper, "letter");
  assert.equal(out.cached, false);
  assert.equal(out.footer, true, "a free account's PDF carries the aired line");
  assert.equal(out.filename, "page-open.pdf");
  const expires = Date.parse(String(out.expires_at));
  assert.ok(expires > Date.now() + 14 * 60_000 && expires <= Date.now() + 15 * 60_000 + 1000);
  const link = new URL(String(out.download_url));
  assert.equal(link.pathname, "/p/open/pdf");

  const download = await t.call("GET", `${link.pathname}${link.search}`);
  assert.equal(download.status, 200);
  assert.ok(await isPdf(download));
  assert.equal(t.browser.runs.length, 1, "the link never renders");
  // A tampered link, or one for another page, is refused.
  assert.equal((await t.call("GET", `${link.pathname}${link.search.replace(/.$/, "x")}`)).status, 410);
  assert.equal((await t.call("GET", `/p/pinned/pdf${link.search}`)).status, 410);
  // The page changes: the link names the old version, so it stops working.
  await t.r2.put("pages/open/index.html", "<h1>v2</h1>");
  const stale = await t.call("GET", `${link.pathname}${link.search}`);
  assert.equal(stale.status, 410);
  assert.match(await stale.text(), /page has changed/);
});

test("paper: Letter in the US, A4 elsewhere, unless asked; decks print at their slide size", async () => {
  const t = await setup();
  await t.call("GET", "/p/open/pdf", { country: "US" });
  assert.equal(t.browser.runs[0]!.options.format, "Letter");
  await t.call("GET", "/p/open/pdf", { country: "DE" });
  assert.equal(t.browser.runs[1]!.options.format, "A4");
  await t.call("GET", "/p/open/pdf?paper=letter", { country: "DE" });
  assert.equal(t.browser.runs.length, 2, "Letter was made already: from the cache");
  await t.call("GET", "/p/deck/pdf", { country: "US" });
  assert.equal(t.browser.runs[2]!.options.width, "1280px");
  assert.equal(t.browser.runs[2]!.options.format, undefined);
  assert.equal((await t.call("GET", "/p/open/pdf?paper=A3")).status, 400);
});

test("plans: free and anonymous PDFs carry 'Made with aired'; Pro PDFs have none", async () => {
  const free = await setup();
  await free.call("GET", "/p/open/pdf");
  await free.call("GET", "/p/deck/pdf");
  await free.call("GET", "/p/anon/pdf");
  assert.match(String(free.browser.runs[0]!.options.footerTemplate), /Made with aired/);
  assert.match(free.browser.runs[1]!.html, /class="aired-pdf-mark"/);
  assert.match(String(free.browser.runs[2]!.options.footerTemplate), /Made with aired/);

  const pro = await setup({ pro: true });
  await pro.call("GET", "/p/open/pdf");
  await pro.call("GET", "/p/deck/pdf");
  assert.doesNotMatch(String(pro.browser.runs[0]!.options.footerTemplate), /Made with aired/);
  assert.match(String(pro.browser.runs[0]!.options.footerTemplate), /pageNumber/, "page numbers stay");
  assert.doesNotMatch(pro.browser.runs[1]!.html, /aired-pdf-mark"/);
});

// --- Cache per version -------------------------------------------------------------

test("cache: one render per version and variant; an update renders again, and forgetShots drops the old files", async () => {
  const t = await setup();
  await t.call("GET", "/p/open/pdf", { country: "DE" });
  await t.call("GET", "/p/open/pdf", { country: "DE" });
  assert.equal(t.browser.runs.length, 1, "the second download came from R2");
  const cached = [...t.r2.objects.keys()].filter((k) => k.startsWith(pdfPrefix("open")));
  assert.equal(cached.length, 1);
  assert.match(cached[0]!, /^pages\/open\/pdf\/[A-Za-z0-9]{1,12}\/page-a4-mark\.pdf$/);

  await t.r2.put("pages/open/index.html", "<h1>v2</h1>");
  await t.call("GET", "/p/open/pdf", { country: "DE" });
  assert.equal(t.browser.runs.length, 2, "a new version is a new PDF");
  assert.match(t.browser.runs[1]!.html, /v2/);

  await forgetShots(t.env as never, "open");
  assert.deepEqual([...t.r2.objects.keys()].filter((k) => k.startsWith(pdfPrefix("open"))), []);
});

// --- Budget and rate limits -------------------------------------------------------------

test("budget: a spent PDF budget refuses new renders with 429 and never launches, but cached PDFs still download", async () => {
  const t = await setup({ user: kim });
  await t.call("GET", "/p/open/pdf", { country: "DE" });
  await addSpent(t.db as never, DEFAULT_PDF_BUDGET_MS, Date.now(), "pdf");
  const fresh = await t.call("POST", "/api/pages/closed/pdf", { body: {} });
  assert.equal(fresh.status, 429);
  const body = ((await fresh.json()) as { error: { code: string; message: string } }).error;
  assert.equal(body.code, "pdf_budget");
  assert.match(body.message, /00:00 UTC/);
  assert.ok(Number(fresh.headers.get("Retry-After")) > 0);
  const viewerFresh = await t.call("GET", "/p/deck/pdf");
  assert.equal(viewerFresh.status, 429);
  assert.equal(t.browser.runs.length, 1);
  const again = await t.call("GET", "/p/open/pdf", { country: "DE" });
  assert.equal(again.status, 200, "made before: costs no browser time");
});

test("budget: each caller has a daily share; a viewer's is the smallest, and real time replaces the reservation", async () => {
  const t = await setup();
  const ip = "203.0.113.50";
  await t.call("GET", "/p/open/pdf", { ip });
  const shared = await readBudget(t.db as never);
  assert.ok(shared !== null && shared.spentMs < 5_000, "settled to the real time, not the 35-second reservation");
  // Fill this network's share: the next new render is refused, while another network still gets one.
  const rows = await (t.db as unknown as { prepare(q: string): { all<T>(): Promise<{ results: T[] }> } }).prepare("SELECT name FROM og_shot_budget WHERE name LIKE 'pdf:ip:%'").all<{ name: string }>();
  assert.equal(rows.results.length, 1);
  await addSpent(t.db as never, PDF_CALLER_BUDGET_MS.viewer, Date.now(), rows.results[0]!.name);
  assert.equal((await t.call("GET", "/p/deck/pdf", { ip })).status, 429);
  assert.equal((await t.call("GET", "/p/deck/pdf", { ip: "203.0.113.51" })).status, 200);
});

test("budget: Browser Rendering saying 'too many' holds back PDFs, not link previews", async () => {
  const t = await setup({ user: kim });
  t.browser.failNext("Unable to create new browser: code: 429: message: Too many browsers");
  const res = await t.call("POST", "/api/pages/open/pdf", { body: {} });
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, "pdf_busy");
  const shared = await readBudget(t.db as never);
  assert.ok(shared === null || shared.blockedUntil <= Date.now(), "screenshots aren't blocked");
  assert.ok((await readBudget(t.db as never, "pdf"))!.blockedUntil > Date.now());
  assert.ok((await readBudget(t.db as never, "pdf:u:7"))!.spentMs < 5_000, "the failed launch gave its reservation back");
});

test("rate limits: the per-minute guard stops new renders before any browser starts", async () => {
  const t = await setup({ user: kim, burst: false });
  const res = await t.call("POST", "/api/pages/open/pdf", { body: {} });
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, "pdf_busy");
  assert.equal(res.headers.get("Retry-After"), "60");
  assert.equal(t.browser.runs.length, 0);
  assert.equal(await readBudget(t.db as never, "pdf"), null, "no time was charged");
});

test("rate limits: downloads are capped per caller per hour, cached or not", async () => {
  const t = await setup();
  const ip = "203.0.113.77";
  let last = 0;
  for (let i = 0; i < 61; i++) last = (await t.call("GET", "/p/open/pdf", { ip, country: "DE" })).status;
  assert.equal(last, 429);
  assert.equal(t.browser.runs.length, 1);
  assert.equal((await t.call("GET", "/p/open/pdf", { ip: "203.0.113.78", country: "DE" })).status, 200, "another caller isn't affected");
});
