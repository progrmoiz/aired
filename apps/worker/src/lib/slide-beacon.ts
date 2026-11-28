/**
 * Per-slide analytics for decks: the small script a deck's viewer gets, and
 * who gets it.
 *
 * The deck viewer (lib/deck.ts) shows one slide at a time and marks the
 * others `aired-off`. This script watches those marks, so it works with
 * every deck already published (their viewer is stored with their HTML).
 * When a slide that was on screen for at least a second is left, or the tab
 * is hidden or closed, it sends one beacon with that slide's number and how
 * long it was showing (time with the tab hidden doesn't count), through
 * navigator.sendBeacon, falling back to a keepalive fetch. `first` marks the
 * first time this page load showed that slide, which is what "reached"
 * counts (lib/slide-analytics.ts).
 *
 * The beacon carries a slide token (lib/collect-token.ts): one page, its
 * gate and an expiry, no viewer. It's text/plain JSON, a simple request from
 * the page's opaque origin, so no preflight; the route reads no cookies.
 *
 * Who gets it (slideBeaconWanted): decks only, in an account (an anonymous
 * deck has nobody to show the numbers to), whose owner is on Pro (nothing is
 * collected for Free, so the cost follows paying accounts), and not when
 * the signed-in owner opens their own deck. Headless browsers
 * (navigator.webdriver) send nothing.
 */

import { SLIDE_TOKEN_SECONDS } from "./collect-limits.ts";
import { mintSlideToken, pageGate, usableSecret } from "./collect-token.ts";
import { scriptJson } from "./collect-runtime.ts";
import { SLIDE_MAX_MS, SLIDE_MIN_MS } from "./slide-event.ts";

/** Beacons one page load sends at most, whatever happens; the route caps each page's day too. */
const MAX_PER_LOAD = 500;

/** Whether served HTML is a deck: the viewer is stored with a deck's HTML at publish (lib/deck.ts injectDeckRuntime). */
export function servedIsDeck(html: string): boolean {
  return html.includes('<script id="aired-deck-js">');
}

export function slideBeaconWanted(opts: { html: string; ownerId: number | null; viewerId: number | null; plan: "free" | "pro" }): boolean {
  if (opts.ownerId === null || opts.plan !== "pro") return false;
  if (opts.viewerId !== null && opts.viewerId === opts.ownerId) return false;
  return servedIsDeck(opts.html);
}

export type SlideBeaconConfig = { origin: string; id: string; token: string };

/** The script a deck gets (after the sandbox shim, before the page's own scripts). */
export function slideBeaconScript(cfg: SlideBeaconConfig): string {
  const S = { url: `${cfg.origin}/c/${encodeURIComponent(cfg.id)}/slide`, token: cfg.token };
  return `<script>(function(){
var S=${scriptJson(S)},d=document,nav=navigator;
if(nav.webdriver)return;
var cur=0,t0=0,acc=0,seen={},sent=0;
function send(n,ms){if(!n||ms<${SLIDE_MIN_MS}||sent>=${MAX_PER_LOAD})return;sent++;var first=!seen[n];seen[n]=1;
var b=JSON.stringify({token:S.token,slide:n,ms:Math.round(Math.min(ms,${SLIDE_MAX_MS})),first:first});
try{if(nav.sendBeacon&&nav.sendBeacon(S.url,new Blob([b],{type:"text/plain"})))return}catch(e){}
try{fetch(S.url,{method:"POST",body:b,headers:{"Content-Type":"text/plain"},credentials:"omit",keepalive:true}).catch(function(){})}catch(e){}}
function showing(){var s=d.querySelector("[data-aired-slide]:not(.aired-off)");return s?parseInt(s.getAttribute("data-aired-slide"),10)||0:0}
function pause(){if(t0){acc+=Date.now()-t0;t0=0}if(acc>=${SLIDE_MIN_MS}){send(cur,acc);acc=0}}
function look(){var n=showing();if(n===cur)return;if(t0)acc+=Date.now()-t0;send(cur,acc);acc=0;cur=n;t0=n&&d.visibilityState!=="hidden"?Date.now():0}
function start(){var all=d.querySelectorAll("[data-aired-slide]");if(!all.length||typeof MutationObserver==="undefined")return;
var mo=new MutationObserver(look);for(var i=0;i<all.length;i++)mo.observe(all[i],{attributes:true,attributeFilter:["class"]});
look();
d.addEventListener("visibilitychange",function(){if(d.visibilityState==="hidden")pause();else if(cur&&!t0)t0=Date.now()});
addEventListener("pagehide",pause)}
if(d.readyState==="loading")d.addEventListener("DOMContentLoaded",start);else start();
})();</script>`;
}

/**
 * The beacon script for a deck being served, or "" when it shouldn't get
 * one (slideBeaconWanted) or there's no secret to sign with.
 */
export async function slideBeaconFor(opts: {
  secret: string;
  origin: string;
  id: string;
  html: string;
  ownerId: number | null;
  viewerId: number | null;
  plan: "free" | "pro";
  /** The page's gate material (lib/access-list.ts gateMaterial). */
  gate: string | null;
  nowMs: number;
}): Promise<string> {
  if (!usableSecret(opts.secret) || !slideBeaconWanted(opts)) return "";
  const gate = await pageGate(opts.secret, opts.id, opts.gate);
  const token = await mintSlideToken(opts.secret, opts.id, Math.floor(opts.nowMs / 1000) + SLIDE_TOKEN_SECONDS, gate);
  return slideBeaconScript({ origin: opts.origin, id: opts.id, token });
}
