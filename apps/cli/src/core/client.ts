import { USER_AGENT } from '../lib/constants.js'
import { AUTH_HEADER, CSRF_HEADER } from '@aired/core'
import type { User } from '@aired/core'
import type { PublishResult, PageInfo } from './types.js'

export interface PublishOptions {
  title?: string
  pin?: string
  ttl?: number
  reads?: number
  permanent?: boolean
  update_token?: string
  id?: string
}

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
  id: string
}

export interface PageListResult {
  pages: PageInfo[]
  cursor?: string
}

export interface DeviceCodeResult {
  user_code: string
  verification_uri: string
  interval: number
  device_code: string
}

export interface AuthTokenResult {
  jwt: string
  user: User
}

async function handleResponse<T>(resp: Response, action: string): Promise<T> {
  if (resp.status === 429) {
    const err = new Error('Rate limited: too many uploads. Try again in an hour.')
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
): Promise<PublishResult> {
  const body: Record<string, unknown> = { html }

  if (options.title !== undefined) body['title'] = options.title
  if (options.pin !== undefined) body['pin'] = options.pin
  if (options.ttl !== undefined) body['ttl'] = options.ttl
  if (options.reads !== undefined) body['reads'] = options.reads
  if (options.permanent === true) body['permanent'] = true
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

  const resp = await fetch(`${baseUrl}/api/publish`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  return handleResponse<PublishResult>(resp, 'Publish')
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
    'Authorization': `Bearer ${token}`,
    'User-Agent': USER_AGENT,
  }

  if (jwt !== undefined) {
    headers[AUTH_HEADER] = jwt
    headers[CSRF_HEADER] = '1'
  }

  const resp = await fetch(`${baseUrl}/api/pages/${id}`, {
    method: 'DELETE',
    headers,
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
): Promise<{ claimed: string[]; failed: string[] }> {
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
  return handleResponse<{ claimed: string[]; failed: string[] }>(resp, 'Claim batch')
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

export async function requestDeviceCode(baseUrl: string): Promise<DeviceCodeResult> {
  const resp = await fetch(`${baseUrl}/auth/device`, {
    headers: { 'User-Agent': USER_AGENT },
  })
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
