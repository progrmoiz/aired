// Pro analytics: GET /api/me/analytics (all pages) and
// /api/me/analytics/pages/:id (one page). Free accounts get a 402.
import { useEffect, useState } from 'react'
import { sourceOf } from '@/lib/sources'
import { readJson } from '@/lib/api'

export type Range = 7 | 30 | 90
export const RANGES: Range[] = [7, 30, 90]

/** Windows can start at most this many days back (the Worker's MAX_DAYS). */
export const MAX_DAYS = 90

export type Report = {
  range: Range
  /** Whole windows back from today. */
  offset: number
  total: number
  /** The window before, or null when it had no views. */
  previousTotal: number | null
  days: { day: string; views: number }[]
  /** The busiest day and its top source ('' = direct). */
  peak: { day: string; views: number; host: string } | null
  countries: { code: string; views: number }[]
  referrers: { host: string; views: number }[]
  pages?: { id: string; title: string | null; views: number }[]
  page?: { id: string; title: string | null }
  /** Signed /api/favicon URLs, by referrer host. */
  icons?: Record<string, string>
}

export type AnalyticsState =
  | { status: 'loading' }
  | { status: 'ready'; report: Report }
  /** Free plan: show the locked preview. */
  | { status: 'locked' }
  /** Pro, but the numbers aren't set up on the server yet. */
  | { status: 'unavailable' }
  | { status: 'missing' }
  | { status: 'error' }

const cache = new Map<string, Report>()

async function load(pageId: string, range: Range, offset: number): Promise<AnalyticsState> {
  const path = (pageId ? '/api/me/analytics/pages/' + encodeURIComponent(pageId) : '/api/me/analytics') + '?range=' + range + (offset ? '&offset=' + offset : '')
  const hit = cache.get(path)
  if (hit) return { status: 'ready', report: hit }
  const res = await fetch(path, { credentials: 'same-origin' })
  if (res.status === 402) return { status: 'locked' }
  if (res.status === 404) return { status: 'missing' }
  if (res.status === 503) {
    const body = await readJson(res)
    return body.code === 'analytics_unavailable' ? { status: 'unavailable' } : { status: 'error' }
  }
  if (!res.ok) return { status: 'error' }
  const report = (await res.json()) as Report
  cache.set(path, report)
  return { status: 'ready', report }
}

/** One page's numbers (`pageId`), or every page's when it's empty, for a window `offset` windows back. */
export function useAnalytics(pageId: string, range: Range, offset = 0): [AnalyticsState, () => void] {
  const [state, setState] = useState<AnalyticsState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }))
    load(pageId, range, offset).then((s) => { if (live) setState(s) }).catch(() => { if (live) setState({ status: 'error' }) })
    return () => { live = false }
  }, [pageId, range, offset, attempt])
  return [state, () => setAttempt((n) => n + 1)]
}

let regionNames: Intl.DisplayNames | null = null
export function countryName(code: string): string {
  if (code === 'XX' || !code) return 'Unknown'
  if (code === 'T1') return 'Tor network'
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' })
    return regionNames.of(code) ?? code
  } catch {
    return code
  }
}

/** Where people came from, in plain words (lib/sources.ts). '' is a link with no referrer. */
export function sourceName(host: string): string {
  return sourceOf(host).name
}

export function rangeWords(days: { day: string }[]): string {
  if (days.length === 0) return ''
  const f = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return f(days[0]!.day) + ' – ' + f(days[days.length - 1]!.day)
}

/** The change from the window before, as a whole percentage, or null when there's nothing to compare. */
export function changePercent(total: number, previous: number | null): number | null {
  if (previous === null || previous <= 0) return null
  return Math.round(((total - previous) / previous) * 100)
}

export function shortDay(day: string): string {
  return new Date(day + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function dayWords(day: string): string {
  return new Date(day + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** Fixed sample numbers behind the Free plan's locked preview. Never real data. */
export function sampleReport(range: Range): Report {
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())
  const days = Array.from({ length: range }, (_, i) => {
    const t = today - (range - 1 - i) * 86_400_000
    const wave = 18 + Math.round(10 * Math.sin(i / 2.3) + 6 * Math.sin(i / 5.1) + (i % 7 === 5 || i % 7 === 6 ? -8 : 0) + (i === Math.floor(range * 0.6) ? 30 : 0))
    return { day: new Date(t).toISOString().slice(0, 10), views: Math.max(3, wave) }
  })
  const total = days.reduce((n, d) => n + d.views, 0)
  const part = (w: number) => Math.round(total * w)
  const top = days.reduce((a, d) => (d.views > a.views ? d : a), days[0]!)
  return {
    range, offset: 0, total, days,
    previousTotal: Math.round(total / 1.18),
    peak: { day: top.day, views: top.views, host: 'app.slack.com' },
    countries: [['US', 0.36], ['GB', 0.15], ['DE', 0.11], ['IN', 0.09], ['CA', 0.07], ['FR', 0.06], ['JP', 0.05], ['BR', 0.04], ['AU', 0.03], ['NL', 0.02]]
      .map(([code, w]) => ({ code: code as string, views: part(w as number) })),
    referrers: [['', 0.34], ['app.slack.com', 0.22], ['mail.google.com', 0.14], ['linkedin.com', 0.09], ['t.co', 0.06], ['github.com', 0.05], ['chatgpt.com', 0.04], ['notion.so', 0.03]]
      .map(([host, w]) => ({ host: host as string, views: part(w as number) })),
  }
}
