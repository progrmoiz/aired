import { USER_AGENT } from '../lib/constants.js'
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
): Promise<PublishResult> {
  const body: Record<string, unknown> = { html }

  if (options.title !== undefined) body['title'] = options.title
  if (options.pin !== undefined) body['pin'] = options.pin
  if (options.ttl !== undefined) body['ttl'] = options.ttl
  if (options.reads !== undefined) body['reads'] = options.reads
  if (options.permanent === true) body['permanent'] = true
  if (options.update_token !== undefined) body['update_token'] = options.update_token
  if (options.id !== undefined) body['id'] = options.id

  const resp = await fetch(`${baseUrl}/api/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
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
): Promise<PublishResult> {
  const body: Record<string, unknown> = { html, update_token: token }
  if (options.title !== undefined) body['title'] = options.title

  const resp = await fetch(`${baseUrl}/api/pages/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify(body),
  })

  return handleResponse<PublishResult>(resp, 'Update')
}

export async function deletePage(
  baseUrl: string,
  id: string,
  token: string,
): Promise<void> {
  const resp = await fetch(`${baseUrl}/api/pages/${id}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': USER_AGENT,
    },
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
