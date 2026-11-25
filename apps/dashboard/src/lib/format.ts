// Page facts in plain words. Same rules as the old dashboard.
import type { Page } from './api'

const SOON_MS = 7 * 86400e3

export function plural(n: number, word: string) {
  return n.toLocaleString() + ' ' + word + (n === 1 ? '' : 's')
}

export function relativeAge(iso: string | null | undefined) {
  if (!iso) return ''
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (Number.isNaN(diff)) return ''
  if (diff < 60) return 'just now'
  if (diff < 3600) return plural(Math.floor(diff / 60), 'minute') + ' ago'
  if (diff < 86400) return plural(Math.floor(diff / 3600), 'hour') + ' ago'
  if (diff < 86400 * 30) return plural(Math.floor(diff / 86400), 'day') + ' ago'
  if (diff < 86400 * 365) return plural(Math.floor(diff / (86400 * 30)), 'month') + ' ago'
  return plural(Math.floor(diff / (86400 * 365)), 'year') + ' ago'
}

export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, opts)
}

export const viewsOf = (p: Page) => (typeof p.readCount === 'number' ? p.readCount : 0)
export const limitReached = (p: Page) => typeof p.reads === 'number' && p.reads > 0 && viewsOf(p) >= p.reads

export function expiresMs(p: Page): number | null {
  if (p.permanent || !p.expiresAt) return null
  const t = new Date(p.expiresAt).getTime()
  return Number.isNaN(t) ? null : t
}

export function isExpired(p: Page) {
  const t = expiresMs(p)
  return (t !== null && t <= Date.now()) || limitReached(p)
}

export function isExpiringSoon(p: Page) {
  const t = expiresMs(p)
  return !isExpired(p) && t !== null && t - Date.now() < SOON_MS
}

export type Status = 'live' | 'soon' | 'expired'
export const statusOf = (p: Page): Status => (isExpired(p) ? 'expired' : isExpiringSoon(p) ? 'soon' : 'live')

/** "Never expires", "Expires in 4 hours", "Expired 24 Nov", "View limit reached". */
export function expiryWords(p: Page): { text: string; tone: 'good' | 'warn' | ''; title: string } {
  if (limitReached(p)) return { text: 'View limit reached', tone: 'warn', title: '' }
  const t = expiresMs(p)
  if (t === null) return { text: 'Never expires', tone: 'good', title: '' }
  const at = new Date(t)
  const left = Math.floor((t - Date.now()) / 1000)
  const title = 'Expires ' + at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const day = at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  if (left <= 0) return { text: 'Expired ' + day, tone: 'warn', title }
  if (left < 3600) return { text: 'Expires in ' + plural(Math.max(1, Math.floor(left / 60)), 'minute'), tone: 'warn', title }
  if (left < 86400) return { text: 'Expires in ' + plural(Math.floor(left / 3600), 'hour'), tone: 'warn', title }
  if (left < 86400 * 14) return { text: 'Expires in ' + plural(Math.round(left / 86400), 'day'), tone: '', title }
  return { text: 'Expires ' + day, tone: '', title }
}

export function sizeWords(bytes: number) {
  if (typeof bytes !== 'number' || bytes < 0) return ''
  if (bytes < 1024) return 'Under 1 KB'
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + ' MB'
}

export function viewsWords(p: Page) {
  const v = viewsOf(p)
  return typeof p.reads === 'number' && p.reads > 0 ? `${v.toLocaleString()} of ${p.reads.toLocaleString()}` : v.toLocaleString()
}

export type Kind = 'slides' | 'chart' | 'game' | 'site' | 'doc'
export function kindOf(p: Page): Kind {
  const t = (p.title || '').toLowerCase()
  if (/\b(deck|slides?|presentation|pitch|keynote)\b/.test(t)) return 'slides'
  if (/\b(report|dashboard|analytics|metrics|kpis?|results|performance|stats)\b/.test(t)) return 'chart'
  if (/\b(game|snake|tetris|quiz|puzzle|play)\b/.test(t)) return 'game'
  if (/\b(landing|site|website|homepage|menu|portfolio)\b/.test(t)) return 'site'
  return 'doc'
}
