import { escapeHtml, renderMarkdown } from "./doc-render.ts";
import type { DocSidecar } from "./page-content.ts";

/**
 * The speaker view's HTML (routes/presenter.ts), for a deck's owner only.
 * Notes are rendered as Markdown with raw HTML shown as text
 * (lib/doc-render.ts), so a note can't run script here, on aired's own
 * origin. The page talks to the deck's window with postMessage, sending and
 * taking slide numbers only.
 */

const CSS = `
:root{color-scheme:dark;--bg:#0a0a0b;--surface:#111113;--surface-2:#18181b;--border:#222225;--text-1:#ededef;--text-2:#a1a1a6;--text-3:#84848a;--ring:#7c6aef;--ok:#34d399}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text-1);font:14px/1.5 'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:16px;padding:14px 20px;border-bottom:1px solid var(--border)}
header h1{font-size:14px;font-weight:500;margin:0;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header h1 span{color:var(--text-3);font-weight:400}
.clock{font:500 14px/1 'JetBrains Mono',ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums;color:var(--text-2)}
.timer{color:var(--text-1)}
main{flex:1;display:grid;grid-template-columns:minmax(0,1fr) 300px;min-height:0}
.now{padding:28px 32px;overflow:auto}
.eyebrow{font-size:12px;color:var(--text-3);text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px}
.now h2{font-size:26px;font-weight:500;letter-spacing:-.02em;margin:0 0 20px;line-height:1.2}
.notes{font-size:20px;line-height:1.6;color:var(--text-1);max-width:70ch}
.notes p,.notes ul,.notes ol{margin:0 0 .8em}
.notes code{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:.85em;background:var(--surface-2);border-radius:5px;padding:.1em .3em}
.notes a{color:inherit}
.empty{color:var(--text-3)}
aside{border-left:1px solid var(--border);padding:20px;overflow:auto;display:flex;flex-direction:column;gap:16px}
.next{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px}
.next b{display:block;font-weight:500;margin-top:4px}
ol.slides{list-style:none;margin:0;padding:0;display:grid;gap:2px}
ol.slides button{all:unset;box-sizing:border-box;width:100%;display:flex;gap:10px;padding:7px 10px;border-radius:8px;cursor:pointer;color:var(--text-2)}
ol.slides button:hover{background:var(--surface-2);color:var(--text-1)}
ol.slides button[aria-current="true"]{background:var(--surface-2);color:var(--text-1)}
ol.slides button:focus-visible,.bar button:focus-visible{outline:2px solid var(--ring);outline-offset:1px}
ol.slides .n{color:var(--text-3);font-variant-numeric:tabular-nums;min-width:22px}
ol.slides .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--text-3);margin-left:auto;align-self:center;flex:none}
.dot.has{background:var(--text-1)}
footer{display:flex;align-items:center;gap:8px;padding:12px 20px;border-top:1px solid var(--border)}
.bar button{all:unset;cursor:pointer;height:36px;padding:0 14px;border-radius:8px;display:inline-flex;align-items:center;gap:8px;font-weight:500;background:var(--surface-2);color:var(--text-1);box-shadow:inset 0 0 0 1px var(--border)}
.bar button:hover{background:#222225}
.bar button.primary{background:var(--text-1);color:var(--bg);box-shadow:none}
.bar button.primary:hover{background:#fff}
.bar button[disabled]{opacity:.4;cursor:default}
.count{font-variant-numeric:tabular-nums;color:var(--text-2);min-width:64px;text-align:center}
.status{margin-left:auto;font-size:13px;color:var(--text-3);display:flex;align-items:center;gap:8px}
.status.on{color:var(--text-2)}
.status.on::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--ok)}
.msg{max-width:460px;margin:16vh auto;padding:0 24px;text-align:center}
.msg h1{font-size:22px;font-weight:500;margin:0 0 10px}
.msg p{color:var(--text-2);margin:0 0 20px}
.msg a{display:inline-block;background:var(--text-1);color:var(--bg);text-decoration:none;font-weight:500;padding:10px 16px;border-radius:8px}
@media (max-width:760px){main{grid-template-columns:1fr}aside{border-left:0;border-top:1px solid var(--border)}.notes{font-size:18px}}
`;

function shell(title: string, body: string, nonce: string, script = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
${body}
${script ? `<script nonce="${nonce}">${script}</script>` : ""}
</body>
</html>`;
}

/** Anyone but the owner: the same page whether or not this is a deck with notes. */
export function speakerRefusedPage(opts: { id: string; signedIn: boolean; origin: string }): string {
  const back = `/p/${opts.id}/presenter`;
  const body = `<div class="msg">
<h1>Speaker notes are private</h1>
<p>Only the person who published this deck can open its speaker view.${opts.signedIn ? " You're signed in with a different account." : " Sign in with the account that published it."}</p>
${opts.signedIn ? `<a href="/p/${escapeHtml(opts.id)}">Open the slides</a>` : `<a href="/auth/login?return=${encodeURIComponent(back)}">Sign in</a>`}
</div>`;
  return shell("Speaker view · aired", body, "");
}

/**
 * The speaker view's script. The slides run sandboxed in an opaque origin
 * (middleware/security.ts), so messages to them can't name an origin and
 * theirs arrive with origin "null". What decides is which window sent it:
 * only the one this page opened, or was opened by. Only slide numbers cross.
 */
const SCRIPT = `(function(){
var d=document,items=d.querySelectorAll("[data-slide]"),N=items.length,cur=0,deck=null,linked=false,started=null;
var deckUrl=location.pathname.replace(/\\/presenter\\/?$/,"");
var $=function(s){return d.querySelector(s)};
var buttons=d.querySelectorAll("ol.slides button");
function title(i){var t=items[i]&&items[i].getAttribute("data-title");return t||("Slide "+(i+1))}
function show(i,send){if(!N)return;i=Math.min(Math.max(i,0),N-1);cur=i;
for(var k=0;k<N;k++){items[k].hidden=k!==i;buttons[k].setAttribute("aria-current",k===i?"true":"false")}
$("#now-n").textContent="Slide "+(i+1)+" of "+N;$("#now-t").textContent=title(i);
$("#next-t").textContent=i+1<N?title(i+1):"End of the deck";$("#count").textContent=(i+1)+" / "+N;
$("#prev").disabled=i===0;$("#next").disabled=i===N-1;
var h="#/"+(i+1);if(location.hash!==h)history.replaceState(null,"",h);
if(started===null&&i>0)start();
if(send!==false)post({aired:"deck",go:i+1})}
function target(){if(deck&&!deck.closed)return deck;if(window.opener&&!window.opener.closed)return window.opener;return null}
function post(m){var w=target();if(!w)return;try{w.postMessage(m,"*")}catch(e){}}
function status(){var s=$("#status");if(linked&&target()){s.className="status on";s.textContent="In step with the slides"}else{s.className="status";s.textContent="Open the slides from here to keep them in step"}}
window.addEventListener("message",function(e){if((e.origin!=="null"&&e.origin!==location.origin)||!e.source||e.source!==target())return;var m=e.data;if(!m||m.aired!=="deck"||typeof m.slide!=="number")return;linked=true;status();show(Math.floor(m.slide)-1,false)});
$("#open").addEventListener("click",function(){deck=window.open(deckUrl+"#/"+(cur+1),"aired-deck-"+deckUrl.split("/")[2]);linked=!!deck;status();if(started===null)start()});
$("#prev").addEventListener("click",function(){show(cur-1)});$("#next").addEventListener("click",function(){show(cur+1)});
for(var b=0;b<buttons.length;b++)(function(i){buttons[i].addEventListener("click",function(){show(i)})})(b);
$("#reset").addEventListener("click",function(){started=Date.now();tick()});
d.addEventListener("keydown",function(e){if(e.altKey||e.ctrlKey||e.metaKey)return;var k=e.key;
if(k==="ArrowRight"||k==="ArrowDown"||k==="PageDown"||k===" "){if(e.target&&e.target.tagName==="BUTTON"&&k===" ")return;e.preventDefault();show(cur+1)}
else if(k==="ArrowLeft"||k==="ArrowUp"||k==="PageUp"){e.preventDefault();show(cur-1)}
else if(k==="Home"){e.preventDefault();show(0)}else if(k==="End"){e.preventDefault();show(N-1)}});
function pad(n){return(n<10?"0":"")+n}
function start(){started=Date.now()}
function tick(){var now=new Date();$("#clock").textContent=pad(now.getHours())+":"+pad(now.getMinutes());
var s=started===null?0:Math.floor((Date.now()-started)/1000);$("#timer").textContent=pad(Math.floor(s/60))+":"+pad(s%60);status()}
setInterval(tick,1000);tick();
var m=/^#\\/?(\\d+)$/.exec(location.hash);show(m?parseInt(m[1],10)-1:0,false);
if(window.opener){post({aired:"deck",hello:1})}
})();`;

export function presenterPage(opts: { id: string; title: string | null; nonce: string; deck: DocSidecar | null }): string {
  const title = opts.title ?? "Slides";
  if (opts.deck === null) {
    const body = `<div class="msg"><h1>This page isn't a slide deck</h1><p>Speaker notes are for decks: Markdown with <code>type: deck</code>, or HTML with <code>&lt;section&gt;</code> slides.</p><a href="/p/${escapeHtml(opts.id)}">Open the page</a></div>`;
    return shell(`Speaker view · ${title}`, body, opts.nonce);
  }
  const { notes, titles, slides } = opts.deck;
  const n = Math.max(slides, notes.length);
  const items: string[] = [];
  const list: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = titles[i] ?? null;
    const note = (notes[i] ?? "").trim();
    items.push(
      `<div class="notes" data-slide="${i + 1}"${t ? ` data-title="${escapeHtml(t)}"` : ""}${i === 0 ? "" : " hidden"}>${note ? renderMarkdown(note) : '<p class="empty">No notes for this slide.</p>'}</div>`,
    );
    list.push(
      `<li><button type="button"${i === 0 ? ' aria-current="true"' : ""}><span class="n">${i + 1}</span><span class="t">${escapeHtml(t ?? `Slide ${i + 1}`)}</span><span class="dot${note ? " has" : ""}" title="${note ? "Has notes" : "No notes"}"></span></button></li>`,
    );
  }
  const body = `<header>
<h1>${escapeHtml(title)} <span>· Speaker view</span></h1>
<span class="clock" title="Time presenting"><span class="timer" id="timer">00:00</span></span>
<span class="clock" id="clock" title="Time now"></span>
</header>
<main>
<section class="now" aria-live="polite">
<p class="eyebrow" id="now-n">Slide 1 of ${n}</p>
<h2 id="now-t">${escapeHtml(titles[0] ?? "Slide 1")}</h2>
${items.join("\n")}
</section>
<aside>
<div class="next"><span class="eyebrow">Next</span><b id="next-t">${escapeHtml(n > 1 ? (titles[1] ?? "Slide 2") : "End of the deck")}</b></div>
<ol class="slides">${list.join("")}</ol>
</aside>
</main>
<footer class="bar">
<button type="button" class="primary" id="open">Open slides</button>
<button type="button" id="prev" aria-label="Previous slide">&larr;</button>
<span class="count" id="count">1 / ${n}</span>
<button type="button" id="next" aria-label="Next slide">&rarr;</button>
<button type="button" id="reset">Restart timer</button>
<span class="status" id="status" role="status"></span>
</footer>`;
  return shell(`Speaker view · ${title}`, body, opts.nonce, SCRIPT);
}
