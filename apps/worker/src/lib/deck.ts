/**
 * Slide decks: parsing and the small viewer that runs inside a published
 * deck. No runtime imports, so tests load it directly.
 *
 * A deck is either:
 *   - Markdown split into slides on lines that are just `---` (outside code
 *     blocks), when its front matter says `type: deck` (or `slides`,
 *     `marp: true`) or the publisher asks for a deck; or
 *   - HTML whose slides are its top-level <section> elements, when it has
 *     <meta name="aired" content="deck"> or the publisher asks for a deck.
 *
 * Speaker notes are `Note:` (or `Notes:`) to the end of a Markdown slide, any
 * <!-- comment --> in a Markdown slide, and <aside class="notes"> in HTML.
 * They are cut out of the public HTML here, at publish time, and kept beside
 * the page for its owner only (lib/page-content.ts, routes/presenter.ts).
 *
 * The viewer (DECK_RUNTIME_CSS / DECK_RUNTIME_JS) shows one slide at a time,
 * scaled to fit: arrow keys, Space, Page Up/Down, Home/End, swipe on phones,
 * F for fullscreen, S for the speaker view, and `#/3` in the URL opens
 * slide 3. It only uses what the page sandbox already allows.
 */

/** The logical slide size; slides are scaled to fit the window. */
export const SLIDE_WIDTH = 1280;
export const SLIDE_HEIGHT = 720;

/** Most slides a deck can have, and the longest note kept per slide. */
export const MAX_SLIDES = 300;
export const MAX_NOTE_CHARS = 10_000;

export type FrontMatter = Record<string, string>;

/**
 * `---`-fenced `key: value` lines at the very top of a Markdown file. Only
 * flat keys; quotes around a value are dropped. Anything that isn't front
 * matter leaves the text as it was.
 */
export function splitFrontMatter(md: string): { data: FrontMatter; body: string } {
  const text = md.replace(/^﻿/, "");
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (m === null) return { data: {}, body: text };
  const data: FrontMatter = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    // Not flat key: value lines: not front matter (maybe a slide that starts with a rule).
    if (kv === null) return { data: {}, body: text };
    data[kv[1]!.toLowerCase()] = kv[2]!.trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { data, body: text.slice(m[0].length) };
}

/** Whether front matter asks for a deck. */
export function frontMatterIsDeck(data: FrontMatter): boolean {
  const type = (data.type ?? data.layout ?? "").toLowerCase();
  return type === "deck" || type === "slides" || type === "presentation" || data.marp === "true" || data.deck === "true" || data.slides === "true";
}

/** Lines of Markdown, each marked with whether it sits inside a fenced code block. */
function fencedLines(md: string): Array<{ line: string; code: boolean }> {
  const out: Array<{ line: string; code: boolean }> = [];
  let fence: string | null = null;
  for (const line of md.split(/\r?\n/)) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence === null && f !== null) {
      fence = f[1]!;
      out.push({ line, code: true });
    } else if (fence !== null) {
      out.push({ line, code: true });
      if (f !== null && f[1]![0] === fence[0] && f[1]!.length >= fence.length && line.trim() === f[1]) fence = null;
    } else {
      out.push({ line, code: false });
    }
  }
  return out;
}

/** Markdown split into slides on `---` lines outside code blocks. Empty slides are dropped. */
export function splitSlides(body: string): string[] {
  const slides: string[] = [];
  let cur: string[] = [];
  for (const { line, code } of fencedLines(body)) {
    if (!code && /^\s{0,3}-{3,}\s*$/.test(line)) {
      slides.push(cur.join("\n"));
      cur = [];
    } else {
      cur.push(line);
    }
  }
  slides.push(cur.join("\n"));
  return slides.filter((s) => s.trim() !== "").slice(0, MAX_SLIDES);
}

/**
 * HTML comments outside code blocks, cut out of Markdown. Returns the text
 * without them and what they said. Unclosed comments run to the end.
 */
export function takeComments(md: string): { text: string; comments: string[] } {
  const comments: string[] = [];
  const kept: string[] = [];
  let open: string[] | null = null;
  for (const { line, code } of fencedLines(md)) {
    if (code && open === null) {
      kept.push(line);
      continue;
    }
    let rest = line;
    let out = "";
    while (rest !== "") {
      if (open !== null) {
        const end = rest.indexOf("-->");
        if (end === -1) {
          open.push(rest);
          rest = "";
        } else {
          open.push(rest.slice(0, end));
          comments.push(open.join("\n").trim());
          open = null;
          rest = rest.slice(end + 3);
        }
      } else {
        const start = rest.indexOf("<!--");
        if (start === -1) {
          out += rest;
          rest = "";
        } else {
          out += rest.slice(0, start);
          open = [];
          rest = rest.slice(start + 4);
        }
      }
    }
    // A line that was only a comment goes away entirely.
    if (out.trim() !== "" || line.trim() === "" || !/<!--|-->/.test(line)) kept.push(out);
  }
  if (open !== null) comments.push(open.join("\n").trim());
  return { text: kept.join("\n"), comments: comments.filter((c) => c !== "") };
}

/** One Markdown slide without its notes, and its notes. */
export function slideNotes(slide: string): { body: string; notes: string } {
  const { text, comments } = takeComments(slide);
  const lines = fencedLines(text);
  const at = lines.findIndex(({ line, code }) => !code && /^\s{0,3}notes?:/i.test(line));
  const notes = [...comments];
  let body = text;
  if (at !== -1) {
    body = lines.slice(0, at).map((l) => l.line).join("\n");
    const first = lines[at]!.line.replace(/^\s{0,3}notes?:\s*/i, "");
    notes.push([first, ...lines.slice(at + 1).map((l) => l.line)].join("\n").trim());
  }
  return { body: body.trim(), notes: capNote(notes.filter((n) => n !== "").join("\n\n")) };
}

const capNote = (n: string): string => (n.length > MAX_NOTE_CHARS ? n.slice(0, MAX_NOTE_CHARS) : n);

/** Whether HTML marks itself as a deck: <meta name="aired" content="deck">. */
export function htmlIsDeck(html: string): boolean {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if (/\bname\s*=\s*["']?aired["'\s/>]/i.test(tag) && /\bcontent\s*=\s*["']?deck["'\s/>]/i.test(tag)) return true;
  }
  return false;
}

/** Ranges of <script>, <style>, <textarea> and comments, where tags don't count. */
function opaqueRanges(html: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
  for (const m of html.matchAll(re)) ranges.push([m.index!, m.index! + m[0].length]);
  return ranges;
}

const inside = (ranges: Array<[number, number]>, i: number) => ranges.some(([a, b]) => i >= a && i < b);

/** [start, end) of each top-level <section> in HTML, outer tags included. */
export function topLevelSections(html: string): Array<[number, number]> {
  const skip = opaqueRanges(html);
  const out: Array<[number, number]> = [];
  let depth = 0;
  let start = -1;
  for (const m of html.matchAll(/<(\/?)section\b[^>]*>/gi)) {
    if (inside(skip, m.index!)) continue;
    if (m[1] === "") {
      if (depth === 0) start = m.index!;
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0) out.push([start, m.index! + m[0].length]);
    }
  }
  return out.slice(0, MAX_SLIDES);
}

/** HTML as plain text: tags out, block ends as line breaks, the common entities decoded. */
export function htmlText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|pre)\s*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "- ")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return named[e.toLowerCase()] ?? all;
  });
}

/** <aside class="... notes ...">…</aside>, anywhere. */
const NOTES_ASIDE = /<aside\b[^>]*\bclass\s*=\s*(?:"[^"]*\bnotes\b[^"]*"|'[^']*\bnotes\b[^']*'|notes\b)[^>]*>([\s\S]*?)<\/aside\s*>/gi;

/** The first heading's text in a piece of HTML, for slide titles. */
export function firstHeading(html: string): string | null {
  const m = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/i.exec(html);
  if (m === null) return null;
  const t = htmlText(m[2]!).replace(/\s+/g, " ").trim();
  return t === "" ? null : t.slice(0, 200);
}

export type HtmlDeck = {
  /** The HTML with every notes aside removed. The viewer isn't added yet. */
  html: string;
  /** One entry per slide; "" when a slide has no notes. */
  notes: string[];
  titles: Array<string | null>;
};

/**
 * An HTML deck's slides and notes. Every <aside class="notes"> is removed,
 * including ones outside a slide, so no note reaches the public page.
 */
export function parseHtmlDeck(html: string): HtmlDeck {
  const sections = topLevelSections(html);
  const notes: string[] = sections.map(() => "");
  const titles: Array<string | null> = [];
  for (const [i, [a, b]] of sections.entries()) {
    const part = html.slice(a, b);
    const found: string[] = [];
    for (const m of part.matchAll(NOTES_ASIDE)) found.push(htmlText(m[1]!));
    notes[i] = capNote(found.filter((n) => n !== "").join("\n\n"));
    titles.push(firstHeading(part.replace(NOTES_ASIDE, "")));
  }
  return { html: stripNotes(html), notes, titles };
}

/** HTML with every notes aside removed (also ones that nest: repeated until none are left). */
export function stripNotes(html: string): string {
  let out = html;
  for (let i = 0; i < 10; i++) {
    const next = out.replace(NOTES_ASIDE, "");
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Puts the viewer into a deck's HTML: its CSS at the end of <head>, its script at the end of <body>. */
export function injectDeckRuntime(html: string): string {
  const css = `<style id="aired-deck-css">${DECK_RUNTIME_CSS}</style>`;
  const js = `<script id="aired-deck-js">${DECK_RUNTIME_JS}</script>`;
  let out = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${css}</head>`) : css + html;
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${js}</body>`) : out + js;
  return out;
}

/**
 * The viewer's CSS. Slides are the top-level <section>s, marked by the
 * script with data-aired-slide; only the current one shows. The controls
 * sit bottom-left, clear of the aired badge (bottom-right).
 */
export const DECK_RUNTIME_CSS = `
html.aired-deck,html.aired-deck body{margin:0;height:100%;overflow:hidden;background:#0b0b0c}
html.aired-deck [data-aired-slide]{position:fixed;left:50%;top:50%;width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;margin:0;box-sizing:border-box;overflow:hidden;transform:translate(-50%,-50%) scale(var(--aired-scale,1));transform-origin:center center}
html.aired-deck [data-aired-slide].aired-off{display:none!important}
.aired-deck-ui{position:fixed;left:16px;bottom:16px;z-index:2147483000;display:flex;align-items:center;gap:2px;padding:4px;border-radius:999px;background:rgba(17,17,19,.78);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);box-shadow:0 0 0 1px rgba(255,255,255,.1),0 8px 24px -8px rgba(0,0,0,.6);font:500 13px/1 -apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;color:#ededef;transition:opacity .2s cubic-bezier(.16,1,.3,1)}
.aired-deck-ui button{all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:32px;height:32px;padding:0 8px;border-radius:999px;color:#ededef;box-sizing:border-box}
.aired-deck-ui button:hover{background:rgba(255,255,255,.1)}
.aired-deck-ui button:focus-visible{outline:2px solid #7c6aef;outline-offset:1px}
.aired-deck-ui button[disabled]{opacity:.35;cursor:default;background:none}
.aired-deck-ui svg{width:16px;height:16px;flex:none}
.aired-deck-ui .aired-count{min-width:56px;text-align:center;font-variant-numeric:tabular-nums;color:#a1a1a6;padding:0 4px}
.aired-deck-ui .aired-label{font-size:13px}
html.aired-idle .aired-deck-ui{opacity:0;pointer-events:none}
html.aired-idle,html.aired-idle *{cursor:none!important}
.aired-toast{position:fixed;left:16px;bottom:64px;z-index:2147483000;padding:8px 12px;border-radius:8px;background:#ededef;color:#0a0a0b;font:500 13px/1.2 -apple-system,BlinkMacSystemFont,'Inter',sans-serif;opacity:0;transform:translateY(4px);transition:opacity .2s,transform .2s;pointer-events:none}
.aired-toast.aired-on{opacity:1;transform:none}
@media (max-width:640px){.aired-deck-ui .aired-label{display:none}.aired-deck-ui{left:50%;transform:translateX(-50%);bottom:12px}}
@media (prefers-reduced-motion:reduce){.aired-deck-ui,.aired-toast{transition:none}}
@media print{
@page{size:${SLIDE_WIDTH}px ${SLIDE_HEIGHT}px;margin:0}
html.aired-deck,html.aired-deck body{height:auto;overflow:visible;background:none}
html.aired-deck [data-aired-slide],html.aired-deck [data-aired-slide].aired-off{display:block!important;position:relative;left:auto;top:auto;transform:none;break-after:page;page-break-after:always}
.aired-deck-ui,.aired-toast,#__aired-bar{display:none!important}
}`;

/**
 * The viewer's script. Plain ES5 so it runs anywhere. Messages to and from
 * the speaker view (routes/presenter.ts) carry slide numbers only, never
 * notes: the notes stay on the speaker view's side.
 */
export const DECK_RUNTIME_JS = `(function(){
var d=document,root=d.documentElement,W=${SLIDE_WIDTH},H=${SLIDE_HEIGHT};
var all=d.getElementsByTagName("section"),S=[];
for(var i=0;i<all.length;i++){var p=all[i].parentElement,nested=false;while(p){if(p.tagName==="SECTION"){nested=true;break}p=p.parentElement}if(!nested)S.push(all[i])}
if(!S.length)return;
var bodyBg=getComputedStyle(d.body).backgroundColor;
if(!bodyBg||bodyBg==="rgba(0, 0, 0, 0)"||bodyBg==="transparent")bodyBg="#ffffff";
root.classList.add("aired-deck");
for(var j=0;j<S.length;j++){S[j].setAttribute("data-aired-slide",String(j+1));var bg=getComputedStyle(S[j]).backgroundColor;if(bg==="rgba(0, 0, 0, 0)"||bg==="transparent")S[j].style.backgroundColor=bodyBg}
var cur=-1,speaker=null;
var ico={prev:'<path d="M10 3 5 8l5 5"/>',next:'<path d="m6 3 5 5-5 5"/>',full:'<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>',link:'<path d="M6.5 9.5 9.5 6.5M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1"/>'};
function svg(n){return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+ico[n]+'</svg>'}
var ui=d.createElement("div");ui.className="aired-deck-ui";ui.setAttribute("role","toolbar");ui.setAttribute("aria-label","Slides");
ui.innerHTML='<button type="button" data-a="prev" aria-label="Previous slide">'+svg("prev")+'</button><span class="aired-count" aria-live="polite"></span><button type="button" data-a="next" aria-label="Next slide">'+svg("next")+'</button><button type="button" data-a="full" aria-label="Present full screen">'+svg("full")+'<span class="aired-label">Present</span></button><button type="button" data-a="link" aria-label="Copy a link to this slide">'+svg("link")+'</button>';
d.body.appendChild(ui);
var toast=d.createElement("div");toast.className="aired-toast";toast.setAttribute("role","status");d.body.appendChild(toast);
var count=ui.querySelector(".aired-count"),bPrev=ui.querySelector('[data-a="prev"]'),bNext=ui.querySelector('[data-a="next"]');
function fit(){var s=Math.min(innerWidth/W,innerHeight/H);root.style.setProperty("--aired-scale",String(s))}
function fromHash(){var m=/^#\\/?(\\d+)$/.exec(location.hash);if(!m)return 0;var n=parseInt(m[1],10);return Math.min(Math.max(n,1),S.length)-1}
function tell(w){try{if(w&&!w.closed)w.postMessage({aired:"deck",slide:cur+1,total:S.length},location.origin)}catch(e){}}
function go(i){i=Math.min(Math.max(i,0),S.length-1);if(i===cur)return;for(var k=0;k<S.length;k++)S[k].classList.toggle("aired-off",k!==i);cur=i;
count.textContent=(i+1)+" / "+S.length;bPrev.disabled=i===0;bNext.disabled=i===S.length-1;
var h="#/"+(i+1);if(location.hash!==h){try{history.replaceState(null,"",h)}catch(e){location.replace(h)}}
tell(window.opener);tell(speaker)}
function note(t){toast.textContent=t;toast.classList.add("aired-on");clearTimeout(note.t);note.t=setTimeout(function(){toast.classList.remove("aired-on")},1800)}
function full(){var fs=d.fullscreenElement||d.webkitFullscreenElement;try{if(fs){(d.exitFullscreen||d.webkitExitFullscreen).call(d)}else{var r=root.requestFullscreen||root.webkitRequestFullscreen;if(r){var p=r.call(root);if(p&&p.catch)p.catch(function(){note("Full screen isn't available here")})}else note("Full screen isn't available here")}}catch(e){note("Full screen isn't available here")}}
function copy(){var u=location.href.split("#")[0]+"#/"+(cur+1);function done(){note("Link to slide "+(cur+1)+" copied")}
function ask(){try{window.prompt("Link to this slide",u)}catch(e){}}
try{navigator.clipboard.writeText(u).then(done,ask)}catch(e){ask()}}
function openSpeaker(){var u=location.pathname.replace(/\\/+$/,"")+"/presenter#/"+(cur+1);try{speaker=window.open(u,"aired-speaker-"+location.pathname.split("/")[2],"popup,width=980,height=640")}catch(e){speaker=null}if(!speaker)note("Allow pop-ups to open the speaker view")}
ui.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("button");if(!b)return;var a=b.getAttribute("data-a");if(a==="prev")go(cur-1);else if(a==="next")go(cur+1);else if(a==="full")full();else if(a==="link")copy()});
d.addEventListener("keydown",function(e){var t=e.target;if(e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey)return;if(t&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))return;
var k=e.key;if(k==="ArrowRight"||k==="ArrowDown"||k==="PageDown"||k===" "||k==="Spacebar"||k==="n"){if(t&&t.tagName==="BUTTON"&&k===" ")return;e.preventDefault();go(cur+1)}
else if(k==="ArrowLeft"||k==="ArrowUp"||k==="PageUp"||k==="p"){e.preventDefault();go(cur-1)}
else if(k==="Home"){e.preventDefault();go(0)}else if(k==="End"){e.preventDefault();go(S.length-1)}
else if(k==="f"||k==="F"){e.preventDefault();full()}else if(k==="s"||k==="S"){e.preventDefault();openSpeaker()}});
var tx=null,ty=0;
d.addEventListener("touchstart",function(e){if(e.touches.length!==1){tx=null;return}tx=e.touches[0].clientX;ty=e.touches[0].clientY},{passive:true});
d.addEventListener("touchend",function(e){if(tx===null)return;var t=e.changedTouches[0],dx=t.clientX-tx,dy=t.clientY-ty;tx=null;if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)*1.5)go(dx<0?cur+1:cur-1)},{passive:true});
var idle=null;function wake(){root.classList.remove("aired-idle");clearTimeout(idle);if(d.fullscreenElement||d.webkitFullscreenElement)idle=setTimeout(function(){root.classList.add("aired-idle")},2500)}
d.addEventListener("mousemove",wake);d.addEventListener("fullscreenchange",function(){fit();wake()});d.addEventListener("webkitfullscreenchange",function(){fit();wake()});
window.addEventListener("message",function(e){if(e.origin!==location.origin||!e.source||(e.source!==window.opener&&e.source!==speaker))return;var m=e.data;if(!m||m.aired!=="deck")return;
if(typeof m.go==="number"&&isFinite(m.go))go(Math.floor(m.go)-1);else if(m.hello){tell(e.source)}});
addEventListener("resize",fit);addEventListener("hashchange",function(){go(fromHash())});
fit();go(fromHash());
})();`;
