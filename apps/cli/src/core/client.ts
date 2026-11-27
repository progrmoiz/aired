import { USER_AGENT } from '../lib/constants.js'
import { AUTH_HEADER, CSRF_HEADER } from '@aired/core'
import type { User } from '@aired/core'
import type { PublishResult, PageInfo, PageDetails, FeedbackResult } from './types.js'

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

async function handleResponse<T>(resp: Response, action: string): Promise<T> {
  if (resp.status === 429) {
    // Publishes keep their familiar message; other limits (set, feedback) say their own.
    let message = 'Rate limited: too many uploads. Try again in an hour.'
    if (action !== 'Publish' && action !== 'Update') {
      try {
        const body = (await resp.json()) as Record<string, unknown>
        if (typeof body['error'] === 'string') message = `Rate limited: ${body['error']}`
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
    try {
      const body = (await resp.json()) as Record<string, unknown>
      if (typeof body['error'] === 'string') {
        message = body['error']
      }
    } catch {
      // ignore
    }
    throw new Error(message)
  }

  try {
    return (await resp.json()) as T
  } catch {
    throw new Error(`${action}: unexpected response format`)
  }
}

export async function publishHTML(
  baseUrl: string,
  html: string,
  options: PublishOptions = {},
  jwt?: string,
): Promise<PublishResponse> {
  const body: Record<string, unknown> = { html }

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
  const resp = await fetch(`${baseUrl}/api/publish`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  return handleResponse<PublishResponse>(resp, 'Publish')
}

export async function updatePage(
  baseUrl: string,
  id: string,
  html: string,
  token: string,
  options: { title?: string } = {},
  jwt?: string,
): Promise<PublishResult> {
  const body: Record<string, unknown> = { html, update_token: token }
  if (options.title !== undefined) body['title'] = options.title

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
    const body = (await resp.json()) as Record<string, unknown>
    if (typeof body['error'] === 'string') {
      errorData = { error: body['error'] }
    }
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
