/**
 * Per-slide analytics for a deck: how many people reached each slide, how
 * long a visit to it usually lasts, and where people stopped. Read from the
 * Analytics Engine dataset the slide beacon writes (lib/slide-event.ts)
 * through the same SQL API as views (lib/analytics.ts runQuery).
 *
 * - reached: page loads that showed the slide for at least a second
 *   (beacons with first = 1). One person opening the deck twice counts twice;
 *   there's no viewer id to tell them apart.
 * - median_seconds: the middle visit's time on the slide, revisits included,
 *   to the dwell buckets' precision (whole seconds up to 10 s).
 * - drop_off: how many fewer reached the next slide (never below 0: people
 *   who jump ahead with a #/N link can make a later slide busier). The last
 *   slide has none; `finished` is how many reached it.
 *
 * One query per report, grouped by (slide, dwell bucket, first), so a deck's
 * rows stay a few hundred however many people viewed it. Counts are
 * SUM(_sample_interval), as for views.
 *
 * Imports only import-free modules, so tests load it directly.
 */

import { checkWindow, runQuery, windowDays, type AnalyticsConfig, type FetchLike, type Window } from "./analytics.ts";
import { SLIDES_DATASET } from "./slide-event.ts";

const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** More rows than any real deck makes (300 slides × the dwell buckets × first or not). */
const ROW_LIMIT = 10_000;

export type SlideRow = { slide: number; title: string | null; reached: number; median_seconds: number | null; drop_off: number | null };

export type SlideNumbers = {
  /** The most people who reached any one slide (usually slide 1). */
  viewers: number;
  /** How many reached the last slide. */
  finished: number;
  /** The slide after which the most people stopped, or null when nobody stopped. */
  biggest_drop: number | null;
  slides: SlideRow[];
};

export type SlideReport = SlideNumbers & {
  id: string;
  title: string | null;
  days: number;
  offset: number;
  /** The window's first and last UTC day. */
  from: string;
  to: string;
  slide_count: number;
};

/** The deck as it is now: its slide count and titles (from its sidecar, lib/page-content.ts). */
export type DeckShape = { slides: number; titles: Array<string | null> };

/**
 * The SQL for one deck's window. The id goes straight into SQL (the API
 * takes no bound parameters), so it's checked here: [A-Za-z0-9_-] only.
 */
export function buildSlideQuery(id: string, w: Window, nowMs: number): string {
  if (!PAGE_ID.test(id)) throw new Error("invalid page id");
  checkWindow(w);
  const days = windowDays(w, nowMs);
  const reach = (w.offset + 1) * w.range + 1;
  return (
    `SELECT double1 AS slide, double2 AS sec, double3 AS first, SUM(_sample_interval) AS n FROM ${SLIDES_DATASET} ` +
    `WHERE index1 = '${id}' AND timestamp > NOW() - INTERVAL '${reach}' DAY AND blob2 >= '${days[0]}' AND blob2 <= '${days[days.length - 1]}' ` +
    `GROUP BY slide, sec, first LIMIT ${ROW_LIMIT} FORMAT JSON`
  );
}

/** The middle value of [value, weight] pairs; halfway between the two middle ones for an even total. */
export function weightedMedian(pairs: ReadonlyArray<readonly [number, number]>): number | null {
  const sorted = pairs.filter(([, w]) => w > 0).sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((n, [, w]) => n + w, 0);
  if (total === 0) return null;
  const at = (k: number): number => {
    let seen = 0;
    for (const [v, w] of sorted) {
      seen += w;
      if (seen >= k) return v;
    }
    return sorted[sorted.length - 1]![0];
  };
  const a = at(Math.floor((total + 1) / 2));
  const b = at(Math.floor(total / 2) + 1);
  return Math.round(((a + b) / 2) * 10) / 10;
}

/** The SQL API's numbers can arrive as strings (64-bit ints). */
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Rows from buildSlideQuery as per-slide numbers, for the deck as it is now. */
export function shapeSlides(rows: ReadonlyArray<Record<string, unknown>>, deck: DeckShape): SlideNumbers {
  const count = Math.max(0, Math.floor(deck.slides));
  const reached = new Array<number>(count).fill(0);
  const dwell: Array<Array<[number, number]>> = Array.from({ length: count }, () => []);
  for (const r of rows) {
    const slide = Math.round(num(r.slide));
    // A slide past the deck's end: it got shorter since. Left out.
    if (slide < 1 || slide > count) continue;
    const n = Math.round(num(r.n));
    if (n === 0) continue;
    if (num(r.first) === 1) reached[slide - 1]! += n;
    const sec = num(r.sec);
    if (sec > 0) dwell[slide - 1]!.push([sec, n]);
  }
  const slides: SlideRow[] = reached.map((n, i) => ({
    slide: i + 1,
    title: deck.titles[i] ?? null,
    reached: n,
    median_seconds: weightedMedian(dwell[i]!),
    drop_off: i < count - 1 ? Math.max(0, n - reached[i + 1]!) : null,
  }));
  let biggest: SlideRow | null = null;
  for (const s of slides) if (s.drop_off !== null && s.drop_off > 0 && (biggest === null || s.drop_off > biggest.drop_off!)) biggest = s;
  return {
    viewers: reached.reduce((m, n) => Math.max(m, n), 0),
    finished: count > 0 ? reached[count - 1]! : 0,
    biggest_drop: biggest?.slide ?? null,
    slides,
  };
}

export async function loadSlides(fetcher: FetchLike, config: AnalyticsConfig, id: string, w: Window, nowMs: number, deck: DeckShape): Promise<SlideNumbers> {
  return shapeSlides(await runQuery(fetcher, config, buildSlideQuery(id, w, nowMs)), deck);
}

/**
 * Made-up numbers for local dev (ANALYTICS_DEMO=1), where Analytics Engine
 * keeps nothing: fewer people on each slide, one clear drop. The same deck
 * always gets the same numbers.
 */
export function demoSlides(id: string, w: Window, deck: DeckShape): SlideNumbers {
  let seed = w.offset * 7919 + w.range;
  for (const ch of id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const start = Math.round((w.range / 30) * (40 + rand() * 40));
  const cliff = Math.max(1, Math.floor(deck.slides * 0.6));
  const rows: Array<Record<string, unknown>> = [];
  let left = start;
  for (let s = 1; s <= deck.slides; s++) {
    rows.push({ slide: s, sec: Math.round(4 + rand() * 40), first: 1, n: left });
    rows.push({ slide: s, sec: Math.round(2 + rand() * 6), first: 0, n: Math.round(left * 0.2) });
    left = Math.max(0, Math.round(left * (s === cliff ? 0.45 : 0.9 + rand() * 0.08)));
  }
  return shapeSlides(rows, deck);
}
