/**
 * Pro analytics: views per day, top countries and top referrers, for one
 * page or across an owner's pages, read from the Analytics Engine dataset
 * that the viewer writes (lib/view-event.ts) through the SQL API.
 *
 * Analytics Engine keeps data for three months, so 90 days is the longest
 * range. Counts are SUM(_sample_interval): exact at aired's volumes, and an
 * estimate if Analytics Engine ever samples a very busy page.
 *
 * Query building is pure and checked by tests; `runQuery` is the only call
 * out. Imports only view-event.ts (itself import-free), so tests load it
 * directly.
 */

import { VIEWS_DATASET } from './view-event.ts';

export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];
export const DEFAULT_RANGE: Range = 30;

/** How far back a window may start: Analytics Engine keeps three months. */
export const MAX_DAYS = 90;

/** Lists are this long; the dashboard shows the first few and the rest under Details. */
export const LIST_N = 50;

/** Rows of (day, referrer) read to find the busiest day's top source. */
const DAY_HOSTS_N = 1000;

export type Scope = { kind: 'page'; id: string } | { kind: 'owner'; ownerId: number };

/**
 * A window of `range` whole UTC days. `offset` steps back by whole windows:
 * 0 ends today, 1 is the window before it, and so on.
 */
export type Window = { range: Range; offset: number };

export type Report = {
  range: Range;
  offset: number;
  /** Views in the window. */
  total: number;
  /**
   * Views in the window of the same length just before it, or null when it
   * has none (nothing to compare with, so no percentage).
   */
  previousTotal: number | null;
  /** One entry per UTC day, oldest first, zeros included. */
  days: { day: string; views: number }[];
  /** The busiest day and where most of its views came from ('' = direct), or null with no views. */
  peak: { day: string; views: number; host: string } | null;
  /** Two-letter country codes ('XX' unknown, 'T1' Tor), busiest first. */
  countries: { code: string; views: number }[];
  /** Referrer hosts; '' is direct or unknown. */
  referrers: { host: string; views: number }[];
  /** Owner scope only: the busiest pages in the window. */
  pages?: { id: string; views: number }[];
};

export function parseRange(raw: string | undefined): Range | null {
  if (raw === undefined || raw === '') return DEFAULT_RANGE;
  const n = Number(raw);
  return (RANGES as readonly number[]).includes(n) ? (n as Range) : null;
}

/** Windows back from today: a whole number, and the window must start within MAX_DAYS. */
export function parseOffset(raw: string | undefined, range: Range): number | null {
  if (raw === undefined || raw === '') return 0;
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return (n + 1) * range <= MAX_DAYS ? n : null;
}

const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The WHERE clause for a scope. Values go straight into SQL (the API takes
 * no bound parameters), so they're checked here, never quoted from input:
 * a page id is [A-Za-z0-9_-] and an owner id a positive integer.
 */
export function scopeFilter(scope: Scope): string {
  if (scope.kind === 'page') {
    if (!PAGE_ID.test(scope.id)) throw new Error('invalid page id');
    return `index1 = '${scope.id}'`;
  }
  if (!Number.isSafeInteger(scope.ownerId) || scope.ownerId <= 0) throw new Error('invalid owner id');
  return `blob2 = '${scope.ownerId}'`;
}

const DAY_MS = 86_400_000;
const utcDayStart = (ms: number) => Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth(), new Date(ms).getUTCDate());
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The window's UTC days, oldest first, as YYYY-MM-DD. */
export function windowDays(w: Window, nowMs: number): string[] {
  const last = utcDayStart(nowMs) - w.offset * w.range * DAY_MS;
  const out: string[] = [];
  for (let i = w.range - 1; i >= 0; i--) out.push(ymd(last - i * DAY_MS));
  return out;
}

/** UTC days from `range - 1` days ago through today. */
export function dayList(range: Range, nowMs: number): string[] {
  return windowDays({ range, offset: 0 }, nowMs);
}

export function checkWindow(w: Window) {
  if (!(RANGES as readonly number[]).includes(w.range)) throw new Error('invalid range');
  if (!Number.isSafeInteger(w.offset) || w.offset < 0 || (w.offset + 1) * w.range > MAX_DAYS) throw new Error('invalid offset');
}

export type Queries = { days: string; dayHosts: string; countries: string; referrers: string; pages?: string };

/**
 * Days are matched on blob5 (the view's UTC day), so a window is exactly its
 * calendar days and the lists add up to the chart. The timestamp bound only
 * keeps the scan short. `days` covers the window before this one too, for
 * the comparison.
 */
export function buildQueries(scope: Scope, w: Window, nowMs: number): Queries {
  checkWindow(w);
  const days = windowDays(w, nowMs);
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const prevFirst = ymd(Date.parse(first + 'T00:00:00Z') - w.range * DAY_MS);
  const back = (n: number) => `timestamp > NOW() - INTERVAL '${n}' DAY`;
  const reach = (w.offset + 1) * w.range + 1;
  const scope_ = scopeFilter(scope);
  const from = `FROM ${VIEWS_DATASET} WHERE ${scope_} AND ${back(reach)} AND blob5 >= '${first}' AND blob5 <= '${last}'`;
  const list = (col: string, alias: string) =>
    `SELECT ${col} AS ${alias}, SUM(_sample_interval) AS views ${from} GROUP BY ${alias} ORDER BY views DESC LIMIT ${LIST_N} FORMAT JSON`;
  const q: Queries = {
    days: `SELECT blob5 AS bucket, SUM(_sample_interval) AS views FROM ${VIEWS_DATASET} WHERE ${scope_} AND ${back(reach + w.range)} AND blob5 >= '${prevFirst}' AND blob5 <= '${last}' GROUP BY bucket ORDER BY bucket ASC FORMAT JSON`,
    dayHosts: `SELECT blob5 AS bucket, blob4 AS host, SUM(_sample_interval) AS views ${from} GROUP BY bucket, host ORDER BY views DESC LIMIT ${DAY_HOSTS_N} FORMAT JSON`,
    countries: list('blob3', 'code'),
    referrers: list('blob4', 'host'),
  };
  if (scope.kind === 'owner') q.pages = list('blob1', 'id');
  return q;
}

/** The SQL API's JSON rows: numbers can arrive as strings (64-bit ints). */
type Row = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function shapeReport(
  w: Window,
  rows: { days: Row[]; dayHosts?: Row[]; countries: Row[]; referrers: Row[]; pages?: Row[] },
  nowMs: number,
): Report {
  const byDay = new Map<string, number>();
  for (const r of rows.days) byDay.set(str(r.bucket), (byDay.get(str(r.bucket)) ?? 0) + num(r.views));
  const list = windowDays(w, nowMs);
  const days = list.map((day) => ({ day, views: byDay.get(day) ?? 0 }));
  const prevStart = Date.parse(list[0]! + 'T00:00:00Z') - w.range * DAY_MS;
  let previous = 0;
  for (let i = 0; i < w.range; i++) previous += byDay.get(ymd(prevStart + i * DAY_MS)) ?? 0;

  let peak: Report['peak'] = null;
  for (const d of days) if (d.views > 0 && (peak === null || d.views > peak.views)) peak = { day: d.day, views: d.views, host: '' };
  if (peak !== null) {
    let best = -1;
    for (const r of rows.dayHosts ?? []) {
      if (str(r.bucket) === peak.day && num(r.views) > best) {
        best = num(r.views);
        peak.host = str(r.host);
      }
    }
  }

  const report: Report = {
    range: w.range,
    offset: w.offset,
    total: days.reduce((n, d) => n + d.views, 0),
    previousTotal: previous > 0 ? previous : null,
    days,
    peak,
    countries: rows.countries.map((r) => ({ code: str(r.code) || 'XX', views: num(r.views) })).filter((r) => r.views > 0),
    referrers: rows.referrers.map((r) => ({ host: str(r.host), views: num(r.views) })).filter((r) => r.views > 0),
  };
  if (rows.pages) report.pages = rows.pages.map((r) => ({ id: str(r.id), views: num(r.views) })).filter((r) => r.id !== '' && r.views > 0);
  return report;
}

export type AnalyticsConfig = { accountId: string; token: string };

export function analyticsConfig(env: { CF_ACCOUNT_ID?: string; CF_ANALYTICS_TOKEN?: string }): AnalyticsConfig | null {
  const accountId = (env.CF_ACCOUNT_ID ?? '').trim();
  const token = (env.CF_ANALYTICS_TOKEN ?? '').trim();
  if (!/^[0-9a-f]{32}$/.test(accountId) || token === '') return null;
  return { accountId, token };
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>;

/** Run one query through the Analytics Engine SQL API. Throws on any failure. */
export async function runQuery(fetcher: FetchLike, config: AnalyticsConfig, sql: string): Promise<Row[]> {
  const res = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/analytics_engine/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'text/plain' },
    body: sql,
  });
  if (!res.ok) throw new Error(`analytics query failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { data?: unknown };
  if (!Array.isArray(body.data)) throw new Error('analytics query returned no data');
  return body.data.filter((r): r is Row => typeof r === 'object' && r !== null);
}

export async function loadReport(fetcher: FetchLike, config: AnalyticsConfig, scope: Scope, w: Window, nowMs: number): Promise<Report> {
  const q = buildQueries(scope, w, nowMs);
  const [days, dayHosts, countries, referrers, pages] = await Promise.all([
    runQuery(fetcher, config, q.days),
    runQuery(fetcher, config, q.dayHosts),
    runQuery(fetcher, config, q.countries),
    runQuery(fetcher, config, q.referrers),
    q.pages === undefined ? Promise.resolve(undefined) : runQuery(fetcher, config, q.pages),
  ]);
  return shapeReport(w, { days, dayHosts, countries, referrers, ...(pages ? { pages } : {}) }, nowMs);
}

/**
 * Made-up numbers for local dev (ANALYTICS_DEMO=1), where Analytics Engine
 * keeps nothing. The same scope always gets the same numbers.
 */
export function demoReport(scope: Scope, w: Window, nowMs: number, pageIds: readonly string[] = []): Report {
  let seed = w.offset * 7919;
  for (const ch of scope.kind === 'page' ? scope.id : `owner${scope.ownerId}`) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const scale = scope.kind === 'owner' ? 60 : 14;
  const days = windowDays(w, nowMs).map((day, i) => ({
    day,
    views: Math.round(scale * (0.4 + rand()) * (1 + Math.sin(i / 3) * 0.3) * (new Date(day).getUTCDay() % 6 === 0 ? 0.55 : 1) * (i % 11 === 4 ? 2.4 : 1)),
  }));
  const total = days.reduce((n, d) => n + d.views, 0);
  const split = <T extends string>(keys: T[], weights: number[]) =>
    keys.map((k, i) => ({ k, views: Math.round((total * weights[i]!) / weights.reduce((a, b) => a + b, 0)) }));
  const top = days.reduce((a, d) => (d.views > a.views ? d : a), days[0]!);
  const report: Report = {
    range: w.range,
    offset: w.offset,
    total,
    previousTotal: (w.offset + 2) * w.range > MAX_DAYS ? null : Math.round(total * (0.78 + rand() * 0.14)),
    days,
    peak: total > 0 ? { day: top.day, views: top.views, host: 'mail.google.com' } : null,
    countries: split(['US', 'GB', 'DE', 'IN', 'JP', 'BR', 'CA', 'FR', 'NL', 'ES', 'AU', 'XX'], [38, 16, 11, 9, 7, 6, 4, 3, 2, 2, 1, 1]).map(({ k, views }) => ({ code: k, views })),
    referrers: split(['', 'app.slack.com', 'mail.google.com', 'linkedin.com', 'github.com', 'chatgpt.com', 'claude.ai', 'stackoverflow.com', 'teams.microsoft.com', 't.co', 'dev.to', 'vercel.com', 'news.ycombinator.com'], [34, 20, 13, 9, 7, 5, 4, 3, 3, 2, 2, 1, 1]).map(({ k, views }) => ({ host: k, views })),
  };
  if (scope.kind === 'owner') {
    report.pages = pageIds.slice(0, LIST_N).map((id, i) => ({ id, views: Math.max(1, Math.round(total / 2 ** (i + 1))) }));
  }
  return report;
}
