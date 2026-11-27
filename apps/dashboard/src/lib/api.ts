// The dashboard's view of the aired API. Same endpoints and headers the old
// vanilla dashboard used; nothing here is new on the server.

export type User = {
  id: number
  login: string
  email: string | null
  name: string | null
  createdAt: string | null
  plan: string
}

export type Page = {
  id: string
  title: string | null
  size: number
  readCount: number
  reads: number | null
  permanent: boolean
  createdAt: string
  expiresAt: string | null
  hasPin: boolean
  /** Who can open it. Older servers leave it out: then hasPin decides. */
  access?: 'public' | 'pin' | 'people'
  project: string | null
  /** The dashboard tile's version and blurred placeholder, once the page has been drawn. */
  tile?: TileInfo | null
  /** Stored responses (aired.collect). Older servers leave it out. */
  responses?: number
  /** Which list it came from: a project name or UNSORTED. Set by loadAllPages. */
  group: string
}

/** A page's stored screenshot: `v` keys the image URL (it changes on update), `lqip` is a tiny blurred JPEG data URI. */
export type TileInfo = { v: string; lqip: string }

export type BillingStatus = {
  enabled: boolean
  plan?: string | null
  status?: string | null
  renewsAt?: string | null
  cancelAtPeriodEnd?: boolean
}

export type ApiKey = { id: string; name: string; prefix: string; createdAt: number | null; lastUsedAt: number | null }

export const UNSORTED = '__unsorted__'
export const PAGE_CAP = 1000
export const SIGN_IN = '/auth/login?return=/dashboard'

/** POSTs and DELETEs carry the CSRF header the Worker requires. */
export function mutate(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'X-Aired-Request': '1' }
  const init: RequestInit = { method, headers, credentials: 'same-origin' }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  return fetch(path, init)
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin' })
  if (!res.ok) throw Object.assign(new Error('Request failed: ' + res.status), { status: res.status })
  return res.json() as Promise<T>
}

export async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const data = await res.json()
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

/** Every page in every project, following cursors, newest first, capped at PAGE_CAP. */
export async function loadAllPages(): Promise<{ pages: Page[]; projects: string[]; truncated: boolean }> {
  const { projects = [] } = await getJson<{ projects: { name: string; count: number }[] }>('/api/me/projects')
  const names = projects.map((p) => p.name)
  let truncated = false
  const groups = await Promise.all(
    [...names, UNSORTED].map(async (key) => {
      const rows: Page[] = []
      let cursor: string | null = null
      for (let depth = 0; depth < 60; depth++) {
        const q: string = '/api/me/pages?project=' + encodeURIComponent(key) + '&limit=50' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')
        const data: { pages?: Page[]; cursor?: string | null } = await getJson(q)
        for (const p of data.pages ?? []) rows.push({ ...p, group: key })
        cursor = data.cursor ?? null
        if (!cursor || rows.length >= PAGE_CAP) break
      }
      if (cursor) truncated = true
      return rows
    }),
  )
  const seen = new Set<string>()
  const pages: Page[] = []
  for (const p of groups.flat()) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    pages.push(p)
  }
  pages.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  if (pages.length > PAGE_CAP) truncated = true
  return { pages: pages.slice(0, PAGE_CAP), projects: names, truncated }
}

/** Sign-out and account deletion may hand back an AuthKit logout URL. */
export function afterSignOut(data: Record<string, unknown>) {
  const next = typeof data.redirect === 'string' && /^https:\/\/api\.workos\.com\//.test(data.redirect) ? data.redirect : '/'
  window.location.href = next
}

/** Sign out of this browser, then follow the logout redirect (or go home). */
export async function signOut(): Promise<void> {
  try {
    const res = await fetch('/auth/logout', { method: 'POST', headers: { 'X-Aired-Request': '1' }, credentials: 'same-origin' })
    afterSignOut(await readJson(res))
  } catch {
    window.location.href = '/'
  }
}

/** The person's initial for their avatar. */
export const initialOf = (user: User | null) => ((user?.name || user?.login || '').trim().charAt(0) || '·').toUpperCase()

export function isNavigableUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy') } catch { /* nothing else to try */ }
    ta.remove()
  }
}
