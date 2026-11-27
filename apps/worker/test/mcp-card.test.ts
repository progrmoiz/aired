import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { setup, type ToolAnswer } from "./helpers/hosted-mcp.ts";

const {
  CARD_FIELDS,
  CARD_META_KEY,
  CARD_MIME,
  CARD_TOKENS,
  CARD_TOOLS,
  CARD_URI,
  cardHtml,
} = await import("../src/lib/mcp-card.ts");
const { pageResult, updateResult } = await import("../src/lib/mcp-account.ts");
const { outputShapes } = await import("../src/lib/mcp-shapes.ts");

const read = (f: string) => readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8");
const ORIGIN = "https://aired.sh";
const kim = { "X-Test-User": "7" };
const page = (t: string) => `<!doctype html><html><head><title>${t}</title></head><body><h1>${t}</h1></body></html>`;
/** The MCP Apps extension, as a client that renders UI declares it. */
const UI_CLIENT = { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [CARD_MIME] } } };

/** A result as a plain client uses it: everything but `_meta`, which it never shows. */
const plain = (r: ToolAnswer) => {
  const { _meta, ...rest } = r;
  return rest;
};

// --- The resource ---------------------------------------------------------------

test("the card is a listed ui:// resource, served as MCP Apps HTML with a CSP that allows only aired images", async () => {
  const s = setup();
  const client = await s.mcpClient();
  const list = await client.listResources();
  const listed = list.resources.find((r) => r.uri === CARD_URI);
  assert.ok(listed, "resources/list has the card");
  assert.match(CARD_URI, /^ui:\/\//);
  assert.equal(listed.mimeType, CARD_MIME);
  assert.equal(CARD_MIME, "text/html;profile=mcp-app");

  const res = await client.readResource({ uri: CARD_URI });
  assert.equal(res.contents.length, 1);
  const c = res.contents[0] as { uri: string; mimeType: string; text: string; _meta?: Record<string, any> };
  assert.equal(c.uri, CARD_URI);
  assert.equal(c.mimeType, CARD_MIME);
  assert.match(c.text, /^<!doctype html>/);
  assert.equal(c.text, cardHtml());
  // Images from aired only; no network calls, frames or other origins.
  assert.deepEqual(c._meta?.ui?.csp, { connectDomains: [], resourceDomains: [ORIGIN] });
  assert.equal(c._meta?.ui?.csp?.frameDomains, undefined);
  assert.deepEqual(c._meta?.ui?.permissions, { clipboardWrite: {} });
  assert.deepEqual(c._meta?.["openai/widgetCSP"], { connect_domains: [], resource_domains: [ORIGIN], redirect_domains: [ORIGIN] });
  await client.close();
});

test("the four page tools link to the card; no other tool does", async () => {
  const s = setup();
  for (const user of [undefined, 7]) {
    const client = await s.mcpClient(user);
    const { tools } = await client.listTools();
    for (const t of tools) {
      const linked = (CARD_TOOLS as readonly string[]).includes(t.name);
      const meta = (t._meta ?? {}) as Record<string, any>;
      if (linked) {
        assert.equal(meta.ui?.resourceUri, CARD_URI, `${t.name} _meta.ui.resourceUri`);
        assert.equal(meta["ui/resourceUri"], CARD_URI, `${t.name} flat key`);
        assert.equal(meta["openai/outputTemplate"], CARD_URI, `${t.name} ChatGPT template`);
      } else {
        assert.equal(meta.ui, undefined, `${t.name} has no card`);
        assert.equal(meta["openai/outputTemplate"], undefined, `${t.name} has no ChatGPT template`);
      }
    }
    assert.deepEqual(tools.filter((t) => (t._meta as any)?.ui?.resourceUri).map((t) => t.name).sort(), [...CARD_TOOLS].sort());
    await client.close();
  }
});

// --- What the card gets: no secrets ---------------------------------------------

test("the card's own data never carries a token, PIN, claim link or the page's source", async () => {
  const s = setup();
  const anon = await s.mcp(undefined, UI_CLIENT);
  const pub = await anon("publish_html", { html: page("Quarterly report"), pin: "482913" });
  assert.equal(pub.isError, undefined);
  const token = String(pub.structuredContent?.update_token);
  assert.match(token, /^at_/);
  assert.deepEqual(Object.keys(pub._meta ?? {}), [CARD_META_KEY]);
  assert.deepEqual(pub._meta?.[CARD_META_KEY], { action: "published", title: "Quarterly report", mine: false, origin: ORIGIN });
  const meta = JSON.stringify(pub._meta);
  for (const secret of [token, "482913", "claim", "update_token", "<h1>"]) assert.ok(!meta.includes(secret), `card _meta has ${secret}`);

  const id = String(pub.structuredContent?.id);
  const upd = await anon("publish_html", { id, update_token: token, html: page("Quarterly report v2") });
  assert.deepEqual(upd._meta?.[CARD_META_KEY], { action: "updated", title: "Quarterly report v2", mine: false, origin: ORIGIN });
  assert.ok(!JSON.stringify(upd._meta).includes(token));
});

test("the card's script reads only its named fields, sends nothing, and loads nothing from elsewhere", () => {
  const html = cardHtml();
  const script = /<script>([\s\S]*)<\/script>/.exec(html)![1]!;
  // It never names a secret field, so it can't show or pass one on.
  for (const name of ["update_token", "claim_url", "upgrade_url", "pin", "has_pin", "source_format", "notes", "presenter_url", "arguments", "toolInput"]) {
    // As a property (x.pin, x["pin"]); "pin" as the access mode's value is fine.
    assert.ok(!new RegExp(`(\\.|\\[["'])${name}\\b`).test(script), `the card's script reads ${name}`);
  }
  // And the only fields it reads (CARD_FIELDS, from structuredContent) are none of them. (`e.source` is the message event's sender.)
  for (const f of CARD_FIELDS) assert.ok(!["update_token", "claim_url", "upgrade_url", "pin", "has_pin", "source", "notes", "presenter_url"].includes(f), f);
  // No network: no fetch, XHR, sockets or beacons, and no external script, style or frame.
  assert.doesNotMatch(script, /\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|<iframe|@import/i);
  // tools/call from the card would act on the page; it only opens links and copies.
  assert.doesNotMatch(script, /"tools\/call"/);
});

// --- Plain clients see exactly what they saw before ------------------------------

test("plain clients: text and structuredContent are unchanged, whether or not the client renders UI", async () => {
  const s = setup();
  for (const caps of [{}, UI_CLIENT]) {
    const owner = await s.mcp(7, caps);
    const pub = await owner("publish_html", { html: page("Launch plan") });
    const id = String(pub.structuredContent?.id);
    assert.deepEqual(Object.keys(plain(pub)).sort(), ["content", "structuredContent"]);
    assert.deepEqual(Object.keys(pub.structuredContent!).sort(), Object.keys(outputShapes.publish_html).filter((k) => k in pub.structuredContent!).sort());
    assert.deepEqual(pub._meta?.[CARD_META_KEY], { action: "published", title: "Launch plan", mine: true, origin: ORIGIN });

    // get_page and update_page: the same answer the result builders gave before the card existed.
    const details = await s.get(`/api/pages/${id}/details`, kim);
    const got = await owner("get_page", { id });
    assert.deepEqual(plain(got), pageResult(details.body, ORIGIN));
    assert.deepEqual(got._meta?.[CARD_META_KEY], { action: "page", title: "Launch plan", mine: true, origin: ORIGIN });

    const upd = await owner("update_page", { id, html: page("Launch plan, final") });
    const api = await s.send("PUT", `/api/pages/${id}`, { html: page("Launch plan, final") }, kim);
    assert.deepEqual(plain(upd).content[0]!.text.split("\n")[0], updateResult({ ...api.body }).content[0]!.text.split("\n")[0]);
    assert.deepEqual(Object.keys(plain(upd)).sort(), ["content", "structuredContent"]);
    assert.deepEqual(upd._meta?.[CARD_META_KEY], { action: "updated", title: "Launch plan, final", mine: true, origin: ORIGIN });

    const restored = await owner("restore_version", { id, version: 1 });
    assert.equal(restored.isError, undefined);
    assert.deepEqual(Object.keys(plain(restored)).sort(), ["content", "structuredContent"]);
    assert.match(restored.content[0]!.text, /Restored version 1/);
    assert.deepEqual(restored._meta?.[CARD_META_KEY], { action: "restored", title: null, mine: true, origin: ORIGIN });
  }
});

test("errors and tools without a card get no card data", async () => {
  const s = setup();
  const anon = await s.mcp(undefined, UI_CLIENT);
  const bad = await anon("get_page", { id: "nope123456", update_token: "at_x" });
  assert.equal(bad.isError, true);
  assert.equal(bad._meta, undefined);
  const missing = await anon("publish_html", {});
  assert.equal(missing.isError, true);
  assert.equal(missing._meta, undefined);
  const owner = await s.mcp(7, UI_CLIENT);
  const pub = await owner("publish_html", { html: page("Kept") });
  const versions = await owner("list_versions", { id: String(pub.structuredContent?.id) });
  assert.equal(versions._meta, undefined);
  // A token holder who isn't signed in isn't offered the owner's buttons.
  const tokenPage = await anon("publish_html", { html: page("Anon") });
  const viaToken = await anon("get_page", { id: String(tokenPage.structuredContent?.id), update_token: String(tokenPage.structuredContent?.update_token) });
  assert.equal(viaToken._meta?.[CARD_META_KEY]?.mine, false);
});

// --- The card itself, in a small browser -----------------------------------------

/** The card in a browser, its host stood in for: what it posts, and a way to send it messages. */
function openCard(opts: { prefersLight?: boolean } = {}) {
  const window = new Window({ url: "https://card.sandbox.test/", width: 600, height: 400 });
  const doc = window.document;
  const html = cardHtml();
  const script = /<script>([\s\S]*)<\/script>/.exec(html)![1]!;
  doc.write(html.replace(/<script>[\s\S]*<\/script>/, ""));
  const sent: Array<Record<string, any>> = [];
  // postMessage hands over a copy (structured clone), not the card's own objects.
  const host = { postMessage: (m: Record<string, any>) => sent.push(JSON.parse(JSON.stringify(m))) };
  Object.defineProperty(window, "parent", { value: host, configurable: true });
  if (opts.prefersLight !== undefined) {
    (window as any).matchMedia = (q: string) => ({ matches: q.includes("light") ? opts.prefersLight : !opts.prefersLight, addEventListener() {} });
  }
  window.eval(script);
  const send = (data: unknown) => window.dispatchEvent(new window.MessageEvent("message", { data, source: host as never }));
  /** Answers the card's ui/initialize as a host would. */
  const init = async (hostContext: Record<string, unknown> = { theme: "dark" }) => {
    const req = sent.find((m) => m.method === "ui/initialize")!;
    send({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2026-01-26", hostInfo: { name: "test-host", version: "1" }, hostCapabilities: { openLinks: {} }, hostContext } });
    await new Promise((r) => setTimeout(r, 0));
    return req;
  };
  return { window, doc, sent, send, init };
}

const RESULT = (over: Record<string, unknown> = {}, card: Record<string, unknown> = {}) => ({
  content: [{ type: "text", text: "Published to https://aired.sh/p/abc123" }],
  structuredContent: { id: "abc123", url: "https://aired.sh/p/abc123", updated: false, update_token: "at_secretsecretsecret", expires_at: "2026-12-05T10:00:00.000Z", owner: null, claim_url: "https://aired.sh/claim#abc123.at_secretsecretsecret", upgrade_url: null, version: 1, ...over },
  _meta: { [CARD_META_KEY]: { action: "published", title: "Quarterly report", mine: false, origin: "https://aired.sh", ...card } },
});

test("the card: handshake, then the result drawn with its screenshot and buttons; never the token", async () => {
  const c = openCard();
  const init = await c.init();
  assert.equal(init.jsonrpc, "2.0");
  assert.equal(init.params.protocolVersion, "2026-01-26");
  assert.ok(c.sent.some((m) => m.method === "ui/notifications/initialized"));

  c.send({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: RESULT() });
  const card = c.doc.querySelector("article.card");
  assert.ok(card, "draws the card");
  assert.equal(c.doc.querySelector("h1")!.textContent, "Quarterly report");
  assert.equal(c.doc.querySelector(".url")!.textContent, "aired.sh/p/abc123");
  assert.equal(c.doc.querySelector(".shot img")!.getAttribute("src"), "https://aired.sh/og/abc123?card=1");
  assert.match(c.doc.querySelector(".eyebrow")!.textContent!, /Published/);
  const buttons = [...c.doc.querySelectorAll(".actions button")].map((b) => b.getAttribute("aria-label"));
  assert.deepEqual(buttons, ["Copy link", "Open"], "an anonymous page has no owner buttons");
  // Link-preview layout: the screenshot fills a full-width frame above the title.
  const shot = c.doc.querySelector("article.card > button.shot");
  assert.ok(shot && shot.nextElementSibling?.classList.contains("foot"), "screenshot on top, details under it");
  const style = c.doc.querySelector("style")!.textContent!;
  assert.match(style, /\.shot img\{[^}]*object-fit:cover/, "the screenshot covers its frame");
  assert.match(c.doc.querySelector(".facts")!.textContent!, /Expires/);
  // Nothing secret anywhere in what it drew.
  const drawn = c.doc.documentElement.outerHTML;
  assert.ok(!drawn.includes("at_secret") && !drawn.includes("claim"), "the token and claim link stay out of the card");

  // Open goes through the host.
  (c.doc.querySelector(".actions button.primary") as unknown as { click(): void }).click();
  const open = c.sent.find((m) => m.method === "ui/open-link");
  assert.deepEqual(open?.params, { url: "https://aired.sh/p/abc123" });
  // The card tells the host its height.
  assert.ok(c.sent.some((m) => m.method === "ui/notifications/size-changed" && typeof m.params.height === "number"));
  await c.window.happyDOM.close();
});

test("the card: the owner gets Views and Sharing, which open the dashboard", async () => {
  const c = openCard();
  await c.init();
  c.send({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: RESULT({ owner: "kim", update_token: null, claim_url: null }, { mine: true }),
  });
  const buttons = [...c.doc.querySelectorAll(".actions button")];
  assert.deepEqual(buttons.map((b) => b.getAttribute("aria-label")), ["Views", "Sharing", "Copy link", "Open"]);
  // Icon buttons say what they do to screen readers and on hover.
  for (const b of buttons.slice(0, 3)) assert.equal(b.getAttribute("title"), b.getAttribute("aria-label"));
  (buttons[0] as unknown as { click(): void }).click();
  (buttons[1] as unknown as { click(): void }).click();
  const links = c.sent.filter((m) => m.method === "ui/open-link").map((m) => m.params.url);
  assert.deepEqual(links, ["https://aired.sh/dashboard#views/abc123", "https://aired.sh/dashboard#share/abc123"]);
  await c.window.happyDOM.close();
});

test("the card: get_page's views, access and expiry; a PIN page says so without the PIN", async () => {
  const c = openCard();
  c.send({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: {
      content: [{ type: "text", text: "Page" }],
      structuredContent: { id: "abc123", url: "https://aired.sh/p/abc123", title: "Board deck", size: 10, views: 12, view_limit: 50, has_pin: true, access: "pin", permanent: true, created_at: null, expires_at: null, project: null, kind: "deck", slides: 9 },
      _meta: { [CARD_META_KEY]: { action: "page", title: "Board deck", mine: true, origin: "https://aired.sh" } },
    },
  });
  const facts = [...c.doc.querySelectorAll(".facts li")].map((l) => l.textContent);
  assert.deepEqual(facts, ["12 views of 50", "PIN needed", "9 slides", "Never expires"]);
  // A deck's screenshot is cropped past the dark bars at its sides.
  assert.equal(c.doc.querySelector("article.card")!.getAttribute("data-kind"), "deck");
  assert.match(c.doc.querySelector("style")!.textContent!, /\.card\[data-kind="deck"\] \.shot img\{transform:scale\(/);
  await c.window.happyDOM.close();
});

test("the card: an error result draws nothing", async () => {
  const c = openCard();
  c.send({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { isError: true, content: [{ type: "text", text: "Page not found" }] } });
  assert.equal(c.doc.querySelector("article.card"), null);
  await c.window.happyDOM.close();
});

test("the card follows the host's theme: light is aired's Daylight, dark its Midnight", async () => {
  const c = openCard({ prefersLight: false });
  assert.equal(c.doc.documentElement.getAttribute("data-theme"), null, "dark by default");
  c.send({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { theme: "light" } });
  assert.equal(c.doc.documentElement.getAttribute("data-theme"), "daylight");
  c.send({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { theme: "dark" } });
  assert.equal(c.doc.documentElement.getAttribute("data-theme"), null);
  // The host's font, never its colours.
  c.send({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { styles: { variables: { "--font-sans": "Söhne, system-ui, sans-serif", "--color-background-primary": "red" } } } });
  assert.equal(c.doc.documentElement.style.getPropertyValue("--aired-font-sans"), "Söhne, system-ui, sans-serif");
  c.send({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { styles: { variables: { "--font-sans": "x;}body{display:none" } } } });
  assert.equal(c.doc.documentElement.style.getPropertyValue("--aired-font-sans"), "Söhne, system-ui, sans-serif", "a value that isn't a font list is ignored");
  await c.window.happyDOM.close();
  const light = openCard({ prefersLight: true });
  assert.equal(light.doc.documentElement.getAttribute("data-theme"), "daylight", "no host theme: the system's");
  await light.window.happyDOM.close();
});

test("ChatGPT: the card reads window.openai and opens links with openExternal", async () => {
  const window = new Window({ url: "https://card.sandbox.test/", width: 600, height: 400 });
  const doc = window.document;
  const html = cardHtml();
  doc.write(html.replace(/<script>[\s\S]*<\/script>/, ""));
  const opened: string[] = [];
  const r = RESULT();
  (window as any).openai = { theme: "light", toolOutput: r.structuredContent, toolResponseMetadata: r._meta, openExternal: ({ href }: { href: string }) => opened.push(href) };
  const sent: unknown[] = [];
  Object.defineProperty(window, "parent", { value: { postMessage: (m: unknown) => sent.push(m) }, configurable: true });
  window.eval(/<script>([\s\S]*)<\/script>/.exec(html)![1]!);
  assert.equal(doc.querySelector("h1")!.textContent, "Quarterly report");
  assert.equal(doc.documentElement.getAttribute("data-theme"), "daylight");
  (doc.querySelector(".actions button.primary") as unknown as { click(): void }).click();
  assert.deepEqual(opened, ["https://aired.sh/p/abc123"]);
  await window.happyDOM.close();
});

// --- Design tokens --------------------------------------------------------------

test("the card's colours are aired's tokens, Midnight and Daylight", () => {
  const css = read("packages/ui-tokens/tokens.css");
  const block = (sel: string) => css.slice(css.indexOf(sel), css.indexOf("}", css.indexOf(sel)));
  const value = (b: string, name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(b)?.[1]?.trim();
  const dark = block(":root {");
  const light = block(':root[data-theme="daylight"] {');
  for (const [name, v] of Object.entries(CARD_TOKENS.dark)) assert.equal(v, value(dark, name), `Midnight ${name}`);
  for (const [name, v] of Object.entries(CARD_TOKENS.light)) assert.equal(v, value(light, name) ?? value(dark, name), `Daylight ${name}`);
  for (const [name, v] of Object.entries(CARD_TOKENS.shared)) assert.equal(v, value(dark, name), `shared ${name}`);
  // No other colours in the card.
  const style = /<style>([\s\S]*?)<\/style>/.exec(cardHtml())![1]!;
  const stripped = style.replace(/--aired-[a-z0-9-]+:[^;}]+[;}]/g, "");
  assert.doesNotMatch(stripped, /#[0-9a-f]{3,8}\b|rgba?\(/i, "every colour is a token");
});

// --- The stdio server in the npm package ------------------------------------------

test("the stdio server registers the card and links publish_html, get_page and restore_version to it", () => {
  const stdio = read("apps/mcp/src/index.ts");
  assert.match(stdio, /registerCard\(server, apiBase\(\)\);/);
  for (const t of ["publish_html", "get_page", "restore_version"]) assert.ok(stdio.includes(`_meta: cardToolMeta("${t}")`), `stdio ${t}`);
  // update_page is hosted only: the stdio server updates through publish_html.
  assert.ok(!stdio.includes('registerTool(\n  "update_page"'));
});

test("the docs and skills describe the page card", () => {
  for (const f of ["apps/web/docs.html", "apps/web/llms.txt", "apps/web/llms-full.txt", "apps/cli/skills/aired/references/mcp.md"]) {
    const s = read(f);
    assert.ok(s.includes(CARD_URI), `${f} names the card`);
    for (const t of CARD_TOOLS) assert.ok(s.includes(t), `${f} names ${t}`);
  }
});
