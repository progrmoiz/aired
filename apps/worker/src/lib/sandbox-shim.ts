/**
 * Served pages are sandboxed into an opaque origin (see PAGE_CSP), where
 * touching localStorage, sessionStorage or document.cookie throws a
 * SecurityError. Many published pages (games saving scores, todo apps) use
 * them without a try/catch and would crash on load.
 *
 * This script runs before any page script and swaps in in-memory versions
 * when the real ones throw, so pages keep working. Data lasts until the tab
 * reloads.
 */
export const SANDBOX_SHIM = `<script>(function(){
function mem(){var d=Object.create(null);return{
getItem:function(k){k=String(k);return k in d?d[k]:null},
setItem:function(k,v){d[String(k)]=String(v)},
removeItem:function(k){delete d[String(k)]},
clear:function(){d=Object.create(null)},
key:function(i){var k=Object.keys(d)[i];return k===undefined?null:k},
get length(){return Object.keys(d).length}}}
["localStorage","sessionStorage"].forEach(function(n){
try{window[n].getItem("x")}catch(e){try{Object.defineProperty(window,n,{value:mem(),configurable:true})}catch(_){}}});
try{document.cookie}catch(e){var jar=Object.create(null);try{Object.defineProperty(document,"cookie",{configurable:true,
get:function(){return Object.keys(jar).map(function(k){return k+"="+jar[k]}).join("; ")},
set:function(v){var parts=String(v).split(";"),kv=parts[0],i=kv.indexOf("=");if(i<1)return;
var k=kv.slice(0,i).trim(),val=kv.slice(i+1).trim(),attrs=parts.slice(1).join(";").toLowerCase();
var m=/max-age=\\s*(-?\\d+)/.exec(attrs),x=/expires=([^;]+)/.exec(attrs);
if((m&&+m[1]<=0)||(x&&Date.parse(x[1])<=Date.now()))delete jar[k];else jar[k]=val}})}catch(_){}}
})();</script>`;

/**
 * Inserts a script as early as possible in the document: right after <head>,
 * else after <html>, else after the doctype, else at the very start. Never
 * before the doctype, which would switch the page into quirks mode.
 */
export function injectEarlyScript(html: string, script: string): string {
  for (const pattern of [/<head(?:\s[^>]*)?>/i, /<html(?:\s[^>]*)?>/i, /^\s*<!doctype[^>]*>/i]) {
    const match = pattern.exec(html);
    if (match) {
      const end = match.index + match[0].length;
      return html.slice(0, end) + script + html.slice(end);
    }
  }
  return script + html;
}
