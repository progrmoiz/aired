import { addSpent, budgetAllows, dailyBudgetMs, readBudget } from "./og-shot.ts";

/**
 * check_page / `aired check`: load a published page in Browser Rendering and
 * say whether it works. The rules, the budget and the report live here (its
 * only import is og-shot.ts, which has none), so tests load them directly. The browser work is checkPage in
 * og-render.ts, the route is POST /api/pages/:id/check in routes/page-tools.ts.
 *
 * Browser time is shared with the link-preview screenshots (og-shot.ts): both
 * add to the "browser" budget row, which stops at OG_SHOT_DAILY_SECONDS.
 * Checks also have their own row and cap (CHECK_DAILY_SECONDS, default 3
 * minutes), so a run of checks can never use the time link previews need.
 */

/** Desktop and phone viewports a check can render at. */
export const CHECK_VIEWPORTS = {
  desktop: { width: 1280, height: 800, isMobile: false, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, isMobile: true, deviceScaleFactor: 1 },
} as const;
export type CheckViewport = keyof typeof CHECK_VIEWPORTS;

/** How long to wait for the load event before reporting a slow load. */
export const CHECK_LOAD_TIMEOUT_MS = 10_000;
/** After load, how long late errors (timers, fetches) still count. */
export const CHECK_SETTLE_MS = 1_500;
/** Longest a check may hold a browser. */
export const CHECK_TIMEOUT_MS = 25_000;
export const CHECK_SHOT_QUALITY = 70;
/** A check's screenshot URL works this long. */
export const CHECK_SHOT_TTL_MS = 24 * 60 * 60 * 1000;

/** Default daily browser time for checks: 3 of the 8 minutes screenshots may use. */
export const DEFAULT_CHECK_BUDGET_MS = 3 * 60 * 1000;
export const CHECK_BUDGET_ROW = "check";

/** Warnings, not errors: the page works but is heavy. */
export const HEAVY_HTML_BYTES = 1024 * 1024;
export const HEAVY_TRANSFER_BYTES = 5 * 1024 * 1024;
export const TALL_PAGE_PX = 30_000;

/** Caps on what a report carries, so one noisy page can't fill an agent's context. */
export const MAX_CONSOLE = 20;
export const MAX_REQUESTS = 20;
export const MAX_TEXT = 300;

export function checkShotKey(id: string): string {
  return `pages/${id}/check.jpg`;
}

/** CHECK_DAILY_SECONDS as ms, never more than the whole browser budget. "0" turns checks off. */
export function checkBudgetMs(raw: string | undefined, totalMs: number): number {
  let ms = DEFAULT_CHECK_BUDGET_MS;
  if (raw !== undefined && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) ms = Math.floor(n * 1000);
  }
  return Math.max(0, Math.min(ms, totalMs));
}

/** Why a check didn't run: the daily budget, Browser Rendering said no, or there's no browser here. */
export class CheckUnavailable extends Error {
  readonly reason: "budget" | "busy" | "no_browser";
  readonly waitSeconds: number | null;
  constructor(reason: "budget" | "busy" | "no_browser", waitSeconds: number | null) {
    super(reason);
    this.reason = reason;
    this.waitSeconds = waitSeconds;
  }
}

type BudgetDb = Parameters<typeof readBudget>[0];
export type BudgetVars = { OG_SHOT_DAILY_SECONDS?: string; CHECK_DAILY_SECONDS?: string };

/**
 * Whether a check may start now: the shared browser budget and the checks'
 * own share both have time left today, and Browser Rendering isn't blocking
 * us. Throws CheckUnavailable("budget") with the seconds to midnight UTC.
 */
export async function checkGate(db: BudgetDb, vars: BudgetVars, nowMs: number): Promise<void> {
  const total = dailyBudgetMs(vars.OG_SHOT_DAILY_SECONDS);
  const [all, checks] = await Promise.all([readBudget(db), readBudget(db, CHECK_BUDGET_ROW)]);
  if (!budgetAllows(all, nowMs, total) || !budgetAllows(checks, nowMs, checkBudgetMs(vars.CHECK_DAILY_SECONDS, total))) {
    const blockedFor = all !== null && nowMs < all.blockedUntil ? Math.ceil((all.blockedUntil - nowMs) / 1000) : null;
    throw new CheckUnavailable("budget", blockedFor ?? secondsToNextUtcDay(nowMs));
  }
}

/** A check's browser time counts against both the shared budget and the checks' share. */
export async function recordCheckTime(db: BudgetDb, ms: number, nowMs: number): Promise<void> {
  await Promise.all([addSpent(db, ms, nowMs), addSpent(db, ms, nowMs, CHECK_BUDGET_ROW)]);
}

export function secondsToNextUtcDay(nowMs: number): number {
  const d = new Date(nowMs);
  return Math.max(1, Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - nowMs) / 1000));
}

/** A viewport name from user input; anything else is refused. */
export function parseViewport(v: unknown): CheckViewport | null {
  if (v === undefined || v === null || v === "") return "desktop";
  return v === "desktop" || v === "mobile" ? v : null;
}

/** What the browser saw, collected by checkPage. */
export type CheckObservations = {
  loadMs: number;
  /** The load event fired before CHECK_LOAD_TIMEOUT_MS. */
  loaded: boolean;
  /** Why the document itself failed to load (not a timeout), or null. */
  loadError: string | null;
  console: { level: "error" | "warning"; text: string; source: string | null }[];
  pageErrors: string[];
  failedRequests: { url: string; status: number | null; error: string | null; type: string }[];
  /** The page tried to navigate the whole tab somewhere else. */
  navigationsBlocked: string[];
  dom: {
    title: string | null;
    textChars: number;
    visibleMedia: number;
    brokenImages: number;
    scrollWidth: number;
    scrollHeight: number;
    /** The screen's width in CSS pixels (the check's viewport, not what the page widened it to). */
    viewportWidth: number;
    /** A <meta name="viewport"> is present (phones need it to show the page at their width). */
    hasViewportMeta: boolean;
    transferBytes: number;
    resourceCount: number;
  } | null;
};

export type CheckIssue = { severity: "error" | "warning"; code: string; message: string };

export type CheckReport = {
  id: string;
  url: string;
  ok: boolean;
  viewport: CheckViewport;
  checked_at: string;
  load_ms: number;
  issues: CheckIssue[];
  console: { level: "error" | "warning"; text: string; source: string | null }[];
  failed_requests: { url: string; status: number | null; error: string | null; type: string }[];
  page: {
    title: string | null;
    html_bytes: number;
    text_chars: number;
    visible_media: number;
    width: number;
    height: number;
    transfer_bytes: number;
    requests: number;
  };
  blank: boolean;
  screenshot_url: string | null;
  screenshot_expires_at: string | null;
};

const clip = (s: string, n = MAX_TEXT): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The report for one check. ok: no errors (warnings are fine). */
export function buildReport(input: {
  id: string;
  url: string;
  viewport: CheckViewport;
  htmlBytes: number;
  obs: CheckObservations;
  now: number;
  screenshotUrl: string | null;
}): CheckReport {
  const { obs } = input;
  const dom = obs.dom;
  const issues: CheckIssue[] = [];

  const consoleErrors = obs.console.filter((m) => m.level === "error");
  if (obs.pageErrors.length > 0) {
    issues.push({ severity: "error", code: "script_error", message: `${plural(obs.pageErrors.length, "uncaught script error")}: ${clip(obs.pageErrors[0]!, 160)}` });
  }
  if (consoleErrors.length > 0) {
    issues.push({ severity: "error", code: "console_error", message: `${plural(consoleErrors.length, "console error")}: ${clip(consoleErrors[0]!.text, 160)}` });
  }
  if (obs.failedRequests.length > 0) {
    const f = obs.failedRequests[0]!;
    issues.push({
      severity: "error",
      code: "failed_request",
      message: `${plural(obs.failedRequests.length, "file")} didn't load, e.g. ${clip(f.url, 120)} (${f.status !== null ? `HTTP ${f.status}` : f.error ?? "failed"})`,
    });
  }
  if (dom !== null && dom.brokenImages > 0) {
    issues.push({ severity: "error", code: "broken_image", message: `${plural(dom.brokenImages, "image")} failed to show` });
  }
  const blank = obs.loadError !== null || dom === null || (dom.textChars === 0 && dom.visibleMedia === 0);
  if (obs.loadError !== null) {
    issues.push({ severity: "error", code: "no_render", message: `The page didn't load: ${clip(obs.loadError, 160)}` });
  } else if (dom === null) {
    issues.push({ severity: "error", code: "no_render", message: "The page didn't render at all" });
  } else if (blank) {
    issues.push({ severity: "error", code: "blank", message: "The page renders blank: no visible text, images, canvas or SVG" });
  }
  if (obs.navigationsBlocked.length > 0) {
    issues.push({ severity: "warning", code: "navigates_away", message: `The page tries to leave for ${clip(obs.navigationsBlocked[0]!, 120)}` });
  }
  if (!obs.loaded && obs.loadError === null) {
    issues.push({ severity: "warning", code: "slow_load", message: `The page hadn't finished loading after ${CHECK_LOAD_TIMEOUT_MS / 1000} seconds` });
  }
  if (input.htmlBytes > HEAVY_HTML_BYTES) {
    issues.push({ severity: "warning", code: "heavy_html", message: `The HTML is ${mb(input.htmlBytes)}: it may load slowly on phones` });
  }
  if (dom !== null && dom.transferBytes > HEAVY_TRANSFER_BYTES) {
    issues.push({ severity: "warning", code: "heavy_page", message: `The page downloads ${mb(dom.transferBytes)} of files` });
  }
  if (dom !== null && dom.scrollHeight > TALL_PAGE_PX) {
    issues.push({ severity: "warning", code: "very_tall", message: `The page is ${dom.scrollHeight} px tall` });
  }
  if (dom !== null && input.viewport === "mobile" && !dom.hasViewportMeta) {
    issues.push({ severity: "warning", code: "no_viewport_meta", message: 'No <meta name="viewport" content="width=device-width, initial-scale=1">: phones show the page zoomed out' });
  }
  if (dom !== null && dom.scrollWidth > dom.viewportWidth + 1) {
    issues.push({ severity: "warning", code: "too_wide", message: `The page is ${dom.scrollWidth} px wide on a ${dom.viewportWidth} px screen, so it scrolls sideways` });
  }
  const warnings = obs.console.filter((m) => m.level === "warning");
  if (warnings.length > 0) {
    issues.push({ severity: "warning", code: "console_warning", message: `${plural(warnings.length, "console warning")}: ${clip(warnings[0]!.text, 160)}` });
  }

  return {
    id: input.id,
    url: input.url,
    ok: !issues.some((i) => i.severity === "error"),
    viewport: input.viewport,
    checked_at: new Date(input.now).toISOString(),
    load_ms: Math.round(obs.loadMs),
    issues,
    console: [
      ...obs.pageErrors.map((text) => ({ level: "error" as const, text: clip(text), source: null })),
      ...obs.console.map((m) => ({ ...m, text: clip(m.text), source: m.source === null ? null : clip(m.source, 200) })),
    ].slice(0, MAX_CONSOLE),
    failed_requests: obs.failedRequests.slice(0, MAX_REQUESTS).map((r) => ({ ...r, url: clip(r.url, 300) })),
    page: {
      title: dom?.title ?? null,
      html_bytes: input.htmlBytes,
      text_chars: dom?.textChars ?? 0,
      visible_media: dom?.visibleMedia ?? 0,
      width: dom?.scrollWidth ?? 0,
      height: dom?.scrollHeight ?? 0,
      transfer_bytes: dom?.transferBytes ?? 0,
      requests: dom?.resourceCount ?? 0,
    },
    blank,
    screenshot_url: input.screenshotUrl,
    screenshot_expires_at: input.screenshotUrl === null ? null : new Date(input.now + CHECK_SHOT_TTL_MS).toISOString(),
  };
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One line per issue, for terminals and the tool's text. */
export function reportText(r: CheckReport): string {
  const head = r.ok
    ? `${r.url} works (${r.viewport}, loaded in ${(r.load_ms / 1000).toFixed(1)} s)`
    : `${r.url} has problems (${r.viewport})`;
  const lines = [head, ...r.issues.map((i) => `${i.severity === "error" ? "✗" : "!"} ${i.message}`)];
  if (r.issues.length === 0) lines.push("No console errors, failed files or blank screen.");
  if (r.screenshot_url !== null) lines.push(`Screenshot (24 h): ${r.screenshot_url}`);
  return lines.join("\n");
}

/**
 * Whether a screenshot request may be served: the key from the report's URL
 * matches the stored one and it hasn't expired. Constant-time comparison.
 */
export function shotKeyValid(sent: string | null | undefined, stored: string | undefined, expiresAt: string | undefined, nowMs: number): boolean {
  if (typeof sent !== "string" || typeof stored !== "string" || sent.length !== stored.length || sent.length < 16) return false;
  let diff = 0;
  for (let i = 0; i < sent.length; i++) diff |= sent.charCodeAt(i) ^ stored.charCodeAt(i);
  if (diff !== 0) return false;
  const exp = Number(expiresAt);
  return Number.isFinite(exp) && nowMs < exp;
}

/**
 * Runs in the page after load (as a string: this file has no DOM types).
 * Text that's actually on screen, visible media, broken images, size and
 * how much was downloaded.
 */
export const DOM_PROBE = `(() => {
  const body = document.body;
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05; };
  const text = body ? (body.innerText || "").replace(/\\s+/g, " ").trim() : "";
  const media = Array.from(document.querySelectorAll("img,canvas,svg,video,iframe,picture,object,embed")).filter(vis);
  const imgs = Array.from(document.images).filter((i) => i.complete && i.naturalWidth === 0 && (i.currentSrc || i.src));
  const res = performance.getEntriesByType("resource");
  const nav = performance.getEntriesByType("navigation")[0];
  const de = document.documentElement;
  return {
    title: document.title || null,
    textChars: text.length,
    visibleMedia: media.length,
    brokenImages: imgs.length,
    scrollWidth: Math.max(de.scrollWidth, body ? body.scrollWidth : 0),
    scrollHeight: Math.max(de.scrollHeight, body ? body.scrollHeight : 0),
    viewportWidth: window.innerWidth,
    hasViewportMeta: !!document.querySelector('meta[name="viewport" i]'),
    transferBytes: res.reduce((n, e) => n + (e.transferSize || e.encodedBodySize || 0), 0) + (nav ? nav.encodedBodySize || 0 : 0),
    resourceCount: res.length,
  };
})()`;
