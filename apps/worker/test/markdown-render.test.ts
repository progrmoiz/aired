import "./helpers/ts-resolve.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { renderMarkdownPage, slugify } = await import("../src/lib/doc-render.ts");
const { DOC_TOKENS } = await import("../src/lib/doc-tokens.ts");

/** The page's body content, between <main> and </main>. */
const main = (html: string) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));
/** Every <script> in a page. */
const scripts = (html: string) => [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);

test("raw HTML in Markdown is shown as text, never run", () => {
  const attacks = [
    "<script>alert(1)</script>",
    '<img src=x onerror="alert(1)">',
    '<iframe src="https://evil.example"></iframe>',
    "<style>body{display:none}</style>",
    '<a href="javascript:alert(1)">x</a>',
    '<svg onload="alert(1)"></svg>',
    '<div onclick="alert(1)">click</div>',
    "<object data=x></object><embed src=x>",
    '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    "<base href=https://evil.example/>",
  ];
  for (const a of attacks) {
    const { html } = renderMarkdownPage(`# Doc\n\n${a}\n\ninline ${a} too`);
    const body = main(html);
    assert.doesNotMatch(body, /<(script|img|iframe|style|svg|object|embed|meta|base)\b/i, a);
    assert.doesNotMatch(body, /<[a-z]+[^>]*\son[a-z]+=/i, a);
    assert.doesNotMatch(body, /href="javascript:/i, a);
    assert.ok(body.includes("&lt;"), `${a} shows as text`);
  }
  // A doc has no scripts at all.
  assert.deepEqual(scripts(renderMarkdownPage("# Hi\n\n<script>x()</script>").html), []);
});

test("dangerous link and image URLs are dropped; web, mail and image data URLs stay", () => {
  const md = [
    "[a](javascript:alert(1)) [b](JAVASCRIPT:alert(1)) [c](vbscript:x) [d](data:text/html,<script>x</script>) [e](file:///etc/passwd)",
    "![i](javascript:alert(1)) ![j](data:text/html;base64,PHNjcmlwdD4=)",
    "[ok](https://example.com) [mail](mailto:a@example.com) [rel](/p/abc#/2) ![png](data:image/png;base64,iVBORw0KGgo=)",
  ].join("\n\n");
  const body = main(renderMarkdownPage(md).html);
  for (const bad of ["javascript:", "JAVASCRIPT:", "vbscript:", "data:text/html", "file:"]) {
    assert.doesNotMatch(body, new RegExp(`(href|src)="${bad}`, "i"), bad);
  }
  assert.match(body, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">ok<\/a>/);
  assert.match(body, /<a href="mailto:a@example\.com">mail<\/a>/);
  assert.match(body, /<a href="\/p\/abc#\/2">rel<\/a>/);
  assert.match(body, /<img src="data:image\/png;base64,iVBORw0KGgo=" alt="png">/);
});

test("HTML comments are hidden in a doc, not shown as text", () => {
  const body = main(renderMarkdownPage("# Doc\n\nBefore <!-- hidden one --> after\n\n<!--\nhidden\ntwo\n-->\n\nEnd").html);
  assert.ok(!body.includes("hidden"));
  assert.ok(!body.includes("&lt;!--"));
  assert.match(body, /Before\s+after/);
  // Inside a code block a comment is code, and stays.
  assert.ok(main(renderMarkdownPage("```html\n<!-- keep -->\n```").html).includes("&lt;!-- keep --&gt;"));
});

test("tables, task lists, highlighted code and heading anchors", () => {
  const md = [
    "# Report",
    "## Key numbers",
    "| Metric | Value |",
    "| --- | ---: |",
    "| Visits | 1,200 |",
    "",
    "- [x] Done thing",
    "- [ ] Open thing",
    "- plain item",
    "",
    "```ts",
    "const total: number = 42; // the answer",
    "```",
    "",
    "## Key numbers",
  ].join("\n");
  const body = main(renderMarkdownPage(md).html);
  assert.match(body, /<div class="table"><table>/);
  assert.match(body, /<td style="text-align:right">1,200<\/td>/);
  assert.match(body, /<ul class="task-list">/);
  assert.match(body, /<li class="task-item"><input type="checkbox" class="task" disabled checked aria-label="Done"> Done thing<\/li>/);
  assert.match(body, /<li class="task-item"><input type="checkbox" class="task" disabled aria-label="Not done"> Open thing<\/li>/);
  assert.match(body, /<li>plain item<\/li>/);
  assert.match(body, /<pre class="code"><code class="hljs language-ts"><span class="hljs-keyword">const<\/span>/);
  assert.match(body, /<span class="hljs-comment">\/\/ the answer<\/span>/);
  // Unique ids, so each section can be linked to.
  assert.match(body, /<h2 id="key-numbers">/);
  assert.match(body, /<h2 id="key-numbers-1">/);
  // An unknown language is plain, escaped text.
  assert.match(main(renderMarkdownPage("```nope\n<b>&\n```").html), /<code class="hljs language-nope">&lt;b&gt;&amp;/);
  assert.equal(slugify("Café & Crème: 2026!"), "cafe-creme-2026");
});

test("title: front matter, else the first # heading; the page is phone-ready and themed", () => {
  const fm = renderMarkdownPage("---\ntitle: \"From front matter\"\ndescription: A short summary\n---\n# Heading");
  assert.equal(fm.kind, "doc");
  assert.equal(fm.title, "From front matter");
  assert.match(fm.html, /<title>From front matter<\/title>/);
  assert.match(fm.html, /<meta name="description" content="A short summary">/);
  const h = renderMarkdownPage("Intro\n\n# The <b>real</b> title");
  assert.equal(h.title, "The <b>real</b> title");
  assert.match(h.html, /<title>The &lt;b&gt;real&lt;\/b&gt; title<\/title>/);
  assert.equal(renderMarkdownPage("no headings").title, null);
  assert.match(fm.html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  // Light by default, dark when the reader's system is, or when the front matter says so.
  assert.match(fm.html, /@media \(prefers-color-scheme:dark\)/);
  assert.match(renderMarkdownPage("---\ntheme: dark\n---\nx").html, /<html lang="en" data-theme="dark">/);
  // A front-matter title can't break out of the tag.
  assert.match(renderMarkdownPage('---\ntitle: </title><script>x</script>\n---\nx').html, /<title>&lt;\/title&gt;&lt;script&gt;x&lt;\/script&gt;<\/title>/);
});

test("the doc page's colours and type are aired's tokens (packages/ui-tokens)", () => {
  const css = readFileSync(new URL("../../../packages/ui-tokens/tokens.css", import.meta.url), "utf8");
  const block = (start: string) => {
    const i = css.indexOf(start);
    return css.slice(i, css.indexOf("}", i));
  };
  const valueIn = (src: string, name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(src)?.[1]?.trim();
  const root = block(":root {");
  const day = block(':root[data-theme="daylight"] {');
  for (const [name, value] of Object.entries(DOC_TOKENS.dark)) assert.equal(value, valueIn(root, name), `dark ${name}`);
  for (const [name, value] of Object.entries(DOC_TOKENS.light)) assert.equal(value, valueIn(day, name) ?? valueIn(root, name), `light ${name}`);
});
