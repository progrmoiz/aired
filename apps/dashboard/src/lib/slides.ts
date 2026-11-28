// Per-slide numbers for a deck: GET /api/pages/:id/slides. Pro only; Free
// gets a 402 (locked preview). A page that isn't a deck answers 422
// not_a_deck, and then nothing is shown.
import { useEffect, useState } from 'react'
import { readJson } from '@/lib/api'
import type { Range } from '@/lib/analytics'

export type SlideRow = { slide: number; title: string | null; reached: number; median_seconds: number | null; drop_off: number | null }

export type SlideReport = {
  id: string
  title: string | null
  days: number
  offset: number
  from: string
  to: string
  slide_count: number
  /** The most people who reached any one slide. */
  viewers: number
  /** How many reached the last slide. */
  finished: number
  /** The slide after which the most people stopped. */
  biggest_drop: number | null
  slides: SlideRow[]
}

export type SlidesState =
  | { status: 'loading' }
  | { status: 'ready'; report: SlideReport }
  | { status: 'locked' }
  /** Not a deck, or not this account's page: show nothing. */
  | { status: 'none' }
  | { status: 'unavailable' }
  | { status: 'error' }

const cache = new Map<string, SlideReport>()

async function load(pageId: string, range: Range, offset: number): Promise<SlidesState> {
  const path = '/api/pages/' + encodeURIComponent(pageId) + '/slides?days=' + range + (offset ? '&offset=' + offset : '')
  const hit = cache.get(path)
  if (hit) return { status: 'ready', report: hit }
  const res = await fetch(path, { credentials: 'same-origin' })
  if (res.status === 402) return { status: 'locked' }
  if (res.status === 404 || res.status === 422) return { status: 'none' }
  if (res.status === 503) {
    const body = await readJson(res)
    return body.code === 'analytics_unavailable' ? { status: 'unavailable' } : { status: 'error' }
  }
  if (!res.ok) return { status: 'error' }
  const report = (await res.json()) as SlideReport
  cache.set(path, report)
  return { status: 'ready', report }
}

export function useSlides(pageId: string, range: Range, offset = 0): [SlidesState, () => void] {
  const [state, setState] = useState<SlidesState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }))
    load(pageId, range, offset).then((s) => { if (live) setState(s) }).catch(() => { if (live) setState({ status: 'error' }) })
    return () => { live = false }
  }, [pageId, range, offset, attempt])
  return [state, () => setAttempt((n) => n + 1)]
}

/** "8 s", "1 min 20 s", "12 min". */
export function secondsWords(s: number | null): string {
  if (s === null) return '—'
  const r = Math.round(s)
  if (r < 60) return `${r} s`
  const m = Math.floor(r / 60), rest = r % 60
  return rest === 0 || m >= 10 ? `${m} min` : `${m} min ${rest} s`
}

/** Fixed sample numbers behind the Free plan's locked preview. Never real data. */
export function sampleSlides(): SlideReport {
  const reached = [64, 61, 57, 55, 31, 28, 26, 24]
  const secs = [9, 14, 22, 18, 11, 25, 16, 30]
  const titles = ['Intro', 'The problem', 'What we built', 'How it works', 'Pricing', 'Customers', 'Roadmap', 'Thank you']
  const slides = reached.map((n, i) => ({
    slide: i + 1, title: titles[i]!, reached: n, median_seconds: secs[i]!, drop_off: i < reached.length - 1 ? Math.max(0, n - reached[i + 1]!) : null,
  }))
  return { id: 'sample', title: null, days: 30, offset: 0, from: '', to: '', slide_count: 8, viewers: 64, finished: 24, biggest_drop: 4, slides }
}

/** "1 person", "12 people". */
export function people(n: number): string {
  return n.toLocaleString() + (n === 1 ? ' person' : ' people')
}
