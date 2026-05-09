import type { User } from '@aired/core'
import { createStore } from './store-factory.js'

type SessionRecord = { jwt: string; user: User; savedAt: string }

function getConf() {
  return createStore<{ session?: SessionRecord }>('session')
}

export function getSession(): SessionRecord | null {
  try {
    const conf = getConf()
    const record = conf.get('session')
    if (!record) return null
    // Decode JWT exp; if past, clear and return null
    const segments = record.jwt.split('.')
    if (segments.length !== 3) { clearSession(); return null }
    const payload = JSON.parse(Buffer.from(segments[1]!, 'base64url').toString('utf-8')) as Record<string, unknown>
    if (typeof payload['exp'] === 'number' && payload['exp'] * 1000 < Date.now()) {
      clearSession()
      return null
    }
    return record
  } catch {
    return null // never throw
  }
}

export function saveSession(jwt: string, user: User): void {
  const conf = getConf()
  conf.set('session', { jwt, user, savedAt: new Date().toISOString() })
}

export function clearSession(): void {
  const conf = getConf()
  conf.delete('session')
}

export function getSessionPath(): string {
  return getConf().path
}
