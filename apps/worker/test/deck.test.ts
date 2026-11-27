import "./helpers/ts-resolve.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

const { splitFrontMatter, splitSlides, slideNotes, htmlIsDeck, topLevelSections, parseHtmlDeck, injectDeckRuntime, frontMatterIsDeck } = await import("../src/lib/deck.ts");
const { renderMarkdownPage } = await import("../src/lib/doc-render.ts");
const { buildContent } = await import("../src/lib/page-content.ts");
const { TEMPLATES, getTemplate } = await import("@aired/core");

test("front matter: flat key: value lines at the top, or none", () => {
  assert.deepEqual(splitFrontMatter("---\ntype: deck\ntitle: \"Q3 update\"\n---\n# Hi"), { data: { type: "deck", title: "Q3 update" }, body: "# Hi" });
  // A deck that starts with a rule and a slide isn't front matter.
  const noFm = "---\n# Slide one\n---\n# Two";
  assert.deepEqual(splitFrontMatter(noFm), { data: {}, body: noFm });
  assert.ok(frontMatterIsDeck({ type: "slides" }) && frontMatterIsDeck({ marp: "true" }) && frontMatterIsDeck({ type: "Deck" }));
  assert.ok(!frontMatterIsDeck({ type: "doc" }) && !frontMatterIsDeck({}));
});

test("slides split on --- lines, but not inside code blocks, and empty slides are dropped", () => {
  const md = "# One\n\n---\n\n## Two\n\n```yaml\n---\nkey: value\n---\n```\n\n---\n\n---\n\n## Three\n";
  const slides = splitSlides(md);
  assert.equal(slides.length, 3);
  assert.match(slides[1]!, /```yaml\n---\nkey: value\n---\n```/);
  assert.match(slides[2]!, /## Three/);
});

test("speaker notes: Note: to the end of the slide, and comments; code blocks are left alone", () => {
  assert.deepEqual(slideNotes("## Title\n\n- a point\n\nNote: say this\nand this"), { body: "## Title\n\n- a point", notes: "say this\nand this" });
  assert.deepEqual(slideNotes("## T\n<!-- quiet reminder -->\nText\nNotes: more"), { body: "## T\nText", notes: "quiet reminder\n\nmore" });
  const code = slideNotes("```\nNote: this is code\n<!-- also code -->\n```");
  assert.equal(code.notes, "");
  assert.match(code.body, /Note: this is code/);
});

test("a Markdown deck: one section per slide, title slides, and no notes anywhere in the public HTML", () => {
  const md = "---\ntype: deck\ntitle: Launch\n---\n# Launch\nSubtitle\n\nNote: SECRET-ONE\n\n---\n\n## Plan\n- step <!-- SECRET-TWO -->\n\n---\n\n## End\n<script>alert(1)</script>";
  const r = renderMarkdownPage(md);
  assert.equal(r.kind, "deck");
  assert.equal(r.title, "Launch");
  assert.deepEqual(r.notes, ["SECRET-ONE", "SECRET-TWO", ""]);
  assert.deepEqual(r.titles, ["Launch", "Plan", "End"]);
  assert.ok(!r.html.includes("SECRET"), "notes stay out of the page");
  assert.equal((r.html.match(/<section class="slide/g) ?? []).length, 3);
  assert.match(r.html, /<section class="slide lead" aria-label="Slide 1">/);
  assert.match(r.html, /<meta name="aired" content="deck">/);
  // The only script is aired's viewer; the slide's script is text.
  assert.deepEqual([...r.html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]), ['<script id="aired-deck-js">']);
  assert.ok(r.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  // deck: true makes a deck of Markdown with no front matter too.
  assert.equal(renderMarkdownPage("# A\n---\n## B", { deck: true }).kind, "deck");
  assert.equal(renderMarkdownPage("# A\n---\n## B").kind, "doc");
});

test("an HTML deck: <meta name=aired content=deck>, top-level sections only", () => {
  assert.ok(htmlIsDeck('<meta name="aired" content="deck">'));
  assert.ok(htmlIsDeck("<meta content='deck' name='aired' />"));
  assert.ok(!htmlIsDeck('<meta name="description" content="deck">'));
  const html = "<body><section>1<section>nested</section></section><script>'<section>'</script><!-- <section> --><section>2</section></body>";
  assert.equal(topLevelSections(html).length, 2);
});

test("an HTML deck's notes asides are cut out everywhere, and kept per slide", () => {
  const html = [
    '<meta name="aired" content="deck"><body>',
    '<section><h1>Hello <em>there</em></h1><aside class="notes">SECRET <b>one</b></aside></section>',
    "<section><h2>Two</h2><aside class='speaker notes'>SECRET two</aside><aside class=\"sidebar\">kept</aside></section>",
    '<section><p>Three</p></section>',
    '<aside class="notes">SECRET stray</aside>',
    "</body>",
  ].join("");
  const d = parseHtmlDeck(html);
  assert.deepEqual(d.notes, ["SECRET one", "SECRET two", ""]);
  assert.deepEqual(d.titles, ["Hello there", "Two", null]);
  assert.ok(!d.html.includes("SECRET"));
  assert.ok(d.html.includes('<aside class="sidebar">kept</aside>'));
  const built = buildContent({ html });
  assert.equal(built.kind, "deck");
  assert.ok(!built.html.includes("SECRET"));
  assert.equal(built.sidecar?.source, html, "the owner's copy keeps the notes");
  // Asked for a deck with no sections: a plain page, but still no notes.
  const flat = buildContent({ html: '<p>hi</p><aside class="notes">SECRET</aside>', deck: true });
  assert.equal(flat.kind, "page");
  assert.ok(!flat.html.includes("SECRET"));
  // Plain HTML is stored as sent, notes-looking asides and all (it isn't a deck).
  assert.equal(buildContent({ html: '<aside class="notes">x</aside>' }).html, '<aside class="notes">x</aside>');
});

/** A deck page in a small browser, its viewer script run. */
function openDeck(html: string, hash = "") {
  const window = new Window({ url: `https://aired.sh/p/abc123${hash}`, width: 1280, height: 720 });
  const doc = window.document;
  const withoutScript = html.replace(/<script id="aired-deck-js">([\s\S]*?)<\/script>/, "");
  const script = /<script id="aired-deck-js">([\s\S]*?)<\/script>/.exec(html)![1]!;
  doc.write(withoutScript);
  window.eval(script);
  const visible = () => [...doc.querySelectorAll("[data-aired-slide]")].filter((s) => !s.classList.contains("aired-off")).map((s) => s.getAttribute("data-aired-slide"));
  const key = (k: string) => doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }));
  return { window, doc, visible, key };
}

const FIVE = renderMarkdownPage("---\ntype: deck\n---\n# 1\n---\n## 2\n---\n## 3\n---\n## 4\n---\n## 5").html;

test("slide links: #/3 opens slide 3; moving updates the link; out-of-range numbers are clamped", async () => {
  const d = openDeck(FIVE, "#/3");
  assert.deepEqual(d.visible(), ["3"]);
  assert.equal(d.doc.querySelector(".aired-count")!.textContent, "3 / 5");
  d.key("ArrowRight");
  assert.deepEqual(d.visible(), ["4"]);
  assert.equal(d.window.location.hash, "#/4");
  d.key("End");
  assert.deepEqual(d.visible(), ["5"]);
  d.key("ArrowRight");
  assert.deepEqual(d.visible(), ["5"], "no slide past the last");
  d.key("Home");
  assert.deepEqual(d.visible(), ["1"]);
  d.key("ArrowLeft");
  assert.deepEqual(d.visible(), ["1"]);
  d.window.location.hash = "#/2";
  d.window.dispatchEvent(new d.window.HashChangeEvent("hashchange"));
  assert.deepEqual(d.visible(), ["2"]);
  assert.deepEqual(openDeck(FIVE, "#/99").visible(), ["5"]);
  assert.deepEqual(openDeck(FIVE, "#4").visible(), ["4"]);
  assert.deepEqual(openDeck(FIVE, "#intro").visible(), ["1"]);
  await d.window.happyDOM.close();
});

test("the viewer: controls, keys that skip form fields, and swipe", async () => {
  const d = openDeck(FIVE);
  const ui = d.doc.querySelector(".aired-deck-ui")!;
  assert.ok(ui.querySelector('[aria-label="Previous slide"]') && ui.querySelector('[aria-label="Next slide"]') && ui.querySelector('[aria-label="Present full screen"]') && ui.querySelector('[aria-label="Copy a link to this slide"]'));
  (ui.querySelector('[data-a="next"]') as unknown as { click(): void }).click();
  assert.deepEqual(d.visible(), ["2"]);
  // Typing in a field on a slide doesn't change slides.
  const input = d.doc.createElement("input");
  d.doc.body.appendChild(input);
  input.dispatchEvent(new d.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.deepEqual(d.visible(), ["2"]);
  const touch = (type: string, x: number) => {
    const e = new d.window.Event(type, { bubbles: true }) as unknown as Record<string, unknown>;
    const t = [{ clientX: x, clientY: 300 }];
    if (type === "touchstart") e.touches = t;
    else e.changedTouches = t;
    d.doc.dispatchEvent(e as never);
  };
  touch("touchstart", 900);
  touch("touchend", 600);
  assert.deepEqual(d.visible(), ["3"], "swipe left: next");
  touch("touchstart", 300);
  touch("touchend", 700);
  assert.deepEqual(d.visible(), ["2"], "swipe right: back");
  await d.window.happyDOM.close();
});

test("the viewer works on HTML decks and only takes slide numbers from its own windows", async () => {
  const html = injectDeckRuntime("<html><head></head><body><section><h1>A</h1><section>inner</section></section><section>B</section></body></html>");
  const d = openDeck(html, "#/2");
  assert.deepEqual(d.visible(), ["2"]);
  assert.equal(d.doc.querySelectorAll("[data-aired-slide]").length, 2, "a nested section isn't a slide");
  // A message from some other window is ignored.
  d.window.dispatchEvent(new d.window.MessageEvent("message", { data: { aired: "deck", go: 1 }, origin: "https://aired.sh", source: null }));
  assert.deepEqual(d.visible(), ["2"]);
  await d.window.happyDOM.close();
});

test("templates: unique names, and each publishes as it says", () => {
  assert.equal(new Set(TEMPLATES.map((t) => t.name)).size, TEMPLATES.length);
  for (const t of TEMPLATES) {
    const built = buildContent(t.format === "markdown" ? { markdown: t.content, deck: t.deck } : { html: t.content, deck: t.deck });
    assert.equal(built.kind, t.deck ? "deck" : t.format === "markdown" ? "doc" : "page", t.name);
    assert.ok(built.html.length > 500, t.name);
    assert.ok(t.rules.length >= 3, t.name);
    if (t.deck) {
      assert.ok((built.sidecar?.notes ?? []).some((n) => n !== ""), `${t.name} shows how notes work`);
      for (const n of built.sidecar!.notes) if (n !== "") assert.ok(!built.html.includes(n.slice(0, 30)), `${t.name}: notes stay out of the page`);
    }
  }
  assert.equal(getTemplate("Deck")?.name, "deck");
  assert.equal(getTemplate("onepager")?.name, "one-pager");
  assert.equal(getTemplate("nope"), null);
});

test("the speaker view follows only the slides window it's linked to, whose messages come from a sandboxed (null) origin", async () => {
  const { presenterPage } = await import("../src/lib/presenter-page.ts");
  const deck = buildContent({ markdown: getTemplate("deck")!.content }).sidecar!;
  const html = presenterPage({ id: "abc123", title: "Q3", nonce: "n0nce", deck });
  const script = /<script nonce="n0nce">([\s\S]*?)<\/script>/.exec(html)![1]!;
  const window = new Window({ url: "https://aired.sh/p/abc123/presenter#/1", width: 1000, height: 700 });
  const sent: unknown[] = [];
  // Messages are built in the page's realm: kept as JSON so they compare plainly.
  const slides = { closed: false, postMessage: (m: unknown, target: string) => sent.push(JSON.parse(JSON.stringify({ m, target }))) };
  Object.defineProperty(window, "opener", { value: slides, configurable: true });
  window.document.write(html.replace(/<script nonce[\s\S]*?<\/script>/, ""));
  window.eval(script);
  try {
  const now = () => window.document.querySelector("#now-n")!.textContent;
  // It says hello to the slides that opened it, without naming an origin they can't have.
  assert.deepEqual(sent.at(-1), { m: { aired: "deck", hello: 1 }, target: "*" });
  window.dispatchEvent(new window.MessageEvent("message", { data: { aired: "deck", slide: 4 }, origin: "null", source: slides as never }));
  assert.equal(now(), "Slide 4 of 7");
  assert.equal(window.document.querySelector("#status")!.textContent, "In step with the slides");
  // Another window, or no window, is ignored even with the right shape.
  window.dispatchEvent(new window.MessageEvent("message", { data: { aired: "deck", slide: 2 }, origin: "null", source: {} as never }));
  window.dispatchEvent(new window.MessageEvent("message", { data: { aired: "deck", slide: 2 }, origin: "null", source: null }));
  window.dispatchEvent(new window.MessageEvent("message", { data: { aired: "deck", slide: 2 }, origin: "https://evil.example", source: slides as never }));
  assert.equal(now(), "Slide 4 of 7");
  // Next in the speaker view moves the slides; only a slide number is sent, never a note.
  (window.document.querySelector("#next") as unknown as { click(): void }).click();
  assert.deepEqual(sent.at(-1), { m: { aired: "deck", go: 5 }, target: "*" });
  assert.ok(!JSON.stringify(sent).includes("checkout"));
  } finally {
    await window.happyDOM.close();
  }
});
