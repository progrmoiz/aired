/**
 * The page card: an MCP Apps UI resource (the `io.modelcontextprotocol/ui`
 * extension, spec 2026-01-26) that chat apps which support it (Claude on the
 * web and desktop, ChatGPT, VS Code, Goose and others) draw inline under a
 * publish_html, get_page, update_page or restore_version call, instead of a
 * bare link. Clients without MCP Apps ignore all of it: tool `_meta` and
 * result `_meta` are never shown to the model, and the text and
 * structuredContent each tool returns are exactly what they were.
 *
 * One file for both servers, like mcp-shapes.ts: the hosted one
 * (routes/mcp.ts) and the stdio one in the npm package (apps/mcp). It has no
 * imports; the server passes itself in.
 *
 * What the card shows: the page's screenshot (GET /og/:id, the link-preview
 * image, never the page in a frame), its title and link, views, who can open
 * it and when it expires, and buttons to open it, copy the link and, for the
 * signed-in owner, see its views and change who can open it (both in the
 * dashboard). It never shows, stores or sends an update token or a PIN: the
 * script reads only the fields it names (CARD_FIELDS), and a test checks
 * the card's source never mentions the others.
 *
 * Security: the host runs the card in a sandboxed iframe on its own origin.
 * Its CSP allows images from the aired origin only, and no network calls
 * (connectDomains is empty), so the card can't send anything anywhere.
 */

/** The card's URI. The version is in the name: hosts cache UI resources, so a new card gets a new URI. */
export const CARD_URI = "ui://aired/page-card-v1.html";

/** The MCP Apps MIME type for an HTML UI resource. */
export const CARD_MIME = "text/html;profile=mcp-app";

/** The tools whose results the card draws. */
export const CARD_TOOLS = ["publish_html", "get_page", "update_page", "restore_version"] as const;
export type CardTool = (typeof CARD_TOOLS)[number];

/**
 * The fields the card reads from a tool result: structuredContent's, plus
 * the card's own `_meta` (cardResultMeta). Nothing else is read. There's no
 * token, claim link, PIN or source here, and there never should be.
 */
export const CARD_FIELDS = ["id", "url", "title", "views", "view_limit", "access", "permanent", "expires_at", "owner", "kind", "slides", "version", "restored_from", "updated"] as const;

/** The `_meta` key on a tool result with what the card needs that structuredContent lacks. */
export const CARD_META_KEY = "aired/card";

/** What a card says happened. */
export type CardAction = "published" | "updated" | "restored" | "page";

/** The card's own data on a tool result: title, whether the caller owns the page, and the aired origin. */
export type CardData = {
  action: CardAction;
  title: string | null;
  /** True when the caller is the signed-in owner: the card offers views and sharing in the dashboard. */
  mine: boolean;
  origin: string;
};

/** Tool `_meta` linking a tool to the card: the MCP Apps key, its older flat form, and ChatGPT's. */
export function cardToolMeta(tool: CardTool): Record<string, unknown> {
  const invoking: Record<CardTool, [string, string]> = {
    publish_html: ["Publishing…", "Published"],
    get_page: ["Opening the page…", "Page ready"],
    update_page: ["Updating…", "Updated"],
    restore_version: ["Restoring…", "Restored"],
  };
  return {
    ui: { resourceUri: CARD_URI },
    "ui/resourceUri": CARD_URI,
    "openai/outputTemplate": CARD_URI,
    "openai/toolInvocation/invoking": invoking[tool][0],
    "openai/toolInvocation/invoked": invoking[tool][1],
  };
}

/** The resource's `_meta`: what the card may load (images from aired, nothing else) and how hosts frame it. */
export function cardResourceMeta(origin: string): Record<string, unknown> {
  return {
    ui: {
      csp: { connectDomains: [], resourceDomains: [origin] },
      // Copy link. Hosts may refuse; the card then copies another way.
      permissions: { clipboardWrite: {} },
      prefersBorder: false,
    },
    // ChatGPT's older names; redirect_domains lets openExternal open aired links.
    "openai/widgetCSP": { connect_domains: [], resource_domains: [origin], redirect_domains: [origin] },
    "openai/widgetPrefersBorder": false,
    "openai/widgetDescription": "A card for an aired page: its screenshot, title and link, with buttons to open it and copy the link.",
  };
}

/** A tool result's `_meta` for the card. Only these four fields; never a token or a PIN. */
export function cardResultMeta(data: CardData): Record<string, unknown> {
  return { [CARD_META_KEY]: { action: data.action, title: data.title, mine: data.mine, origin: data.origin } };
}

/**
 * The title the card shows for a publish or update: the title sent, else
 * the content's own (an HTML <title>, Markdown front matter `title:` or its
 * first # heading). The API decides the stored title; this is only for the
 * card, so it stays cheap: no Markdown rendering.
 */
export function cardTitle(a: { title?: string | null; html?: string; markdown?: string }): string | null {
  const clean = (t: string | null | undefined) => {
    const v = (t ?? "").replace(/\s+/g, " ").trim();
    return v === "" ? null : Array.from(v).slice(0, 200).join("");
  };
  const given = clean(a.title);
  if (given !== null) return given;
  if (typeof a.markdown === "string") {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(a.markdown);
    const fmTitle = fm ? /^title:[ \t]*["']?(.*?)["']?[ \t]*$/m.exec(fm[1]!)?.[1] : undefined;
    return clean(fmTitle) ?? clean(/^#[ \t]+(.+?)[ \t#]*$/m.exec(fm ? a.markdown.slice(fm[0].length) : a.markdown)?.[1]);
  }
  if (typeof a.html === "string") return clean(/<title[^>]*>([^<]*)<\/title>/i.exec(a.html)?.[1]);
  return null;
}

/** Adds the card's `_meta` to a successful result. Errors stay as they are, so the card shows nothing for them. */
export function withCard<T extends object>(result: T, data: CardData): T {
  const r = result as T & { isError?: boolean; _meta?: Record<string, unknown> };
  if (r.isError === true) return result;
  return { ...result, _meta: { ...(r._meta ?? {}), ...cardResultMeta(data) } };
}

/**
 * Wraps a tool's handler so its successful results get the card's `_meta`
 * (text and structuredContent untouched). `card` says what happened, from
 * the call's arguments and its structuredContent.
 */
export function carded<A, R extends { isError?: boolean; structuredContent?: Record<string, unknown> }>(
  origin: string,
  run: (args: A) => Promise<R>,
  card: (args: A, out: Record<string, unknown>) => Omit<CardData, "origin">,
): (args: A) => Promise<R> {
  return async (args) => {
    const r = await run(args);
    return withCard(r, { ...card(args, r.structuredContent ?? {}), origin });
  };
}

/**
 * The aired tokens the card uses (packages/ui-tokens/tokens.css), Midnight
 * then Daylight. A test checks each value against tokens.css.
 */
export const CARD_TOKENS = {
  dark: {
    "--aired-surface": "#111113",
    "--aired-surface-2": "#18181b",
    "--aired-border": "#222225",
    "--aired-border-strong": "#34343a",
    "--aired-hairline": "rgba(255, 255, 255, 0.08)",
    "--aired-text-1": "#ededef",
    "--aired-text-2": "#a1a1a6",
    "--aired-text-3": "#84848a",
    "--aired-primary": "#ededef",
    "--aired-primary-hover": "#ffffff",
    "--aired-on-primary": "#0a0a0b",
    "--aired-mark": "#7c6aef",
    "--aired-ring": "#7c6aef",
    "--aired-ok": "#34d399",
    "--aired-chip-bg": "#18181b",
    "--aired-chip-text": "#a1a1a6",
    "--aired-radius-md": "8px",
    "--aired-radius-xl": "16px",
    "--aired-radius-full": "999px",
  },
  light: {
    "--aired-surface": "#ffffff",
    "--aired-surface-2": "#f1f1f3",
    "--aired-border": "#e4e4e7",
    "--aired-border-strong": "#d4d4d8",
    "--aired-hairline": "rgba(10, 10, 20, 0.08)",
    "--aired-text-1": "#111113",
    "--aired-text-2": "#52525b",
    "--aired-text-3": "#6b6b73",
    "--aired-primary": "#111113",
    "--aired-primary-hover": "#000000",
    "--aired-on-primary": "#ffffff",
    "--aired-mark": "#5b4bd0",
    "--aired-ring": "#5b4bd0",
    "--aired-ok": "#15803d",
    "--aired-chip-bg": "#f1f1f3",
    "--aired-chip-text": "#52525b",
    "--aired-radius-md": "8px",
    "--aired-radius-xl": "12px",
    "--aired-radius-full": "999px",
  },
  shared: {
    "--aired-font-sans": "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    "--aired-font-mono": "'JetBrains Mono', ui-monospace, Menlo, monospace",
    "--aired-text-xs": "12px",
    "--aired-text-sm": "13px",
    "--aired-text-md": "16px",
    "--aired-ease": "cubic-bezier(0.16, 1, 0.3, 1)",
    "--aired-dur-fast": "120ms",
  },
} as const;

const vars = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");

const STYLE = `
:root{${vars(CARD_TOKENS.shared)};${vars(CARD_TOKENS.dark)};color-scheme:dark}
:root[data-theme="daylight"]{${vars(CARD_TOKENS.light)};color-scheme:light}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:transparent}
body{font:400 var(--aired-text-sm)/1.45 var(--aired-font-sans);color:var(--aired-text-1);-webkit-font-smoothing:antialiased}
.card{display:grid;grid-template-columns:minmax(0,196px) minmax(0,1fr);gap:14px;align-items:start;padding:12px;background:var(--aired-surface);border:1px solid var(--aired-border);border-radius:var(--aired-radius-xl)}
@media (max-width:480px){.card{grid-template-columns:minmax(0,1fr)}}
.shot{display:block;position:relative;width:100%;height:0;padding:0 0 52.5%;margin:0;border-radius:var(--aired-radius-md);overflow:hidden;background:var(--aired-surface-2);border:1px solid var(--aired-hairline);cursor:pointer}
.shot img{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover;object-position:top}
.shot:focus-visible,button:focus-visible{outline:2px solid var(--aired-ring);outline-offset:2px}
.body{min-width:0;display:grid;gap:2px}
.eyebrow{display:flex;align-items:center;gap:6px;font-size:var(--aired-text-xs);color:var(--aired-text-3)}
.eyebrow svg{width:14px;height:14px;flex:none}
.eyebrow .ok{color:var(--aired-ok)}
h1{margin:2px 0 0;font-size:var(--aired-text-md);font-weight:500;letter-spacing:-0.01em;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.url{font-family:var(--aired-font-mono);font-size:var(--aired-text-xs);color:var(--aired-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.facts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;padding:0;list-style:none}
.facts li{font-size:var(--aired-text-xs);line-height:20px;padding:0 8px;border-radius:var(--aired-radius-full);background:var(--aired-chip-bg);color:var(--aired-chip-text);border:1px solid var(--aired-hairline);white-space:nowrap}
.actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
button{font:inherit;font-weight:500;height:30px;padding:0 10px;border-radius:var(--aired-radius-md);border:1px solid var(--aired-border-strong);background:var(--aired-surface-2);color:var(--aired-text-1);cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:background var(--aired-dur-fast) var(--aired-ease),border-color var(--aired-dur-fast) var(--aired-ease)}
button:hover{border-color:var(--aired-text-3)}
button.primary{background:var(--aired-primary);color:var(--aired-on-primary);border-color:transparent}
button.primary:hover{background:var(--aired-primary-hover)}
button svg{width:14px;height:14px;flex:none}
.empty{padding:12px;color:var(--aired-text-3);font-size:var(--aired-text-xs)}
@media (prefers-reduced-motion:reduce){button{transition:none}}
`;

/*
 * The script: a few lines of the MCP Apps bridge (JSON-RPC over postMessage
 * to the host), with ChatGPT's window.openai as a second source. It reads the
 * tool result, draws the card, follows the host's theme and reports its
 * height. Links open through the host (ui/open-link, or openExternal), which
 * may ask the person first.
 */
const SCRIPT = String.raw`
(function () {
  "use strict";
  var FIELDS = ${JSON.stringify(CARD_FIELDS)};
  var META = ${JSON.stringify(CARD_META_KEY)};
  var root = document.getElementById("root");
  var data = null;
  var hosted = false;
  var nextId = 1;
  var waiting = {};

  function post(msg) { try { window.parent.postMessage(msg, "*"); } catch (e) {} }
  function request(method, params) {
    var id = nextId++;
    post({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    return new Promise(function (resolve, reject) {
      waiting[id] = { resolve: resolve, reject: reject };
      setTimeout(function () { if (waiting[id]) { delete waiting[id]; reject(new Error("timeout")); } }, 8000);
    });
  }
  function notify(method, params) { post({ jsonrpc: "2.0", method: method, params: params || {} }); }

  // Only the named fields, from structuredContent and the card's _meta.
  function pick(structured, meta) {
    var s = structured && typeof structured === "object" ? structured : {};
    var m = meta && typeof meta === "object" && meta[META] && typeof meta[META] === "object" ? meta[META] : {};
    var out = {};
    for (var i = 0; i < FIELDS.length; i++) if (Object.prototype.hasOwnProperty.call(s, FIELDS[i])) out[FIELDS[i]] = s[FIELDS[i]];
    out.action = typeof m.action === "string" ? m.action : out.updated === true ? "updated" : "page";
    if (typeof m.title === "string" && m.title !== "" && (typeof out.title !== "string" || out.title === "")) out.title = m.title;
    out.mine = m.mine === true || (typeof out.owner === "string" && out.owner !== "");
    out.origin = typeof m.origin === "string" ? m.origin : "";
    return out;
  }

  function theme(t) {
    var light = t === "light" || (t !== "dark" && window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches);
    if (light) document.documentElement.setAttribute("data-theme", "daylight");
    else document.documentElement.removeAttribute("data-theme");
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  var ICON = {
    mark: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="9" cy="23" r="3.5" fill="currentColor"/><path d="M9 13A10 10 0 0 1 19 23M9 6A17 17 0 0 1 26 23" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
    open: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h4v4M13 3 7.5 8.5M12 9.5V13H3V4h3.5"/></svg>',
    copy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5V3A1.5 1.5 0 0 0 9 1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5"/></svg>',
    check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>',
    views: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2.5 13.5v-4M6.5 13.5v-7M10.5 13.5v-5M14 13.5v-9"/></svg>',
    share: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>'
  };

  // Through the host, which may ask the person first. A refusal is the person's answer: no other way round it.
  function openLink(url) {
    if (!/^https?:\/\//.test(url)) return;
    if (window.openai && typeof window.openai.openExternal === "function") { window.openai.openExternal({ href: url }); return; }
    if (hosted) { request("ui/open-link", { url: url }).catch(function () {}); return; }
    window.open(url, "_blank", "noopener");
  }

  function copy(text, button) {
    function done(ok) {
      var label = button.querySelector("span");
      var icon = button.querySelector("svg");
      label.textContent = ok ? "Copied" : "Press ⌘C to copy";
      if (ok) icon.outerHTML = ICON.check;
      setTimeout(function () { label.textContent = "Copy link"; var i = button.querySelector("svg"); if (i) i.outerHTML = ICON.copy; }, 1600);
    }
    function fallback() {
      var t = el("textarea", { "aria-hidden": "true", style: "position:fixed;opacity:0;top:0;left:0" });
      t.value = text;
      document.body.appendChild(t);
      t.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) {}
      t.remove();
      done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    else fallback();
  }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function day(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  }

  function facts(d) {
    var out = [];
    if (typeof d.views === "number") out.push(plural(d.views, "view", "views") + (typeof d.view_limit === "number" ? " of " + d.view_limit : ""));
    if (d.access === "pin") out.push("PIN needed");
    else if (d.access === "people") out.push("Only invited people");
    else if (d.access === "public") out.push("Anyone with the link");
    if (d.kind === "deck") out.push(plural(typeof d.slides === "number" ? d.slides : 0, "slide", "slides"));
    else if (d.kind === "doc") out.push("Doc");
    if (d.permanent === true || d.expires_at === null) out.push("Never expires");
    else if (typeof d.expires_at === "string" && day(d.expires_at)) out.push("Expires " + day(d.expires_at));
    if (typeof d.version === "number" && d.version > 1) out.push("Version " + d.version);
    return out;
  }

  var HEAD = { published: "Published", updated: "Updated", restored: "Restored", page: "Page" };

  function draw() {
    if (data === null || typeof data.url !== "string" || !/^https?:\/\//.test(data.url) || typeof data.id !== "string") return;
    var origin = data.origin || data.url.replace(/^(https?:\/\/[^/]+).*$/, "$1");
    var bare = data.url.replace(/^https?:\/\//, "");
    var title = typeof data.title === "string" && data.title !== "" ? data.title : bare;
    var shotUrl = origin + "/og/" + encodeURIComponent(data.id) + "?card=" + (typeof data.version === "number" ? data.version : 0);
    var head = HEAD[data.action] || "Page";
    if (data.action === "restored" && typeof data.restored_from === "number") head = "Restored version " + data.restored_from;

    var img = el("img", { src: shotUrl, alt: "", loading: "eager", decoding: "async" });
    // A new or changed page's screenshot is taken just after the call: look again once.
    if (data.action !== "page") setTimeout(function () { img.src = shotUrl + "&t=" + Date.now(); }, 7000);
    var actions = [
      el("button", { class: "primary", type: "button", onclick: function () { openLink(data.url); } }, [el("span", { html: ICON.open }).firstChild, el("span", { text: "Open" })]),
      el("button", { type: "button", onclick: function (e) { copy(data.url, e.currentTarget); } }, [el("span", { html: ICON.copy }).firstChild, el("span", { text: "Copy link" })])
    ];
    if (data.mine) {
      actions.push(el("button", { type: "button", onclick: function () { openLink(origin + "/dashboard#views/" + encodeURIComponent(data.id)); } }, [el("span", { html: ICON.views }).firstChild, el("span", { text: "Views" })]));
      actions.push(el("button", { type: "button", onclick: function () { openLink(origin + "/dashboard#share/" + encodeURIComponent(data.id)); } }, [el("span", { html: ICON.share }).firstChild, el("span", { text: "Sharing" })]));
    }
    var card = el("article", { class: "card", "aria-label": title }, [
      el("button", { class: "shot", type: "button", "aria-label": "Open " + title, onclick: function () { openLink(data.url); } }, [img]),
      el("div", { class: "body" }, [
        el("div", { class: "eyebrow" }, [el("span", { html: ICON.mark, style: "display:inline-flex;color:var(--aired-mark)" }), el("span", { text: "aired · " + head })]),
        el("h1", { text: title, title: title }),
        el("div", { class: "url", text: bare }),
        el("ul", { class: "facts" }, facts(data).map(function (f) { return el("li", { text: f }); })),
        el("div", { class: "actions" }, actions)
      ])
    ]);
    root.replaceChildren(card);
    size();
  }

  function size() {
    var h = Math.ceil(root.getBoundingClientRect().height);
    notify("ui/notifications/size-changed", { width: Math.ceil(window.innerWidth), height: h });
    if (window.openai && typeof window.openai.notifyIntrinsicHeight === "function") window.openai.notifyIntrinsicHeight(h);
  }
  if (window.ResizeObserver) new ResizeObserver(size).observe(document.documentElement);

  function fromResult(result) {
    if (!result || typeof result !== "object" || result.isError === true) return;
    data = pick(result.structuredContent, result._meta);
    draw();
  }

  // The host's theme, and its font so the card reads like the chat around it. Colours stay aired's.
  function context(ctx) {
    if (!ctx || typeof ctx !== "object") return;
    if (typeof ctx.theme === "string") theme(ctx.theme);
    var v = ctx.styles && ctx.styles.variables;
    if (v && typeof v["--font-sans"] === "string" && /^[^;{}()<>\\]+$/.test(v["--font-sans"])) document.documentElement.style.setProperty("--aired-font-sans", v["--font-sans"]);
  }

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) return;
    var m = e.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.method === undefined && m.id !== undefined && waiting[m.id]) {
      var w = waiting[m.id];
      delete waiting[m.id];
      if (m.error) w.reject(m.error); else w.resolve(m.result);
      return;
    }
    if (m.method === "ui/notifications/tool-result") fromResult(m.params);
    else if (m.method === "ui/notifications/host-context-changed") context(m.params);
    else if (m.method === "ui/resource-teardown" && m.id !== undefined) post({ jsonrpc: "2.0", id: m.id, result: {} });
  });

  theme(null);

  // ChatGPT: the result is already on window.openai, and changes arrive as an event.
  function fromOpenAi() {
    var o = window.openai;
    if (!o) return;
    if (typeof o.theme === "string") theme(o.theme);
    if (o.toolOutput) { data = pick(o.toolOutput, o.toolResponseMetadata); draw(); }
  }
  window.addEventListener("openai:set_globals", fromOpenAi);
  fromOpenAi();

  // Every MCP Apps host, ChatGPT included, speaks this handshake; then it sends the tool's result.
  request("ui/initialize", {
    protocolVersion: "2026-01-26",
    appInfo: { name: "aired-page-card", version: "1" },
    appCapabilities: {}
  }).then(function (r) {
    hosted = true;
    context(r && r.hostContext);
    notify("ui/notifications/initialized", {});
  }, function () {});
})();
`;

/** The card's HTML: one file, no external script or style. */
export function cardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>aired page</title>
<style>${STYLE}</style>
</head>
<body>
<main id="root"></main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

/** The slice of McpServer the card needs, so this file imports nothing. */
type ResourceServer = {
  registerResource(
    name: string,
    uri: string,
    config: { title?: string; description?: string; mimeType?: string; _meta?: Record<string, unknown> },
    read: () => Promise<{ contents: Array<{ uri: string; mimeType: string; text: string; _meta?: Record<string, unknown> }> }>,
  ): unknown;
};

/** Registers the card as a resource. `origin` is the aired origin its screenshots come from. */
export function registerCard(server: ResourceServer, origin: string): void {
  const meta = cardResourceMeta(origin);
  server.registerResource(
    "page-card",
    CARD_URI,
    { title: "aired page card", description: "Shows a published aired page inline in chat apps that support MCP Apps.", mimeType: CARD_MIME, _meta: meta },
    async () => ({ contents: [{ uri: CARD_URI, mimeType: CARD_MIME, text: cardHtml(), _meta: meta }] }),
  );
}
