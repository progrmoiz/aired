import "./helpers/ts-resolve.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeD1 } from "./helpers/d1.ts";

// The real API, owner tools, speaker view and viewer, on fake bindings: a
// deck's speaker notes reach its owner and nobody else.
const { Hono } = await import("hono");
type Context = import("hono").Context;
const { api } = await import("../src/routes/api.ts");
const { pageTools } = await import("../src/routes/page-tools.ts");
const { presenter } = await import("../src/routes/presenter.ts");
const { viewer } = await import("../src/routes/viewer.ts");
const { applyApiContract } = await import("../src/middleware/api-contract.ts");
const { sidecarKey } = await import("../src/lib/page-content.ts");

function fakeKv(): KVNamespace {
  const m = new Map<string, string>();
  return {
    async get(k: string, opts?: unknown) {
      const v = m.get(k) ?? null;
      const type = typeof opts === "string" ? opts : (opts as { type?: string } | undefined)?.type;
      return v !== null && type === "json" ? JSON.parse(v) : v;
    },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: "" }; },
  } as unknown as KVNamespace;
}

function fakeR2() {
  const m = new Map<string, string>();
  const bucket = {
    async put(k: string, v: string) { m.set(k, String(v)); return { key: k, etag: `e${m.size}` }; },
    async get(k: string) {
      const v = m.get(k);
      return v === undefined ? null : { text: async () => v, body: v, etag: "e1", customMetadata: {} };
    },
    async head(k: string) { return m.has(k) ? { key: k, etag: "e1" } : null; },
    async delete(keys: string | string[]) { for (const k of [keys].flat()) m.delete(k); },
    async list() { return { objects: [], truncated: false }; },
  };
  return { bucket: bucket as unknown as R2Bucket, m };
}

const NOTE_A = "NOTE-ALPHA-only-for-the-owner";
const NOTE_B = "NOTE-BRAVO-only-for-the-owner";
const DECK_MD = `---\ntype: deck\ntitle: Board update\n---\n# Board update\n\nNote: ${NOTE_A}\n\n---\n\n## Numbers\n\n- Up 18%\n\n<!-- ${NOTE_B} -->\n\n---\n\n## Thanks\n`;
const DECK_HTML = `<!DOCTYPE html><html><head><meta name="aired" content="deck"><title>HTML deck</title></head><body><section><h1>One</h1><aside class="notes">${NOTE_A}</aside></section><section><h2>Two</h2><aside class="notes">${NOTE_B}</aside></section></body></html>`;

function setup() {
  const d1 = fakeD1();
  const r2 = fakeR2();
  const env = { PAGES_KV: fakeKv(), PAGES_BUCKET: r2.bucket, DB: d1.db, SESSION_SECRET: "x".repeat(32), SITE_ORIGIN: "https://aired.sh" };
  const app = new Hono();
  // X-Test-User signs the request in as that account (a session or key).
  applyApiContract(app as never, (async (c: Context, next: () => Promise<void>) => {
    const id = c.req.header("X-Test-User");
    c.set("user", id === undefined ? null : { id: Number(id), login: `u${id}`, email: null, name: null });
    c.set("via", id === undefined ? null : "key");
    c.set("jti", null);
    c.set("requestId", "test");
    await next();
  }) as never);
  app.route("/api", pageTools as never);
  app.route("/api", api as never);
  app.route("/", presenter as never);
  app.route("/", viewer as never);
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} };
  const call = (path: string, init: RequestInit = {}) =>
    app.request(`https://aired.sh${path}`, { ...init, headers: { "CF-Connecting-IP": "203.0.113.9", ...(init.headers ?? {}) } }, env, ctx as never);
  const send = (method: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
    call(path, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json", "X-Aired-Request": "1", ...headers } });
  return { env, r2: r2.m, call, send };
}

const owner = { "X-Test-User": "7" };
const stranger = { "X-Test-User": "8" };

/** Every string anyone but the owner can get for a page, joined. */
async function publicSurfaces(s: ReturnType<typeof setup>, id: string): Promise<string> {
  const out: string[] = [];
  out.push(s.r2.get(`pages/${id}/index.html`) ?? "");
  for (const [path, headers] of [
    [`/p/${id}`, {}],
    [`/p/${id}`, stranger],
    [`/api/pages/${id}`, {}],
    [`/p/${id}/presenter`, {}],
    [`/p/${id}/presenter`, stranger],
    [`/api/pages/${id}/source`, {}],
    [`/api/pages/${id}/source`, stranger],
    [`/api/pages/${id}/details`, stranger],
  ] as const) {
    out.push(await (await s.call(path, { headers })).text());
  }
  return out.join("\n");
}

test("a Markdown deck's notes: in the owner's source and speaker view, nowhere public", async () => {
  const s = setup();
  const res = await s.send("POST", "/api/publish", { markdown: DECK_MD }, owner);
  assert.equal(res.status, 200);
  const pub = (await res.json()) as Record<string, unknown>;
  assert.equal(pub.kind, "deck");
  assert.equal(pub.slides, 3);
  assert.equal(pub.slides_with_notes, 2);
  assert.equal(pub.presenter_url, `https://aired.sh/p/${pub.id}/presenter`);
  assert.ok(!JSON.stringify(pub).includes("NOTE-"), "the publish answer has no notes");
  const id = String(pub.id);

  const seen = await publicSurfaces(s, id);
  assert.ok(!seen.includes(NOTE_A) && !seen.includes(NOTE_B), "no note on any public surface");

  // The viewer serves the deck, with its viewer script.
  const page = await s.call(`/p/${id}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<section class="slide lead"/);
  assert.match(html, /id="aired-deck-js"/);
  assert.match(page.headers.get("Content-Security-Policy") ?? "", /sandbox allow-scripts/);

  // The owner: source and notes, and the speaker view with both notes.
  const src = (await (await s.call(`/api/pages/${id}/source`, { headers: owner })).json()) as Record<string, unknown>;
  assert.equal(src.format, "markdown");
  assert.equal(src.source, DECK_MD);
  assert.deepEqual(src.notes, [NOTE_A, NOTE_B, ""]);
  const speaker = await s.call(`/p/${id}/presenter`, { headers: owner });
  assert.equal(speaker.status, 200);
  const view = await speaker.text();
  assert.ok(view.includes(NOTE_A) && view.includes(NOTE_B));
  assert.equal(speaker.headers.get("Cache-Control"), "private, no-store");
  assert.match(speaker.headers.get("Content-Security-Policy") ?? "", /frame-ancestors 'none'/);
  assert.match(speaker.headers.get("Content-Security-Policy") ?? "", /script-src 'nonce-[A-Za-z0-9]+'/);
  assert.equal(speaker.headers.get("X-Robots-Tag"), "noindex, nofollow");

  // details say it's a deck, to the owner.
  const details = (await (await s.call(`/api/pages/${id}/details`, { headers: owner })).json()) as Record<string, unknown>;
  assert.equal(details.kind, "deck");
  assert.equal(details.slides, 3);
});

test("an HTML deck's notes are cut from the page and kept for the owner", async () => {
  const s = setup();
  const pub = (await (await s.send("POST", "/api/publish", { html: DECK_HTML }, owner)).json()) as Record<string, unknown>;
  assert.equal(pub.kind, "deck");
  assert.equal(pub.slides, 2);
  const id = String(pub.id);
  const seen = await publicSurfaces(s, id);
  assert.ok(!seen.includes(NOTE_A) && !seen.includes(NOTE_B));
  assert.ok(!(s.r2.get(`pages/${id}/index.html`) ?? "").includes("aside"));
  const src = (await (await s.call(`/api/pages/${id}/source`, { headers: owner })).json()) as Record<string, unknown>;
  assert.equal(src.source, DECK_HTML);
  assert.deepEqual(src.notes, [NOTE_A, NOTE_B]);
});

test("the speaker view refuses everyone but the owner the same way, deck or not", async () => {
  const s = setup();
  const deck = String(((await (await s.send("POST", "/api/publish", { markdown: DECK_MD }, owner)).json()) as { id: string }).id);
  const plain = String(((await (await s.send("POST", "/api/publish", { html: "<h1>Plain</h1>" }, owner)).json()) as { id: string }).id);
  const anon = String(((await (await s.send("POST", "/api/publish", { markdown: DECK_MD })).json()) as { id: string }).id);
  const body = async (id: string, headers: Record<string, string>) => {
    const r = await s.call(`/p/${id}/presenter`, { headers });
    return { status: r.status, text: (await r.text()).replaceAll(id, "ID") };
  };
  const strangerDeck = await body(deck, stranger);
  assert.equal(strangerDeck.status, 403);
  assert.deepEqual(await body(plain, stranger), strangerDeck, "a stranger can't tell a deck from a page");
  const nobody = await body(deck, {});
  assert.equal(nobody.status, 403);
  assert.match(nobody.text, /\/auth\/login\?return=%2Fp%2FID%2Fpresenter/);
  // An anonymous deck has no owner to show notes to, so nobody gets them.
  for (const h of [{}, owner, stranger]) {
    const r = await body(anon, h);
    assert.equal(r.status, 403);
    assert.ok(!r.text.includes("NOTE-"));
  }
  // A missing page is a plain 404.
  assert.equal((await s.call("/p/nope123/presenter", { headers: owner })).status, 404);
  // The owner of a page that isn't a deck gets a message, not notes.
  const own = await s.call(`/p/${plain}/presenter`, { headers: owner });
  assert.equal(own.status, 200);
  assert.match(await own.text(), /isn't a slide deck/);
});

test("an anonymous deck's notes come back only with its update token", async () => {
  const s = setup();
  const pub = (await (await s.send("POST", "/api/publish", { markdown: DECK_MD })).json()) as Record<string, unknown>;
  const id = String(pub.id);
  const token = String(pub.update_token);
  assert.ok(!(await publicSurfaces(s, id)).includes("NOTE-"));
  const res = await s.call(`/api/pages/${id}/source`, { headers: { "X-Update-Token": token } });
  assert.equal(res.status, 200);
  assert.deepEqual(((await res.json()) as { notes: string[] }).notes, [NOTE_A, NOTE_B, ""]);
  const wrong = await s.call(`/api/pages/${id}/source`, { headers: { "X-Update-Token": "at_wrong" } });
  assert.equal(wrong.status, 403);
});

test("updating a deck with plain HTML drops its notes; deleting it removes them", async () => {
  const s = setup();
  const id = String(((await (await s.send("POST", "/api/publish", { markdown: DECK_MD }, owner)).json()) as { id: string }).id);
  assert.ok(s.r2.has(sidecarKey(id)));
  const upd = await s.send("PUT", `/api/pages/${id}`, { html: "<h1>Now a page</h1>" }, owner);
  assert.equal(upd.status, 200);
  assert.equal(((await upd.json()) as Record<string, unknown>).kind, undefined);
  assert.ok(!s.r2.has(sidecarKey(id)), "the old notes are gone");
  // Back to a deck, then delete.
  const again = (await (await s.send("PUT", `/api/pages/${id}`, { markdown: DECK_MD }, owner)).json()) as Record<string, unknown>;
  assert.equal(again.kind, "deck");
  assert.ok(s.r2.has(sidecarKey(id)));
  assert.equal((await s.call(`/api/pages/${id}`, { method: "DELETE", headers: { ...owner, "X-Aired-Request": "1" } })).status, 200);
  assert.ok(!s.r2.has(sidecarKey(id)) && !s.r2.has(`pages/${id}/index.html`));
});

test("Markdown docs publish, keep their source, and need html or markdown", async () => {
  const s = setup();
  const res = await s.send("POST", "/api/publish", { markdown: "# Weekly notes\n\n- [x] shipped\n\n<script>alert(1)</script>" }, owner);
  const pub = (await res.json()) as Record<string, unknown>;
  assert.equal(pub.kind, "doc");
  const id = String(pub.id);
  const stored = s.r2.get(`pages/${id}/index.html`) ?? "";
  assert.ok(!/<script/i.test(stored));
  assert.match(stored, /<title>Weekly notes<\/title>/);
  const details = (await (await s.call(`/api/pages/${id}/details`, { headers: owner })).json()) as Record<string, unknown>;
  assert.equal(details.title, "Weekly notes");
  assert.equal(details.kind, "doc");
  const src = (await (await s.call(`/api/pages/${id}/source`, { headers: owner })).json()) as Record<string, unknown>;
  assert.equal(src.format, "markdown");
  assert.match(String(src.source), /^# Weekly notes/);
  // Neither field: the same 400 as before.
  const none = await s.send("POST", "/api/publish", { title: "x" });
  assert.deepEqual(await none.json(), { error: { code: "invalid_input", message: "html is required and must be a string", field: "html" } });
  // A plain HTML page says nothing new.
  const plain = (await (await s.send("POST", "/api/publish", { html: "<h1>x</h1>" })).json()) as Record<string, unknown>;
  assert.equal(plain.kind, undefined);
});
