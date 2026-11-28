/**
 * The one Analytics Engine data point a slide beacon writes (dataset
 * `aired_slides`, binding SLIDES), read back by lib/slide-analytics.ts for
 * a Pro deck's owner. A beacon comes from a deck's viewer when a slide that
 * was on screen for at least a second is left (lib/slide-beacon.ts). It
 * holds exactly:
 *
 *   index1  page id (Analytics Engine samples per index, so each deck's
 *           numbers stay accurate however busy other pages are)
 *   blob1   page id
 *   blob2   UTC day, YYYY-MM-DD
 *   double1 slide number, from 1
 *   double2 seconds on the slide, in buckets (dwellBucket)
 *   double3 1 the first time this page load showed the slide, else 0
 *
 * Its own dataset rather than more fields on `aired_views`: every views
 * query sums all of a page's rows as views, so slide rows there would count
 * as views (or every one of those queries would need a filter forever).
 * Writes cost the same either way.
 *
 * Nothing about the viewer: no IP, no cookie, no viewer id, no user agent,
 * no referrer. slideEvent never sees the request.
 *
 * No imports, so tests load it directly.
 */

export const SLIDES_DATASET = "aired_slides";

/** The highest slide number a beacon may name: a deck's most slides (lib/deck.ts MAX_SLIDES). */
export const SLIDE_MAX_SLIDE = 300;

/** A slide counts once it has been on screen this long. */
export const SLIDE_MIN_MS = 1000;

/** Dwell past this is kept as this: a tab left open isn't a half-day read. */
export const SLIDE_MAX_MS = 30 * 60 * 1000;

export type SlideBeacon = { slide: number; ms: number; first: boolean };

export type SlideDataPoint = { indexes: [string]; blobs: [string, string]; doubles: [number, number, number] };

/**
 * Seconds on a slide, rounded into buckets so a deck's numbers stay a few
 * hundred rows: whole seconds to 10, then 5 s steps to a minute, 15 s steps
 * to 5 minutes, and whole minutes to 30.
 */
export function dwellBucket(ms: number): number {
  const s = Math.min(Math.max(ms, SLIDE_MIN_MS), SLIDE_MAX_MS) / 1000;
  const step = s < 10.5 ? 1 : s < 60 ? 5 : s < 300 ? 15 : 60;
  return Math.max(1, Math.min(Math.round(s / step) * step, SLIDE_MAX_MS / 1000));
}

/** A beacon's fields, checked: a whole slide number in range, at least a second on screen. */
export function parseBeacon(body: Record<string, unknown>): { ok: true; beacon: SlideBeacon } | { ok: false; error: string } {
  const { slide, ms, first } = body;
  if (typeof slide !== "number" || !Number.isInteger(slide) || slide < 1 || slide > SLIDE_MAX_SLIDE) {
    return { ok: false, error: `slide must be a whole number from 1 to ${SLIDE_MAX_SLIDE}.` };
  }
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < SLIDE_MIN_MS) {
    return { ok: false, error: `ms must be a number of milliseconds, at least ${SLIDE_MIN_MS}.` };
  }
  return { ok: true, beacon: { slide, ms: Math.min(Math.round(ms), SLIDE_MAX_MS), first: first === true } };
}

export function slideEvent(input: { pageId: string; beacon: SlideBeacon; nowMs: number }): SlideDataPoint {
  return {
    indexes: [input.pageId],
    blobs: [input.pageId, new Date(input.nowMs).toISOString().slice(0, 10)],
    doubles: [input.beacon.slide, dwellBucket(input.beacon.ms), input.beacon.first ? 1 : 0],
  };
}
