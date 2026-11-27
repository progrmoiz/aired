/**
 * Live reload: when a page's content is replaced (a publish update, PUT,
 * update_page or a restore, all through lib/page-write.ts updatePage),
 * viewers who have it open get the new version within a few seconds,
 * without reloading by hand.
 *
 * It rides the same channel as update_data's live data (routes/collect.ts):
 * the served page gets a small script with a signed token, and while its
 * tab is showing it asks POST /c/:id/live every LIVE_RELOAD_POLL_SECONDS
 * whether the HTML it was served is still the live one (the R2 etag). The
 * token is a watch token (lib/collect-token.ts): one page, its gate, an
 * expiry, no viewer, so it can't save or read anything, and a PIN or
 * people-list change ends it.
 *
 * On a change the page reloads itself, keeping its place: a deck keeps its
 * slide (the #/N in the address survives a reload) and a long page its
 * scroll position (carried across the reload in window.name, the one thing
 * an opaque-origin page keeps). It holds off while the viewer is in full
 * screen (reloads when they leave it), and when they've typed into the page
 * it shows a small "Updated · Reload" button instead of throwing their
 * input away.
 */

import { LIVE_RELOAD_POLL_SECONDS, VIEWER_TOKEN_SECONDS } from "./collect-limits.ts";
import { mintWatchToken, pageGate, usableSecret } from "./collect-token.ts";
import { scriptJson } from "./collect-runtime.ts";

export type LiveReloadConfig = { origin: string; id: string; token: string; etag: string };

/** The script a served page gets (after the sandbox shim, before the page's own scripts). */
export function liveReloadScript(cfg: LiveReloadConfig): string {
  const L = { base: `${cfg.origin}/c/${encodeURIComponent(cfg.id)}`, token: cfg.token, etag: cfg.etag, ms: LIVE_RELOAD_POLL_SECONDS * 1000 };
  return `<script>(function(){
var L=${scriptJson(L)},F=window.fetch&&window.fetch.bind(window),K="aired-reload:",d=document;
try{var n=String(window.name||"");if(n.indexOf(K)===0){var nl=n.indexOf("\\n"),s=JSON.parse(nl<0?n.slice(K.length):n.slice(K.length,nl));window.name=nl<0?"":n.slice(nl+1);
if(s&&s.p===location.pathname&&(s.x||s.y)){var go=function(){window.scrollTo(s.x||0,s.y||0)};if(d.readyState==="complete")go();else{d.addEventListener("DOMContentLoaded",go);addEventListener("load",go)}}}}catch(e){}
if(!F)return;
var edited=false,stopped=false,busy=false,waiting=false;
addEventListener("input",function(){edited=true},true);
function full(){return !!(d.fullscreenElement||d.webkitFullscreenElement)}
function reload(){if(full()){waiting=true;return}
try{window.name=K+JSON.stringify({p:location.pathname,x:window.scrollX||0,y:window.scrollY||0})+"\\n"+String(window.name||"")}catch(e){}
location.reload()}
function onFull(){if(waiting&&!full()){waiting=false;changed()}}
d.addEventListener("fullscreenchange",onFull);d.addEventListener("webkitfullscreenchange",onFull);
function offer(){if(d.getElementById("__aired-reload")||!d.body)return;var b=d.createElement("button");b.id="__aired-reload";b.type="button";
b.textContent="This page was updated \\u00b7 Reload";
b.setAttribute("style","all:initial;position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483647;cursor:pointer;padding:8px 14px;border-radius:999px;font:500 13px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#0a0a0b;color:#fff;box-shadow:0 6px 20px rgba(10,10,11,.25)");
b.addEventListener("click",function(){edited=false;reload()});d.body.appendChild(b)}
function changed(){if(edited)offer();else reload()}
function tick(){if(stopped||busy||d.visibilityState==="hidden")return;busy=true;
F(L.base+"/live",{method:"POST",headers:{"Content-Type":"text/plain"},body:JSON.stringify({token:L.token,etag:L.etag}),credentials:"omit",cache:"no-store"})
.then(function(r){if(r.status===403||r.status===404||r.status===410){stopped=true;return null}return r.ok?r.json():null})
.then(function(j){busy=false;if(j&&j.changed===true){stopped=true;changed()}},function(){busy=false})}
setInterval(tick,L.ms);
d.addEventListener("visibilitychange",function(){if(d.visibilityState==="visible")tick()});
})();</script>`;
}

/**
 * The live-reload script for a page being served, or "" when there's no
 * secret to sign with or the HTML has no etag to compare.
 */
export async function liveReloadFor(opts: {
  secret: string;
  origin: string;
  id: string;
  /** The page's gate material, as the data layer's tokens are tied to it (lib/access-list.ts gateMaterial). */
  gate: string | null;
  etag: string | null | undefined;
  nowMs: number;
}): Promise<string> {
  if (!usableSecret(opts.secret) || typeof opts.etag !== "string" || opts.etag === "" || opts.etag.length > 100) return "";
  const gate = await pageGate(opts.secret, opts.id, opts.gate);
  const token = await mintWatchToken(opts.secret, opts.id, Math.floor(opts.nowMs / 1000) + VIEWER_TOKEN_SECONDS, gate);
  return liveReloadScript({ origin: opts.origin, id: opts.id, token, etag: opts.etag });
}
