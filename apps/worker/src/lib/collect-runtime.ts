/**
 * window.aired, the data layer's script API, put into a published page
 * before its own scripts (like the sandbox shim). Only pages whose HTML
 * says `aired.collect` or `aired.data` get it (usesDataLayer), so every
 * other page is served as before, with no cookie and no token.
 *
 *   aired.collect.save(record, { key })  → Promise<entry>
 *   aired.collect.mine()                 → Promise<entry[]>  this viewer's own
 *   aired.collect.all()                  → Promise<entry[]>  everyone's, when the owner made results public
 *   aired.collect.remove(idOrKey)        → Promise<boolean>
 *   aired.collect.notice                 the sentence to show viewers
 *   aired.data.get()                     → Promise<data | null>  what update_data pushed
 *   aired.data.subscribe(fn)             → unsubscribe; fn(data) now and on every push
 *   aired.viewer                         this viewer's id on this page
 *
 * The token (lib/collect-token.ts) lives in this closure. Calls go to
 * /c/:id/* as text/plain POSTs: a simple CORS request, so no preflight, and
 * no cookies (the page's origin is opaque). Errors reject with an Error
 * whose .code says why (sign_in_required, closed, limit, rate_limited,
 * blocked, too_large, invalid_record, private, expired, unavailable).
 *
 * Elements with a data-aired-notice attribute get the notice text.
 */

import { LIVE_DATA_POLL_SECONDS } from "./collect-limits.ts";

/** Whether the page uses the data layer: it names aired.collect or aired.data. */
export function usesDataLayer(html: string): boolean {
  return /\baired\s*\.\s*(?:collect|data)\b/.test(html);
}

export const VIEWER_NOTICE = "This page saves what you enter here. Its owner can see it.";

export type RuntimeConfig =
  | { enabled: true; origin: string; id: string; token: string; viewer: string }
  | { enabled: false; reason: "sign_in_required" };

/** A JSON value safe inside <script>: no </script>, no <!--, no line separators. */
function scriptJson(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function collectRuntime(config: RuntimeConfig): string {
  const cfg = config.enabled
    ? { on: true, base: `${config.origin}/c/${encodeURIComponent(config.id)}`, token: config.token, viewer: config.viewer }
    : { on: false, reason: config.reason };
  return `<script>(function(){
var C=${scriptJson(cfg)},F=window.fetch&&window.fetch.bind(window),N=${scriptJson(VIEWER_NOTICE)};
function fail(code,msg){var e=new Error(msg||code);e.code=code;return e}
function call(op,body){
if(!C.on)return Promise.reject(fail(C.reason,"This page needs an owner signed in to aired to save data. Publish it from an aired account."));
if(!F)return Promise.reject(fail("unavailable","fetch is not available"));
var b={token:C.token};for(var k in body)b[k]=body[k];
return F(C.base+"/"+op,{method:"POST",headers:{"Content-Type":"text/plain"},body:JSON.stringify(b),credentials:"omit",cache:"no-store"})
.then(function(r){return r.json().catch(function(){return{}}).then(function(j){if(!r.ok)throw fail(j.code||"unavailable",j.error||("aired answered "+r.status));return j})},
function(){throw fail("unavailable","Couldn't reach aired. Check the connection and try again.")})}
var collect={notice:N,
save:function(record,opts){return call("save",{record:record,key:opts&&opts.key!=null?opts.key:null}).then(function(j){return j.entry})},
mine:function(){return call("mine",{}).then(function(j){return j.entries})},
all:function(){return call("all",{}).then(function(j){return j.entries})},
remove:function(idOrKey){return call("remove",{id:String(idOrKey)}).then(function(j){return j.removed})}};
var ver=-1,last=null,subs=[],timer=null;
function pull(){return call("data",{since:ver}).then(function(j){if(j.changed!==false){ver=j.version;last=j.data;
for(var i=0;i<subs.length;i++){try{subs[i](last)}catch(e){setTimeout(function(){throw e})}}
try{window.dispatchEvent(new CustomEvent("aired:data",{detail:last}))}catch(_){}}return last})}
function tick(){if(document.visibilityState!=="hidden")pull().catch(function(){})}
function start(){if(timer||!C.on)return;timer=setInterval(tick,${LIVE_DATA_POLL_SECONDS * 1000});
document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")tick()})}
var data={get:function(){return ver>=0?Promise.resolve(last):pull()},
subscribe:function(fn){if(typeof fn!=="function")throw new TypeError("subscribe takes a function");subs.push(fn);
if(ver>=0){try{fn(last)}catch(e){setTimeout(function(){throw e})}}else pull().catch(function(){});start();
return function(){subs=subs.filter(function(f){return f!==fn})}}};
var a=window.aired&&typeof window.aired==="object"?window.aired:{};a.collect=collect;a.data=data;a.viewer=C.on?C.viewer:null;window.aired=a;
function notice(){var els=document.querySelectorAll("[data-aired-notice]");for(var i=0;i<els.length;i++)if(!els[i].textContent)els[i].textContent=N}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",notice);else notice();
})();</script>`;
}
