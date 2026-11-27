// Pro analytics: GET /api/me/analytics (all pages) and
// /api/me/analytics/pages/:id (one page). Free accounts get a 402.
import { useEffect, useState } from 'react'

export type Range = 7 | 30 | 90
export const RANGES: Range[] = [7, 30, 90]

export type Report = {
  range: Range
  total: number
  days: { day: string; views: number }[]
  countries: { code: string; views: number }[]
  referrers: { host: string; views: number }[]
  pages?: { id: string; title: string | null; views: number }[]
  page?: { id: string; title: string | null }
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

async function load(pageId: string, range: Range): Promise<AnalyticsState> {
  const path = (pageId ? '/api/me/analytics/pages/' + encodeURIComponent(pageId) : '/api/me/analytics') + '?range=' + range
  const hit = cache.get(path)
  if (hit) return { status: 'ready', report: hit }
  const res = await fetch(path, { credentials: 'same-origin' })
  if (res.status === 402) return { status: 'locked' }
  if (res.status === 404) return { status: 'missing' }
  if (res.status === 503) {
    const body = await res.json().catch(() => ({}))
    return body && body.code === 'analytics_unavailable' ? { status: 'unavailable' } : { status: 'error' }
  }
  if (!res.ok) return { status: 'error' }
  const report = (await res.json()) as Report
  cache.set(path, report)
  return { status: 'ready', report }
}

/** One page's numbers (`pageId`), or every page's when it's empty. */
export function useAnalytics(pageId: string, range: Range): [AnalyticsState, () => void] {
  const [state, setState] = useState<AnalyticsState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }))
    load(pageId, range).then((s) => { if (live) setState(s) }).catch(() => { if (live) setState({ status: 'error' }) })
    return () => { live = false }
  }, [pageId, range, attempt])
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

const SOURCES: [RegExp, string][] = [
  [/^(mail\.google\.com|com\.google\.android\.gm)$/, 'Gmail'],
  [/^(app\.)?slack\.com$|^com\.slack$/, 'Slack'],
  [/^(t\.co|x\.com|twitter\.com)$/, 'X'],
  [/^(linkedin\.com|lnkd\.in|com\.linkedin\.android)$/, 'LinkedIn'],
  [/^teams\.(microsoft|live)\.com$/, 'Microsoft Teams'],
  [/^(outlook\.(live|office|office365)\.com)$/, 'Outlook'],
  [/^(l\.|lm\.|m\.)?facebook\.com$/, 'Facebook'],
  [/^(google\.[a-z.]+|com\.google\.android\.googlequicksearchbox)$/, 'Google Search'],
  [/^bing\.com$/, 'Bing'],
  [/^duckduckgo\.com$/, 'DuckDuckGo'],
  [/^(notion\.so|notion\.site)$/, 'Notion'],
  [/^discord\.com$/, 'Discord'],
  [/^(chatgpt\.com|chat\.openai\.com)$/, 'ChatGPT'],
  [/^claude\.ai$/, 'Claude'],
  [/^(reddit\.com|out\.reddit\.com)$/, 'Reddit'],
  [/^news\.ycombinator\.com$/, 'Hacker News'],
  [/^github\.com$/, 'GitHub'],
]

/** Where people came from, in plain words. '' is a link with no referrer. */
export function sourceName(host: string): string {
  if (!host) return 'Direct or an app'
  for (const [re, name] of SOURCES) if (re.test(host)) return name
  return host
}

export function rangeWords(days: { day: string }[]): string {
  if (days.length === 0) return ''
  const f = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return f(days[0]!.day) + ' – ' + f(days[days.length - 1]!.day)
}

export function dayWords(day: string): string {
  return new Date(day + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** Fixed sample numbers behind the Free plan's locked preview. Never real data. */
export function sampleReport(range: Range): Report {
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())
  const days = Array.from({ length: range }, (_, i) => {
    const t = today - (range - 1 - i) * 86_400_000
    const wave = 18 + Math.round(10 * Math.sin(i / 2.3) + 6 * Math.sin(i / 5.1) + (i % 7 === 5 || i % 7 === 6 ? -8 : 0))
    return { day: new Date(t).toISOString().slice(0, 10), views: Math.max(3, wave) }
  })
  const total = days.reduce((n, d) => n + d.views, 0)
  const part = (w: number) => Math.round(total * w)
  return {
    range, total, days,
    countries: [['US', 0.41], ['GB', 0.17], ['DE', 0.12], ['IN', 0.09], ['CA', 0.07]].map(([code, w]) => ({ code: code as string, views: part(w as number) })),
    referrers: [['', 0.38], ['slack.com', 0.26], ['mail.google.com', 0.18], ['linkedin.com', 0.1]].map(([host, w]) => ({ host: host as string, views: part(w as number) })),
  }
}
