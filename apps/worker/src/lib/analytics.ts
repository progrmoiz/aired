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

/** Top lists are this long. */
export const TOP_N = 8;

export type Scope = { kind: 'page'; id: string } | { kind: 'owner'; ownerId: number };

export type Report = {
  range: Range;
  /** Views in the range. */
  total: number;
  /** One entry per UTC day, oldest first, zeros included. */
  days: { day: string; views: number }[];
  /** Two-letter country codes ('XX' unknown, 'T1' Tor). */
  countries: { code: string; views: number }[];
  /** Referrer hosts; '' is direct or unknown. */
  referrers: { host: string; views: number }[];
  /** Owner scope only: the busiest pages in the range. */
  pages?: { id: string; views: number }[];
};

export function parseRange(raw: string | undefined): Range | null {
  if (raw === undefined || raw === '') return DEFAULT_RANGE;
  const n = Number(raw);
  return (RANGES as readonly number[]).includes(n) ? (n as Range) : null;
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

export type Queries = { days: string; countries: string; referrers: string; pages?: string };

export function buildQueries(scope: Scope, range: Range): Queries {
  if (!(RANGES as readonly number[]).includes(range)) throw new Error('invalid range');
  const where = `${scopeFilter(scope)} AND timestamp > NOW() - INTERVAL '${range}' DAY`;
  const from = `FROM ${VIEWS_DATASET} WHERE ${where}`;
  const top = (col: string, alias: string) =>
    `SELECT ${col} AS ${alias}, SUM(_sample_interval) AS views ${from} GROUP BY ${alias} ORDER BY views DESC LIMIT ${TOP_N} FORMAT JSON`;
  const q: Queries = {
    days: `SELECT blob5 AS bucket, SUM(_sample_interval) AS views ${from} GROUP BY bucket ORDER BY bucket ASC FORMAT JSON`,
    countries: top('blob3', 'code'),
    referrers: top('blob4', 'host'),
  };
  if (scope.kind === 'owner') q.pages = top('blob1', 'id');
  return q;
}

/** The SQL API's JSON rows: numbers can arrive as strings (64-bit ints). */
type Row = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** UTC days from `range - 1` days ago through today, as YYYY-MM-DD. */
export function dayList(range: Range, nowMs: number): string[] {
  const today = Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate());
  const out: string[] = [];
  for (let i = range - 1; i >= 0; i--) out.push(new Date(today - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

export function shapeReport(
  range: Range,
  rows: { days: Row[]; countries: Row[]; referrers: Row[]; pages?: Row[] },
  nowMs: number,
): Report {
  const byDay = new Map<string, number>();
  for (const r of rows.days) byDay.set(str(r.bucket), (byDay.get(str(r.bucket)) ?? 0) + num(r.views));
  const days = dayList(range, nowMs).map((day) => ({ day, views: byDay.get(day) ?? 0 }));
  const report: Report = {
    range,
    total: days.reduce((n, d) => n + d.views, 0),
    days,
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

export async function loadReport(fetcher: FetchLike, config: AnalyticsConfig, scope: Scope, range: Range, nowMs: number): Promise<Report> {
  const q = buildQueries(scope, range);
  const [days, countries, referrers, pages] = await Promise.all([
    runQuery(fetcher, config, q.days),
    runQuery(fetcher, config, q.countries),
    runQuery(fetcher, config, q.referrers),
    q.pages === undefined ? Promise.resolve(undefined) : runQuery(fetcher, config, q.pages),
  ]);
  return shapeReport(range, { days, countries, referrers, ...(pages ? { pages } : {}) }, nowMs);
}

/**
 * Made-up numbers for local dev (ANALYTICS_DEMO=1), where Analytics Engine
 * keeps nothing. The same scope always gets the same numbers.
 */
export function demoReport(scope: Scope, range: Range, nowMs: number, pageIds: readonly string[] = []): Report {
  let seed = 0;
  for (const ch of scope.kind === 'page' ? scope.id : `owner${scope.ownerId}`) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const scale = scope.kind === 'owner' ? 60 : 14;
  const days = dayList(range, nowMs).map((day, i) => ({
    day,
    views: Math.round(scale * (0.4 + rand()) * (1 + Math.sin(i / 3) * 0.3) * (new Date(day).getUTCDay() % 6 === 0 ? 0.55 : 1)),
  }));
  const total = days.reduce((n, d) => n + d.views, 0);
  const split = <T extends string>(keys: T[], weights: number[]) =>
    keys.map((k, i) => ({ k, views: Math.round((total * weights[i]!) / weights.reduce((a, b) => a + b, 0)) }));
  const report: Report = {
    range,
    total,
    days,
    countries: split(['US', 'GB', 'DE', 'IN', 'CA', 'FR', 'NL', 'XX'], [38, 16, 11, 9, 7, 6, 4, 2]).map(({ k, views }) => ({ code: k, views })),
    referrers: split(['', 'slack.com', 'mail.google.com', 'linkedin.com', 'notion.so', 't.co'], [41, 24, 15, 9, 6, 3]).map(({ k, views }) => ({ host: k, views })),
  };
  if (scope.kind === 'owner') {
    const ids = pageIds.slice(0, TOP_N);
    report.pages = ids.map((id, i) => ({ id, views: Math.max(1, Math.round(total / 2 ** (i + 1))) }));
  }
  return report;
}
