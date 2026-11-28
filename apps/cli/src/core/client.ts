import { randomUUID } from 'node:crypto'
import { USER_AGENT } from '../lib/constants.js'
import { AUTH_HEADER, CSRF_HEADER } from '@aired/core'
import type { User } from '@aired/core'
import type { PublishResult, PageInfo, PageDetails, FeedbackResult, CheckReport, PdfExport, OwnPage, PageSource } from './types.js'
import type { PageContent } from './markdown.js'

/**
 * An API key from AIRED_API_KEY (for CI and agents), or null. When set, it's
 * sent as Authorization: Bearer and publishes go to the key's account.
 */
export function apiKeyFromEnv(): string | null {
  const raw = process.env['AIRED_API_KEY']
  if (raw === undefined) return null
  // Accept a value pasted with its "Bearer " prefix.
  const key = raw.trim().replace(/^bearer\s+/i, '')
  if (key === '') {
    // An unset CI secret: refuse rather than publish anonymously.
    throw new Error('AIRED_API_KEY is set but empty. Set it to your aired_sk_ key, or unset it to publish without one.')
  }
  if (!key.startsWith('aired_sk_')) {
    throw new Error('AIRED_API_KEY must be an aired API key starting with aired_sk_ (create one under API keys in the dashboard).')
  }
  return key
}

function addApiKey(headers: Record<string, string>): Record<string, string> {
  const key = apiKeyFromEnv()
  if (key !== null) headers['Authorization'] = `Bearer ${key}`
  return headers
}

export interface PublishOptions {
  title?: string
  pin?: string
  ttl?: number
  reads?: number
  permanent?: boolean
  project?: string
  update_token?: string
  id?: string
}

/** Offer the server attaches to a publish/update response for free-plan accounts. */
export interface UpgradeHint {
  reason: string
  url: string
}

/** `claim_url` comes back on anonymous creates only: open it signed in to keep the page. */
export type PublishResponse = PublishResult & { upgrade?: UpgradeHint; claim_url?: string }

export interface MeResult {
  id: number
  login: string
  email: string | null
  name: string | null
  createdAt: string
  updatedAt: string
}

export interface ClaimResult {
  ok: boolean
  /** The page's new update token. Claiming retires the token that was sent. */
  update_token?: string
}

export interface ClaimBatchResult {
  claimed: string[]
  failed: Array<{ id: string; reason: string }>
  /** New update token per claimed id (absent from servers before rotation). */
  tokens?: Record<string, string>
}

export interface PageListResult {
  pages: PageInfo[]
  cursor?: string
}

export interface DeviceCodeResult {
  user_code: string
  verification_uri: string
  /** The verification page with the code filled in (aired's own flow). */
  verification_uri_complete?: string
  interval: number
  device_code: string
}

export interface AuthTokenResult {
  jwt: string
  user: User
}

/**
 * An API error's message and code, from either shape the server answers:
 * `{ error: { code, message } }` (servers after 1.10.0), or the flat
 * `{ error: "<message>", code }` (older servers, /auth, and what servers send
 * clients that identify as 1.10.0 or older).
 */
export function apiErrorOf(body: unknown): { message: string | null; code: string | null } {
  if (typeof body !== 'object' || body === null) return { message: null, code: null }
  const b = body as Record<string, unknown>
  const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
  if (typeof b['error'] === 'object' && b['error'] !== null) {
    const e = b['error'] as Record<string, unknown>
    return { message: text(e['message']), code: text(e['code']) }
  }
  return { message: text(b['error']), code: text(b['code']) }
}

async function handleResponse<T>(resp: Response, action: string): Promise<T> {
  if (resp.status === 429) {
    // Publishes keep their familiar message; other limits (set, feedback) say their own.
    let message = 'Rate limited: too many uploads. Try again in an hour.'
    if (action !== 'Publish' && action !== 'Update') {
      try {
        const { message: said } = apiErrorOf(await resp.json())
        if (said !== null) message = `Rate limited: ${said}`
      } catch {
        // keep the default
      }
    }
    const err = new Error(message)
    ;(err as NodeJS.ErrnoException).code = 'RATE_LIMITED'
    throw err
  }

  if (!resp.ok) {
    let message = `${action} failed (${resp.status})`
    let apiCode: string | null = null
    try {
      const found = apiErrorOf(await resp.json())
      if (found.message !== null) message = found.message
      apiCode = found.code
    } catch {
      // ignore
    }
    // The status lets a command tell "try later" (502/503) from "no access" (401/403/404);
    // apiCode is the API's own code (not_found, invalid_token, ...).
    throw Object.assign(new Error(message), { status: resp.status, apiCode })
  }

  try {
    return (await resp.json()) as T
  } catch {
    throw new Error(`${action}: unexpected response format`)
  }
}

/** Waits between publish retries: 1 s, then 3 s. */
const PUBLISH_RETRY_DELAYS_MS = [1000, 3000]

/** A publish answer worth retrying with the same Idempotency-Key: still running, or a passing server failure. */
async function retryablePublish(resp: Response): Promise<boolean> {
  if (resp.status === 502 || resp.status === 503 || resp.status === 504) return true
  if (resp.status !== 409) return false
  try {
    return apiErrorOf(await resp.clone().json()).code === 'idempotency_in_progress'
  } catch {
    return false
  }
}

/**
 * POST /api/publish with an Idempotency-Key, retried on a dropped connection,
 * a 502/503/504, or a 409 for the same key still running. Every attempt
 * sends the same key and body, so the server answers a retry with the first
 * publish's page instead of making a second one.
 */
async function postPublish(url: string, headers: Record<string, string>, body: string): Promise<Response> {
  const withKey = { ...headers, 'Idempotency-Key': randomUUID() }
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= PUBLISH_RETRY_DELAYS_MS.length
    let resp: Response
    try {
      resp = await fetch(url, { method: 'POST', headers: withKey, body })
    } catch (err) {
      if (last) throw err
      await sleep(PUBLISH_RETRY_DELAYS_MS[attempt]!)
      continue
    }
    if (last || !(await retryablePublish(resp))) return resp
    await sleep(PUBLISH_RETRY_DELAYS_MS[attempt]!)
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export type { PageContent }

export async function publishHTML(
  baseUrl: string,
  content: string | PageContent,
  options: PublishOptions = {},
  jwt?: string,
): Promise<PublishResponse> {
  const body: Record<string, unknown> = typeof content === 'string' ? { html: content } : { ...content }

  if (options.title !== undefined) body['title'] = options.title
  if (options.pin !== undefined) body['pin'] = options.pin
  if (options.ttl !== undefined) body['ttl'] = options.ttl
  if (options.reads !== undefined) body['reads'] = options.reads
  if (options.permanent === true) body['permanent'] = true
  if (options.project !== undefined) body['project'] = options.project
  if (options.update_token !== undefined) body['update_token'] = options.update_token
  if (options.id !== undefined) body['id'] = options.id

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': USER_AGENT,
  }

  if (jwt !== undefined) {
    headers[AUTH_HEADER] = jwt
    headers[CSRF_HEADER] = '1'
  }

  addApiKey(headers)
  const resp = await postPublish(`${baseUrl}/api/publish`, headers, JSON.stringify(body))
  return handleResponse<PublishResponse>(resp, 'Publish')
}

export async function updatePage(
  baseUrl: string,
  id: string,
  content: string | PageContent,
  token: string,
  options: { title?: string; message?: string } = {},
  jwt?: string,
): Promise<PublishResult> {
  const body: Record<string, unknown> = { ...(typeof content === 'string' ? { html: content } : content), update_token: token }
  if (options.title !== undefined) body['title'] = options.title
  if (options.message !== undefined) body['message'] = options.message

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': USER_AGENT,
  }

  if (jwt !== undefined) {
    headers[AUTH_HEADER] = jwt
    headers[CSRF_HEADER] = '1'
  }

  addApiKey(headers)
  const resp = await fetch(`${baseUrl}/api/pages/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  })

  return handleResponse<PublishResult>(resp, 'Update')
}

export async function deletePage(
  baseUrl: string,
  id: string,
  token: string,
  jwt?: string,
): Promise<void> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
  }

  if (jwt !== undefined) {
    headers[AUTH_HEADER] = jwt
    headers[CSRF_HEADER] = '1'
  }

  // With an API key, Authorization carries the key, so the update token goes
  // in the body (the API accepts either).
  let body: string | undefined
  if (apiKeyFromEnv() !== null) {
    addApiKey(headers)
    if (token !== '') {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify({ update_token: token })
    }
  } else {
    headers['Authorization'] = `Bearer ${token}`
  }

  const resp = await fetch(`${baseUrl}/api/pages/${id}`, {
    method: 'DELETE',
    headers,
    body,
  })

  await handleResponse<{ ok: boolean }>(resp, 'Delete')
}

export async function getPage(
  baseUrl: string,
  id: string,
): Promise<PageInfo> {
  const resp = await fetch(`${baseUrl}/api/pages/${id}`, {
    headers: { 'User-Agent': USER_AGENT },
  })

  return handleResponse<PageInfo>(resp, 'Get page')
}

export async function pageExists(
  baseUrl: string,
  id: string,
): Promise<boolean> {
  try {
    const resp = await fetch(`${baseUrl}/api/pages/${id}`, {
      method: 'HEAD',
      headers: { 'User-Agent': USER_AGENT },
    })
    return resp.ok
  } catch {
    return true
  }
}

export async function checkConnectivity(baseUrl: string): Promise<boolean> {
  try {
    const resp = await fetch(`${baseUrl}/api/pages/___health_check`, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5000),
    })
    // 404 means the API is reachable (page not found is expected)
    return resp.status === 404 || resp.ok
  } catch {
    return false
  }
}

export async function getMe(baseUrl: string, jwt: string): Promise<MeResult> {
  const resp = await fetch(`${baseUrl}/api/me`, {
    headers: {
      'User-Agent': USER_AGENT,
      [AUTH_HEADER]: jwt,
    },
  })
  return handleResponse<MeResult>(resp, 'Get me')
}

/**
 * Validate a session token against the server.
 * Returns the user on 200, `null` when the server rejects the token (401/403),
 * and throws on network failures or unexpected status codes.
 *
 * The null-vs-throw distinction lets callers separate "logged out" (clear the
 * stale local session) from "can't reach the server" (keep the cached session).
 */
export async function validateSession(
  baseUrl: string,
  jwt: string,
): Promise<User | null> {
  const resp = await fetch(`${baseUrl}/api/me`, {
    headers: {
      'User-Agent': USER_AGENT,
      [AUTH_HEADER]: jwt,
    },
  })

  if (resp.status === 401 || resp.status === 403) {
    return null
  }

  return handleResponse<User>(resp, 'Validate session')
}

export async function claimPage(
  baseUrl: string,
  jwt: string,
  id: string,
  token: string,
): Promise<ClaimResult> {
  const resp = await fetch(`${baseUrl}/api/me/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      [AUTH_HEADER]: jwt,
      [CSRF_HEADER]: '1',
    },
    body: JSON.stringify({ id, update_token: token }),
  })
  return handleResponse<ClaimResult>(resp, 'Claim page')
}

export async function claimBatch(
  baseUrl: string,
  jwt: string,
  items: Array<{ id: string; update_token: string }>,
): Promise<ClaimBatchResult> {
  const resp = await fetch(`${baseUrl}/api/me/claim-batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      [AUTH_HEADER]: jwt,
      [CSRF_HEADER]: '1',
    },
    body: JSON.stringify({ items }),
  })
  return handleResponse<ClaimBatchResult>(resp, 'Claim batch')
}

export async function listMyPages(
  baseUrl: string,
  jwt: string,
  cursor?: string,
): Promise<PageListResult> {
  const url = new URL(`${baseUrl}/api/me/pages`)
  if (cursor !== undefined) url.searchParams.set('cursor', cursor)

  const resp = await fetch(url.toString(), {
    headers: {
      'User-Agent': USER_AGENT,
      [AUTH_HEADER]: jwt,
    },
  })
  return handleResponse<PageListResult>(resp, 'List my pages')
}

export async function logoutSession(baseUrl: string, jwt: string): Promise<void> {
  const resp = await fetch(`${baseUrl}/auth/logout`, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      [AUTH_HEADER]: jwt,
      [CSRF_HEADER]: '1',
    },
  })
  // Best-effort: don't throw on HTTP errors, caller always clears session
  if (!resp.ok && resp.status !== 401) {
    // ignore — caller will clear session regardless
  }
}

export async function cliExchangeCode(
  baseUrl: string,
  code: string,
  state: string,
): Promise<AuthTokenResult> {
  const resp = await fetch(`${baseUrl}/auth/cli/exchange`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({ code, state }),
  })
  return handleResponse<AuthTokenResult>(resp, 'CLI exchange')
}

/**
 * Start a device sign-in: aired's own flow (POST, any sign-in method), or
 * GitHub's (GET) on a server that doesn't have it yet.
 */
export async function requestDeviceCode(baseUrl: string): Promise<DeviceCodeResult> {
  const resp = await fetch(`${baseUrl}/auth/device`, {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT },
  })
  if (resp.status === 404 || resp.status === 405) {
    const legacy = await fetch(`${baseUrl}/auth/device`, {
      headers: { 'User-Agent': USER_AGENT },
    })
    return handleResponse<DeviceCodeResult>(legacy, 'Request device code')
  }
  return handleResponse<DeviceCodeResult>(resp, 'Request device code')
}

export async function pollDeviceToken(
  baseUrl: string,
  deviceCode: string,
): Promise<{ status: number; data: AuthTokenResult | { error: string } | null }> {
  const resp = await fetch(`${baseUrl}/auth/device/poll`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({ device_code: deviceCode }),
  })

  if (resp.status === 200) {
    const data = (await resp.json()) as AuthTokenResult
    return { status: 200, data }
  }

  if (resp.status === 202) {
    return { status: 202, data: null }
  }

  let errorData: { error: string } = { error: `Poll failed (${resp.status})` }
  try {
    // /auth answers flat, and the device flow's `error` is a code (RFC 8628): max_attempts, device_code_expired.
    const { message, code } = apiErrorOf(await resp.json())
    const said = message ?? code
    if (said !== null) errorData = { error: said }
  } catch {
    // ignore
  }
  return { status: resp.status, data: errorData }
}

/** The headers that say who's calling: the CLI session (if any) and AIRED_API_KEY (if set). */
function callerHeaders(jwt?: string): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
  if (jwt !== undefined) {
    headers[AUTH_HEADER] = jwt
    headers[CSRF_HEADER] = '1'
  }
  return addApiKey(headers)
}

/**
 * Change a page's settings without its HTML (PATCH /api/pages/:id). `token`
 * is the stored update token, '' when there is none (the session or API
 * key must then own the page).
 */
export async function setPageOptions(
  baseUrl: string,
  id: string,
  change: Record<string, unknown>,
  token: string,
  jwt?: string,
): Promise<PageDetails> {
  const body = token !== '' ? { ...change, update_token: token } : change
  const resp = await fetch(`${baseUrl}/api/pages/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...callerHeaders(jwt), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleResponse<PageDetails>(resp, 'Set')
}

/** The owner's view of a page (GET /api/pages/:id/details). */
export async function getPageDetails(baseUrl: string, id: string, token: string, jwt?: string): Promise<PageDetails> {
  const headers = callerHeaders(jwt)
  if (token !== '') headers['X-Update-Token'] = token
  const resp = await fetch(`${baseUrl}/api/pages/${encodeURIComponent(id)}/details`, { headers })
  return handleResponse<PageDetails>(resp, 'Get page')
}

/** Feedback about aired itself (POST /api/feedback). Signed in if a session or key is there. */
export async function sendFeedback(baseUrl: string, feedback: Record<string, unknown>, jwt?: string): Promise<FeedbackResult> {
  const resp = await fetch(`${baseUrl}/api/feedback`, {
    method: 'POST',
    headers: { ...callerHeaders(jwt), 'Content-Type': 'application/json' },
    body: JSON.stringify(feedback),
  })
  return handleResponse<FeedbackResult>(resp, 'Feedback')
}

/**
 * Render a page in aired's browser and report what's broken (POST
 * /api/pages/:id/check). `token` is the stored update token, '' when the
 * session or API key owns the page.
 */
export async function checkPage(
  baseUrl: string,
  id: string,
  opts: { token: string; jwt?: string; viewport: 'desktop' | 'mobile' },
): Promise<CheckReport> {
  const body: Record<string, unknown> = { viewport: opts.viewport }
  if (opts.token !== '') body['update_token'] = opts.token
  const resp = await fetch(`${baseUrl}/api/pages/${encodeURIComponent(id)}/check`, {
    method: 'POST',
    headers: { ...callerHeaders(opts.jwt), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleResponse<CheckReport>(resp, 'Check')
}

/**
 * POST /api/pages/:id/pdf: make (or reuse) the page's PDF and get a link to
 * it. As for checks: the update token, else the session or API key owns
 * the page. Speaker notes need the signed-in owner.
 */
export async function exportPdf(
  baseUrl: string,
  id: string,
  opts: { token: string; jwt?: string; notes?: boolean; paper?: 'a4' | 'letter' },
): Promise<PdfExport> {
  const body: Record<string, unknown> = {}
  if (opts.token !== '') body['update_token'] = opts.token
  if (opts.notes) body['notes'] = true
  if (opts.paper !== undefined) body['paper'] = opts.paper
  const resp = await fetch(`${baseUrl}/api/pages/${encodeURIComponent(id)}/pdf`, {
    method: 'POST',
    headers: { ...callerHeaders(opts.jwt), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleResponse<PdfExport>(resp, 'PDF export')
}

/** One version in a page's history (GET /api/pages/:id/versions). */
export interface PageVersionInfo {
  version: number
  current: boolean
  size: number
  title: string | null
  kind: 'page' | 'doc' | 'deck'
  actor: string
  client: string | null
  message: string | null
  restored_from: number | null
  created_at: string | null
  replaced_at: string | null
  kept_until: string | null
}

export interface VersionsResult {
  id: string
  url: string
  current: number | null
  versions: PageVersionInfo[]
  kept: { plan: string; versions: number; days: number | null; always_keep: number; summary: string }
}

export interface RestoreResult {
  id: string
  url: string
  version: number | null
  restored_from: number
  expiresAt: string | null
  kind?: string
  slides?: number
  presenter_url?: string
}

/** A page's history. `token` is the stored update token, '' when the session or API key owns the page. */
export async function listVersions(baseUrl: string, id: string, token: string, jwt?: string): Promise<VersionsResult> {
  const headers = callerHeaders(jwt)
  if (token !== '') headers['X-Update-Token'] = token
  const resp = await fetch(`${baseUrl}/api/pages/${encodeURIComponent(id)}/versions`, { headers })
  return handleResponse<VersionsResult>(resp, 'Versions')
}

/** Put an earlier version back (POST /api/pages/:id/versions/:n/restore): it goes live as a new version. */
export async function restoreVersion(
  baseUrl: string,
  id: string,
  version: number,
  opts: { token: string; jwt?: string; message?: string },
): Promise<RestoreResult> {
  const body: Record<string, unknown> = {}
  if (opts.token !== '') body['update_token'] = opts.token
  if (opts.message !== undefined) body['message'] = opts.message
  const resp = await fetch(`${baseUrl}/api/pages/${encodeURIComponent(id)}/versions/${version}/restore`, {
    method: 'POST',
    headers: { ...callerHeaders(opts.jwt), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleResponse<RestoreResult>(resp, 'Restore')
}

/**
 * The signed-in account's pages, newest first (GET /api/me/pages, what the
 * dashboard lists): one page of at most 50. Signed in by `jwt`, else by
 * AIRED_API_KEY.
 */
export async function listOwnPages(
  baseUrl: string,
  opts: { jwt?: string; project?: string; limit: number; cursor?: string },
): Promise<{ pages: OwnPage[]; cursor: string | null }> {
  const url = new URL(`${baseUrl}/api/me/pages`)
  url.searchParams.set('limit', String(opts.limit))
  if (opts.project !== undefined) url.searchParams.set('project', opts.project)
  if (opts.cursor !== undefined) url.searchParams.set('cursor', opts.cursor)
  const resp = await fetch(url.toString(), { headers: callerHeaders(opts.jwt) })
  return handleResponse<{ pages: OwnPage[]; cursor: string | null }>(resp, 'List')
}

/** What was published (GET /api/pages/:id/source). `token` is the stored update token, '' when the session or API key owns the page. */
export async function getPageSource(baseUrl: string, id: string, token: string, jwt?: string): Promise<PageSource> {
  const headers = callerHeaders(jwt)
  if (token !== '') headers['X-Update-Token'] = token
  const resp = await fetch(`${baseUrl}/api/pages/${encodeURIComponent(id)}/source`, { headers })
  return handleResponse<PageSource>(resp, 'Pull')
}
