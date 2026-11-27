/**
 * Link-preview screenshots: the rules, importing only origin.ts (which has no
 * imports), so tests load them directly. The browser work is in og-render.ts.
 *
 * After a publish or update, the page is drawn in a browser and stored next
 * to its HTML:
 *   - `pages/<id>/shot.jpg`, 1200×630: the link preview GET /og/:id serves
 *     instead of the title card. Only for pages anyone may see: a page with a
 *     PIN or a view limit never gets one (it would show what the PIN hides, or
 *     a crawler would spend views) and keeps the card.
 *   - `pages/<id>/tile.jpg`, 1200×800: the owner's dashboard tile, served
 *     only by the owner-only GET /api/me/pages/:id/tile. PIN and view-limited
 *     pages get one too, since only their owner can fetch it.
 *   - a tiny blurred placeholder (a JPEG data URI of about 1 KB) kept in D1
 *     `page_shots` with the HTML etag the images were taken from. The page
 *     list sends both, so tiles blur up at once and cache the image by version.
 * Pages over SHOT_MAX_BYTES get neither.
 *
 * Browser Rendering is metered: Workers Free allows 10 minutes a day, 3
 * browsers at once and 1 new browser every 20 seconds; Workers Paid includes
 * 10 hours a month, then $0.09 an hour. aired spends at most a daily budget
 * (OG_SHOT_DAILY_SECONDS, default 8 minutes) and, after a 429, stops trying
 * until the limit lifts. A page that misses out keeps the card: no retries.
 */

import { PRODUCTION_ORIGIN } from "./origin.ts";

export const SHOT_WIDTH = 1200;
export const SHOT_HEIGHT = 630;
/** Dashboard tiles are 3:2, drawn at the width pages are previewed at. */
export const TILE_HEIGHT = 800;
export const TILE_QUALITY = 75;
/** The placeholder is the tile at this scale: 24×16 pixels. */
export const PLACEHOLDER_SCALE = 0.02;
export const PLACEHOLDER_QUALITY = 50;
/** A failed or skipped render isn't tried again from the dashboard for a day. */
export const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
/** Pages the dashboard may ask to backfill in one request (one browser, in turn). */
export const BACKFILL_MAX = 3;
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

/**
 * The origin the browser is shown the page at. Browser Rendering refuses
 * local addresses (net::ERR_BLOCKED_BY_ADMINISTRATOR) before any request
 * interception, so a local SITE_ORIGIN (wrangler dev) renders at aired.sh
 * instead; the stored HTML is still what's served, and aired.sh itself
 * stays blocked.
 */
export function renderOrigin(origin: string): string {
  try {
    const host = new URL(origin).hostname;
    const local = host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || /^127\./.test(host) || /^(10|192\.168)\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "0.0.0.0";
    return local ? PRODUCTION_ORIGIN : origin;
  } catch {
    return PRODUCTION_ORIGIN;
  }
}

export function shotKey(id: string): string {
  return `pages/${id}/shot.jpg`;
}

export function tileKey(id: string): string {
  return `pages/${id}/tile.jpg`;
}

export type ShotPage = {
  pin: string | null;
  reads: number | null;
  size: number;
  permanent: boolean;
  expiresAt: string | null;
};

/** Whether this page is drawn at all (its owner's tile): live and not too big. */
export function renderAllowed(page: ShotPage, nowMs: number): boolean {
  if (page.size > SHOT_MAX_BYTES) return false;
  if (!page.permanent && page.expiresAt !== null) {
    const exp = Date.parse(page.expiresAt);
    if (Number.isFinite(exp) && exp <= nowMs) return false;
  }
  return true;
}

/**
 * Whether this page may have a public link-preview screenshot, both when
 * taking and when serving it: never with a PIN or a view limit.
 */
export function shotAllowed(page: ShotPage, nowMs: number): boolean {
  if (page.pin !== null || page.reads !== null) return false;
  return renderAllowed(page, nowMs);
}

/** A page's D1 page_shots row. lqip null: tried (or being tried), no images yet. */
export type ShotRow = { htmlEtag: string | null; lqip: string | null; triedAt: number };

/** What the page list tells the dashboard: the tile's version and placeholder, or null. */
export function tileInfo(row: ShotRow | undefined): { v: string; lqip: string } | null {
  if (row === undefined || row.lqip === null || row.htmlEtag === null) return null;
  return { v: versionFromEtag(row.htmlEtag), lqip: row.lqip };
}

/** Whether the dashboard may ask for this page to be drawn now. */
export function needsBackfill(row: ShotRow | undefined, nowMs: number): boolean {
  if (row === undefined) return true;
  if (row.lqip !== null) return false;
  return nowMs - row.triedAt >= RETRY_AFTER_MS;
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

/**
 * Cache-Control for the owner's tile. Asked for by its own version, the image
 * never changes (an update gives it a new version), so tab switches and
 * reloads never fetch it again. It's private: never kept by a shared cache.
 */
export function tileCacheControl(versionMatches: boolean): string {
  return versionMatches ? "private, max-age=31536000, immutable" : "private, max-age=60";
}

type Db = { prepare(q: string): { bind(...v: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<unknown> } } };

/** The D1 og_shot_budget row all browser time adds to (screenshots and checks). */
export const BUDGET_ROW = "browser";

/**
 * A row of D1 og_shot_budget, or null when there's none yet. A D1 error
 * throws, which skips the shot or check. Typed structurally, so this file
 * keeps no runtime imports.
 */
export async function readBudget(db: Db, name: string = BUDGET_ROW): Promise<BudgetState | null> {
  const row = await db
    .prepare("SELECT day, spent_ms, blocked_until FROM og_shot_budget WHERE name = ?")
    .bind(name)
    .first<{ day: string; spent_ms: number; blocked_until: number }>();
  return row === null ? null : { day: row.day, spentMs: row.spent_ms, blockedUntil: row.blocked_until };
}

export async function addSpent(db: Db, ms: number, nowMs: number, name: string = BUDGET_ROW): Promise<void> {
  await db
    .prepare(
      // ms may be negative (a check settling its reservation); spent time never goes below 0.
      "INSERT INTO og_shot_budget (name, day, spent_ms, blocked_until) VALUES (?, ?, MAX(0, ?), 0) " +
        "ON CONFLICT (name) DO UPDATE SET spent_ms = CASE WHEN og_shot_budget.day = excluded.day " +
        "THEN MAX(0, og_shot_budget.spent_ms + ?) ELSE excluded.spent_ms END, day = excluded.day",
    )
    .bind(name, utcDay(nowMs), ms, ms)
    .run();
}

export async function setBlocked(db: Db, until: number, name: string = BUDGET_ROW): Promise<void> {
  await db
    .prepare(
      "INSERT INTO og_shot_budget (name, day, spent_ms, blocked_until) VALUES (?, ?, 0, ?) " +
        "ON CONFLICT (name) DO UPDATE SET blocked_until = MAX(og_shot_budget.blocked_until, excluded.blocked_until)",
    )
    .bind(name, utcDay(Date.now()), until)
    .run();
}
