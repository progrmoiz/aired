// Pages published in this browser before signing in (localStorage
// "aired.pages", written by the homepage form). Nothing is sent without a
// click. A port of the old dashboard's claim banner logic.
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { mutate, readJson } from '@/lib/api'
import { plural } from '@/lib/format'

const PAGES_KEY = 'aired.pages'
const DISMISSED_KEY = 'aired.pages.dismissed'
const CHUNK = 100
// claim-batch only says "claim failed" today; if it starts saying the page is
// gone or owned elsewhere, drop the entry so it stops coming back.
const GONE_RE = /not found|no longer exist|does not exist|gone|expired|deleted|already (claimed|owned)|owned by|another (user|account)/i

type Entry = { id: string; token: string; title?: string }

function readStored(): unknown[] {
  try {
    const list = JSON.parse(window.localStorage.getItem(PAGES_KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function readEntries(): Entry[] {
  const seen = new Set<string>()
  const out: Entry[] = []
  for (const e of readStored() as Record<string, unknown>[]) {
    if (!e || typeof e !== 'object') continue
    if (typeof e.id !== 'string' || !e.id || typeof e.token !== 'string' || !e.token) continue
    if (seen.has(e.id)) continue
    seen.add(e.id)
    out.push({ id: e.id, token: e.token, title: typeof e.title === 'string' ? e.title : undefined })
  }
  return out
}

function removeStored(ids: string[]) {
  if (!ids.length) return
  const drop = new Set(ids)
  try {
    const kept = (readStored() as Record<string, unknown>[]).filter((e) => !(e && typeof e === 'object' && drop.has(e.id as string)))
    window.localStorage.setItem(PAGES_KEY, JSON.stringify(kept))
  } catch { /* storage off */ }
}

const idsKey = (entries: Entry[]) => entries.map((e) => e.id).sort().join(',')

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY) || ''
    return raw ? raw.split(',') : []
  } catch {
    return []
  }
}

function initialVisible(): boolean {
  const entries = readEntries()
  if (!entries.length) return false
  const dismissed = readDismissed()
  return !entries.every((e) => dismissed.includes(e.id))
}

export function useClaim(onAdded: () => void) {
  const [visible, setVisible] = useState(initialVisible)
  const [entries, setEntries] = useState<Entry[]>(readEntries)
  const [state, setState] = useState<'idle' | 'pending' | 'partial' | 'error'>('idle')
  const [failures, setFailures] = useState<string[]>([])
  const [error, setError] = useState('')

  const dismiss = useCallback(() => {
    if (state === 'pending') return
    const list = readEntries()
    if (list.length) {
      try { window.localStorage.setItem(DISMISSED_KEY, idsKey(list)) } catch { /* ignore */ }
    }
    setVisible(false)
  }, [state])

  const add = useCallback(async () => {
    if (state === 'pending') return
    const list = readEntries()
    if (!list.length) { setVisible(false); return }
    const byId = new Map(list.map((e) => [e.id, e]))
    setState('pending'); setEntries(list); setFailures([]); setError('')
    let added = 0
    const failed: string[] = []
    let problem = ''
    try {
      for (let start = 0; start < list.length && !problem; start += CHUNK) {
        const chunk = list.slice(start, start + CHUNK)
        const res = await mutate('POST', '/api/me/claim-batch', { items: chunk.map((e) => ({ id: e.id, update_token: e.token })) })
        if (res.status === 429) { problem = 'Try again in an hour.'; break }
        if (!res.ok) throw new Error(String(res.status))
        const data = await readJson(res)
        const claimed = Array.isArray(data.claimed) ? (data.claimed as string[]) : []
        const bad = Array.isArray(data.failed) ? (data.failed as { id?: string; reason?: string }[]) : []
        const drop = claimed.slice()
        added += claimed.length
        for (const f of bad) {
          const e = f.id ? byId.get(f.id) : undefined
          failed.push((e && (e.title || e.id)) || f.id || '')
          if (typeof f.reason === 'string' && GONE_RE.test(f.reason) && f.id) drop.push(f.id)
        }
        removeStored(drop) // per chunk, so a later failure never re-sends claimed pages
      }
    } catch {
      problem = 'Could not add pages. Try again.'
    }
    const left = readEntries()
    setEntries(left)
    if (added > 0) { onAdded(); toast.success('Added ' + plural(added, 'page')) }
    if (problem) { setState('error'); setFailures(failed); setError(problem) }
    else if (failed.length) { setState('partial'); setFailures(failed) }
    else { setState('idle'); setVisible(false); if (!added) toast('Nothing to add') }
  }, [state, onAdded])

  return { visible, entries, state, failures, error, add, dismiss }
}
