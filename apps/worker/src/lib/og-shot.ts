/**
 * Link-preview screenshots: the rules, with no runtime imports so tests load
 * them directly. The browser work is in og-render.ts.
 *
 * After a publish or update, a 1200×630 JPEG of the page is stored next to
 * its HTML (`pages/<id>/shot.jpg`) and GET /og/:id serves it instead of the
 * title card. Pages with a PIN or a view limit never get one (the image would
 * show what the PIN hides, or a crawler would spend views), nor do pages over
 * SHOT_MAX_BYTES. They keep the card.
 *
 * Browser Rendering is metered: Workers Free allows 10 minutes a day, 3
 * browsers at once and 1 new browser every 20 seconds; Workers Paid includes
 * 10 hours a month, then $0.09 an hour. aired spends at most a daily budget
 * (OG_SHOT_DAILY_SECONDS, default 8 minutes) and, after a 429, stops trying
 * until the limit lifts. A page that misses out keeps the card: no retries.
 */

export const SHOT_WIDTH = 1200;
export const SHOT_HEIGHT = 630;
export const SHOT_CONTENT_TYPE = "image/jpeg";
export const SHOT_QUALITY = 80;

/** Bigger pages keep the card: they are slow to render and rarely worth it. */
export const SHOT_MAX_BYTES = 1024 * 1024;

/** Longest a render may hold a browser before it's closed. */
export const RENDER_TIMEOUT_MS = 15_000;
/** How long to wait for the page's load event before taking the shot anyway. */
export const LOAD_TIMEOUT_MS = 8_000;

/** Default daily browser time for screenshots: 8 of Workers Free's 10 minutes. */
export const DEFAULT_DAILY_BUDGET_MS = 8 * 60 * 1000;

/** After a 429 that isn't the daily limit (too many browsers, or one too soon). */
export const RATE_LIMIT_BACKOFF_MS = 60_000;

export function shotKey(id: string): string {
  return `pages/${id}/shot.jpg`;
}

export type ShotPage = {
  pin: string | null;
  reads: number | null;
  size: number;
  permanent: boolean;
  expiresAt: string | null;
};

/** Whether this page may have a screenshot, both when taking and serving it. */
export function shotAllowed(page: ShotPage, nowMs: number): boolean {
  if (page.pin !== null || page.reads !== null) return false;
  if (page.size > SHOT_MAX_BYTES) return false;
  if (!page.permanent && page.expiresAt !== null) {
    const exp = Date.parse(page.expiresAt);
    if (Number.isFinite(exp) && exp <= nowMs) return false;
  }
  return true;
}

/** OG_SHOT_DAILY_SECONDS as milliseconds. "0" turns screenshots off; junk means the default. */
export function dailyBudgetMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_DAILY_BUDGET_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_DAILY_BUDGET_MS;
  return Math.floor(n * 1000);
}

/** The UTC day, as Browser Rendering's daily limit counts it. */
export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export type BudgetState = { day: string; spentMs: number; blockedUntil: number };

/** Whether a screenshot may start now. No state yet means nothing was spent. */
export function budgetAllows(state: BudgetState | null, nowMs: number, capMs: number): boolean {
  if (capMs <= 0) return false;
  if (state === null) return true;
  if (nowMs < state.blockedUntil) return false;
  const spent = state.day === utcDay(nowMs) ? state.spentMs : 0;
  return spent < capMs;
}

/**
 * When a failed browser launch means Browser Rendering said no: the time to
 * try again (next UTC day for the daily limit, a minute for the others).
 * null for any other error, which only costs that one page its screenshot.
 */
export function blockAfterError(message: string, nowMs: number): number | null {
  if (/time limit exceeded/i.test(message)) {
    const d = new Date(nowMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  }
  if (/\b429\b|too many|rate limit/i.test(message)) return nowMs + RATE_LIMIT_BACKOFF_MS;
  return null;
}

/**
 * The `?v=` on og:image, from the page HTML's R2 etag. An update changes it,
 * so link previews that cache images by URL fetch the new screenshot.
 */
export function versionFromEtag(etag: string): string {
  return etag.replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
}

/**
 * Cache-Control for GET /og/:id. A screenshot asked for by its own version
 * keeps for an hour; anything else (the card, an old or missing version) for
 * five minutes, so a screenshot that lands a few seconds after publishing, or
 * a deleted page, shows up soon.
 */
export function ogCacheControl(kind: "shot" | "card", versionMatches: boolean): string {
  return kind === "shot" && versionMatches
    ? "public, max-age=3600"
    : "public, max-age=300";
}
