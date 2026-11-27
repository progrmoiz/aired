import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { frontMatterIsDeck, injectDeckRuntime, slideNotes, splitFrontMatter, splitSlides, takeComments, SLIDE_HEIGHT, SLIDE_WIDTH } from "./deck.ts";
import { DOC_TOKENS, tokenVars } from "./doc-tokens.ts";

/**
 * Markdown to a published page: a clean reading page (a "doc"), or a slide
 * deck when the front matter or the publisher asks for one (lib/deck.ts).
 *
 * Safety: raw HTML in the Markdown is never passed through. markdown-it runs
 * with `html: false`, so a <script>, <iframe>, <img onerror> or <style> shows
 * as text, and its link check drops javascript:, vbscript:, file: and
 * non-image data: URLs. The only scripts on the page are aired's own deck
 * viewer, and the page is still served in the same sandbox as any HTML
 * (middleware/security.ts). HTML comments are cut out before rendering: in a
 * deck they become speaker notes, in a doc they stay hidden.
 */

for (const [name, lang] of Object.entries({ bash, c, cpp, csharp, css, diff, go, java, javascript, json, kotlin, markdown, php, python, ruby, rust, shell, sql, swift, typescript, xml, yaml })) {
  hljs.registerLanguage(name, lang);
}
for (const [alias, name] of Object.entries({ js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", sh: "bash", zsh: "bash", py: "python", rb: "ruby", rs: "rust", html: "xml", svg: "xml", yml: "yaml", md: "markdown", cs: "csharp", kt: "kotlin", console: "shell" })) {
  hljs.registerAliases(alias, { languageName: name });
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** A heading's anchor id: lowercase words joined by dashes. */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 80) || "section"
  );
}

function highlight(code: string, lang: string): string {
  const name = lang.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (name !== "" && hljs.getLanguage(name)) {
    try {
      return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
    } catch {
      // Fall through to plain text.
    }
  }
  return escapeHtml(code);
}

/** `- [ ] todo` and `- [x] done` list items as (read-only) checkboxes. */
function taskLists(md: MarkdownIt): void {
  md.core.ruler.after("inline", "aired_tasks", (state) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i]!;
      if (inline.type !== "inline" || tokens[i - 1]!.type !== "paragraph_open" || tokens[i - 2]!.type !== "list_item_open") continue;
      const first = inline.children?.[0];
      const m = first?.type === "text" ? /^\[([ xX])\][  ]/.exec(first.content) : null;
      if (!first || m === null) continue;
      const done = m[1] !== " ";
      first.content = first.content.slice(m[0].length);
      const box = new state.Token("html_inline", "", 0);
      box.content = `<input type="checkbox" class="task" disabled${done ? " checked" : ""} aria-label="${done ? "Done" : "Not done"}"> `;
      inline.children!.unshift(box);
      tokens[i - 2]!.attrJoin("class", "task-item");
      // The list that holds it.
      for (let j = i - 3; j >= 0; j--) {
        const t = tokens[j]!;
        if ((t.type === "bullet_list_open" || t.type === "ordered_list_open") && t.level === tokens[i - 2]!.level - 1) {
          if (!(t.attrGet("class") ?? "").includes("task-list")) t.attrJoin("class", "task-list");
          break;
        }
      }
    }
  });
}

/** Ids on headings, unique within the page, so a section can be linked. */
function headingIds(md: MarkdownIt): void {
  md.core.ruler.push("aired_heading_ids", (state) => {
    const seen = new Map<string, number>();
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length - 1; i++) {
      if (tokens[i]!.type !== "heading_open") continue;
      const text = (tokens[i + 1]!.children ?? []).filter((t) => t.type === "text" || t.type === "code_inline").map((t) => t.content).join("");
      const base = slugify(text);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      tokens[i]!.attrSet("id", n === 0 ? base : `${base}-${n}`);
    }
  });
}

/** External links open in a new tab, without telling the other site where they came from. */
function externalLinks(md: MarkdownIt): void {
  const base = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const href = tokens[idx]!.attrGet("href") ?? "";
    if (/^https?:\/\//i.test(href)) {
      tokens[idx]!.attrSet("target", "_blank");
      tokens[idx]!.attrSet("rel", "noopener noreferrer");
    }
    return base(tokens, idx, options, env, self);
  };
}

/** Tables scroll sideways on a phone instead of breaking the page width. */
function tableWrap(md: MarkdownIt): void {
  md.renderer.rules.table_open = () => '<div class="table"><table>\n';
  md.renderer.rules.table_close = () => "</table></div>\n";
}

export function markdownRenderer(): MarkdownIt {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    highlight: (code, lang) => `<pre class="code"><code class="hljs${lang ? ` language-${escapeHtml(lang.split(/\s+/)[0]!)}` : ""}">${highlight(code, lang)}</code></pre>`,
  });
  md.use(taskLists).use(headingIds).use(externalLinks).use(tableWrap);
  return md;
}

const MD = markdownRenderer();

/** Markdown (no front matter) to HTML, with raw HTML shown as text. */
export function renderMarkdown(md: string): string {
  return MD.render(md);
}

/** The first `# heading` of some Markdown, as plain text. */
export function firstMarkdownHeading(md: string): string | null {
  const tokens = MD.parse(md, {});
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i]!.type === "heading_open" && tokens[i]!.tag === "h1") {
      const text = (tokens[i + 1]!.children ?? []).filter((t) => t.type === "text" || t.type === "code_inline").map((t) => t.content).join("").trim();
      if (text !== "") return text.slice(0, 200);
    }
  }
  return null;
}

/** Any heading's text, for a slide title. */
function anyHeading(md: string): string | null {
  const tokens = MD.parse(md, {});
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i]!.type === "heading_open") {
      const text = (tokens[i + 1]!.children ?? []).filter((t) => t.type === "text" || t.type === "code_inline").map((t) => t.content).join("").trim();
      if (text !== "") return text.slice(0, 200);
    }
  }
  return null;
}

export type Theme = "light" | "dark" | "auto";

function themeOf(value: string | undefined, fallback: Theme): Theme {
  const v = (value ?? "").toLowerCase();
  return v === "light" || v === "dark" || v === "auto" ? v : fallback;
}

export type RenderedMarkdown = {
  kind: "doc" | "deck";
  html: string;
  title: string | null;
  /** Deck only: one entry per slide, "" for none. */
  notes: string[];
  titles: Array<string | null>;
};

/**
 * Markdown to a full page. A deck when `deck` is true or the front matter
 * asks for one; a doc otherwise.
 */
export function renderMarkdownPage(source: string, opts: { deck?: boolean } = {}): RenderedMarkdown {
  const { data, body } = splitFrontMatter(source);
  const deck = opts.deck === true || frontMatterIsDeck(data);
  return deck ? renderDeck(body, data) : renderDoc(body, data);
}

function renderDoc(body: string, data: Record<string, string>): RenderedMarkdown {
  const { text } = takeComments(body);
  const title = data.title?.trim() || firstMarkdownHeading(text);
  const theme = themeOf(data.theme, "auto");
  const description = data.description?.trim();
  const html = `<!DOCTYPE html>
<html lang="${escapeHtml(data.lang?.trim() || "en")}"${theme === "auto" ? "" : ` data-theme="${theme}"`}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title ?? "Document")}</title>
${description ? `<meta name="description" content="${escapeHtml(description)}">\n` : ""}<meta name="generator" content="aired markdown">
<style>${docCss()}</style>
</head>
<body>
<main class="doc">
${renderMarkdown(text)}</main>
</body>
</html>
`;
  return { kind: "doc", html, title, notes: [], titles: [] };
}

function renderDeck(body: string, data: Record<string, string>): RenderedMarkdown {
  const slides = splitSlides(body);
  const parts = slides.map(slideNotes).filter((s) => s.body !== "" || s.notes !== "");
  if (parts.length === 0) parts.push({ body: "", notes: "" });
  const title = data.title?.trim() || parts.map((p) => firstMarkdownHeading(p.body)).find((t) => t !== null) || null;
  const theme = themeOf(data.theme, "light");
  const sections = parts
    .map((p, i) => {
      // A slide that opens with a single # heading is a title slide: centred, bigger.
      const lead = /^#\s/.test(p.body.trimStart());
      return `<section class="slide${lead ? " lead" : ""}" aria-label="Slide ${i + 1}">\n${renderMarkdown(p.body)}<span class="num" aria-hidden="true">${i + 1}</span>\n</section>`;
    })
    .join("\n");
  const html = `<!DOCTYPE html>
<html lang="${escapeHtml(data.lang?.trim() || "en")}" data-theme="${theme === "auto" ? "light" : theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="aired" content="deck">
<title>${escapeHtml(title ?? "Slides")}</title>
<meta name="generator" content="aired markdown">
<style>${deckCss()}</style>
</head>
<body>
<main class="deck">
${sections}
</main>
</body>
</html>
`;
  return {
    kind: "deck",
    html: injectDeckRuntime(html),
    title,
    notes: parts.map((p) => p.notes),
    titles: parts.map((p) => anyHeading(p.body)),
  };
}

/** Colours for highlighted code, light and dark. Content colours, not aired's own chrome. */
const CODE_LIGHT = `--k:#cf222e;--s:#0a3069;--n:#0550ae;--c:#6e7781;--t:#8250df;--b:#953800;--add:#dafbe1;--del:#ffebe9`;
const CODE_DARK = `--k:#ff7b72;--s:#a5d6ff;--n:#79c0ff;--c:#8b949e;--t:#d2a8ff;--b:#ffa657;--add:rgba(46,160,67,.18);--del:rgba(248,81,73,.18)`;

const HLJS_CSS = `
.hljs-keyword,.hljs-selector-tag,.hljs-meta .hljs-keyword,.hljs-doctag,.hljs-template-tag{color:var(--k)}
.hljs-string,.hljs-regexp,.hljs-meta .hljs-string,.hljs-char.escape_{color:var(--s)}
.hljs-number,.hljs-literal,.hljs-attr,.hljs-attribute,.hljs-variable,.hljs-template-variable,.hljs-selector-attr,.hljs-selector-class,.hljs-selector-id,.hljs-property{color:var(--n)}
.hljs-comment,.hljs-quote,.hljs-meta{color:var(--c)}
.hljs-title,.hljs-title.function_,.hljs-title.class_,.hljs-section,.hljs-name,.hljs-tag{color:var(--t)}
.hljs-built_in,.hljs-type,.hljs-symbol,.hljs-bullet,.hljs-params{color:var(--b)}
.hljs-addition{background:var(--add)}.hljs-deletion{background:var(--del)}
.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:600}`;

/** The doc page's CSS: aired's type and colours (packages/ui-tokens), light and dark. */
export function docCss(): string {
  const light = tokenVars(DOC_TOKENS.light);
  const dark = tokenVars(DOC_TOKENS.dark);
  return `
:root{${light};${CODE_LIGHT};color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${dark};${CODE_DARK};color-scheme:dark}}
:root[data-theme="dark"]{${dark};${CODE_DARK};color-scheme:dark}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--aired-bg);color:var(--aired-text-1);font-family:var(--aired-font-sans);font-size:var(--aired-text-md);line-height:1.7;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.doc{max-width:720px;margin:0 auto;padding:64px 24px 120px;overflow-wrap:break-word}
.doc>:first-child{margin-top:0}
h1,h2,h3,h4,h5,h6{font-weight:var(--aired-weight-medium);line-height:1.25;letter-spacing:var(--aired-tracking-tight);margin:2em 0 .6em;scroll-margin-top:24px;text-wrap:balance}
h1{font-size:var(--aired-text-3xl);margin-top:0}
h2{font-size:var(--aired-text-2xl);padding-top:.4em}
h3{font-size:var(--aired-text-xl)}
h4{font-size:var(--aired-text-lg)}
h5,h6{font-size:var(--aired-text-md);color:var(--aired-text-2)}
h1+p{font-size:var(--aired-text-lg);color:var(--aired-text-2)}
p,ul,ol,blockquote,pre,.table,dl{margin:0 0 1.15em}
a{color:inherit;text-decoration:underline;text-decoration-color:var(--aired-hairline-strong);text-underline-offset:3px}
a:hover{text-decoration-color:currentColor}
strong{font-weight:600}
ul,ol{padding-left:1.4em}
li{margin:.3em 0}
li>ul,li>ol{margin:.3em 0 0}
li::marker{color:var(--aired-text-3)}
ul.task-list{list-style:none;padding-left:.2em}
li.task-item{display:flex;gap:.6em;align-items:baseline}
li.task-item>p{margin:0}
input.task{appearance:none;-webkit-appearance:none;flex:none;width:1.05em;height:1.05em;margin:0;border:1.5px solid var(--aired-border-strong);border-radius:4px;transform:translateY(.15em);display:inline-grid;place-content:center;background:var(--aired-surface)}
input.task:checked{background:var(--aired-text-1);border-color:var(--aired-text-1)}
input.task:checked::after{content:"";width:.55em;height:.3em;border:2px solid var(--aired-bg);border-top:0;border-right:0;transform:translateY(-.08em) rotate(-45deg)}
blockquote{margin-left:0;padding:.2em 0 .2em 1.1em;border-left:3px solid var(--aired-border-strong);color:var(--aired-text-2)}
blockquote>:last-child{margin-bottom:0}
hr{border:0;border-top:1px solid var(--aired-border);margin:2.5em 0}
img{max-width:100%;height:auto;border-radius:var(--aired-radius-md)}
code{font-family:var(--aired-font-mono);font-size:.88em;background:var(--aired-surface-2);border:1px solid var(--aired-hairline);border-radius:5px;padding:.1em .35em}
pre.code{background:var(--aired-code-bg);border:1px solid var(--aired-border);border-radius:var(--aired-radius-lg);padding:16px 18px;overflow-x:auto;line-height:1.55;font-size:14px}
pre.code code{background:none;border:0;padding:0;font-size:inherit;color:var(--aired-text-1)}
.table{overflow-x:auto;border:1px solid var(--aired-border);border-radius:var(--aired-radius-lg)}
table{border-collapse:collapse;width:100%;font-size:15px;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--aired-border);vertical-align:top}
th{font-weight:var(--aired-weight-medium);color:var(--aired-text-2);background:var(--aired-surface-2);font-size:13px;white-space:nowrap}
tr:last-child td{border-bottom:0}
td[style*="right"],th[style*="right"]{text-align:right}
mark{background:var(--aired-warn-bg);color:inherit;padding:0 .15em;border-radius:3px}
::selection{background:var(--aired-hairline-strong)}
@media (max-width:600px){.doc{padding:40px 18px 96px}h1{font-size:28px}h2{font-size:22px}}
@media print{body{background:#fff;color:#000}.doc{padding:0;max-width:none}a{text-decoration:none}pre.code,.table{break-inside:avoid}#__aired-bar{display:none!important}}
${HLJS_CSS}`;
}

/** A Markdown deck's slide styles: big type, one idea per slide. */
export function deckCss(): string {
  const light = tokenVars(DOC_TOKENS.light);
  const dark = tokenVars(DOC_TOKENS.dark);
  return `
:root{${light};${CODE_LIGHT};color-scheme:light}
:root[data-theme="dark"]{${dark};${CODE_DARK};color-scheme:dark}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--aired-bg);color:var(--aired-text-1);font-family:var(--aired-font-sans);-webkit-font-smoothing:antialiased}
.slide{width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;padding:72px 96px 64px;display:flex;flex-direction:column;justify-content:flex-start;background:var(--aired-surface);color:var(--aired-text-1);font-size:30px;line-height:1.45;position:relative;overflow:hidden}
.slide>:first-child{margin-top:0}
.slide h1,.slide h2,.slide h3{font-weight:var(--aired-weight-medium);letter-spacing:var(--aired-tracking-tight);line-height:1.12;margin:0 0 .55em;text-wrap:balance}
.slide h1{font-size:76px}
.slide h2{font-size:52px}
.slide h3{font-size:38px}
.slide p,.slide ul,.slide ol,.slide blockquote,.slide pre,.slide .table{margin:0 0 .7em}
.slide ul,.slide ol{padding-left:1.15em}
.slide li{margin:.25em 0}
.slide li::marker{color:var(--aired-text-3)}
.slide strong{font-weight:600}
.slide a{color:inherit;text-underline-offset:5px;text-decoration-color:var(--aired-hairline-strong)}
.slide blockquote{border-left:4px solid var(--aired-border-strong);padding-left:.8em;color:var(--aired-text-2);margin-left:0}
.slide img{max-width:100%;max-height:440px;object-fit:contain;border-radius:var(--aired-radius-lg)}
.slide p:has(>img:only-child){flex:1;display:flex;align-items:center;justify-content:center;min-height:0}
.slide code{font-family:var(--aired-font-mono);font-size:.85em;background:var(--aired-surface-2);border-radius:6px;padding:.08em .3em}
.slide pre.code{background:var(--aired-code-bg);border:1px solid var(--aired-border);border-radius:var(--aired-radius-lg);padding:22px 26px;font-size:22px;line-height:1.5;overflow:hidden}
.slide pre.code code{background:none;padding:0;font-size:inherit}
.slide .table{border:1px solid var(--aired-border);border-radius:var(--aired-radius-lg);overflow:hidden}
.slide table{border-collapse:collapse;width:100%;font-size:24px;font-variant-numeric:tabular-nums}
.slide th,.slide td{text-align:left;padding:12px 18px;border-bottom:1px solid var(--aired-border)}
.slide th{font-weight:var(--aired-weight-medium);color:var(--aired-text-2);background:var(--aired-surface-2);font-size:20px}
.slide tr:last-child td{border-bottom:0}
.slide ul.task-list{list-style:none;padding-left:0}
.slide li.task-item{display:flex;gap:.5em;align-items:baseline}
.slide li.task-item>p{margin:0}
.slide input.task{appearance:none;-webkit-appearance:none;flex:none;width:.8em;height:.8em;margin:0;border:3px solid var(--aired-border-strong);border-radius:6px;transform:translateY(.1em);display:inline-grid;place-content:center}
.slide input.task:checked{background:var(--aired-text-1);border-color:var(--aired-text-1)}
.slide input.task:checked::after{content:"";width:.4em;height:.22em;border:3px solid var(--aired-surface);border-top:0;border-right:0;transform:translateY(-.06em) rotate(-45deg)}
.slide.lead{justify-content:center}
.slide.lead h1{font-size:88px;margin-bottom:.3em}
.slide.lead h1+p,.slide.lead h2{font-size:34px;font-weight:400;color:var(--aired-text-2);letter-spacing:0}
.slide .num{position:absolute;right:40px;bottom:28px;font-size:16px;color:var(--aired-text-3);font-variant-numeric:tabular-nums}
.slide.lead .num{display:none}
${HLJS_CSS}`;
}
