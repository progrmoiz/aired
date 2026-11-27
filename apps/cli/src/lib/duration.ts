/** A --ttl value (90, 30m, 24h, 7d) in seconds, or null if it isn't one. A bare number is seconds. */
export function parseTtl(ttl: string): number | null {
  const match = /^(\d+)(h|d|m)?$/i.exec(ttl)
  if (!match) return null
  const n = parseInt(match[1]!, 10)
  const unit = (match[2] ?? 's').toLowerCase()
  if (unit === 'h') return n * 3600
  if (unit === 'd') return n * 86400
  if (unit === 'm') return n * 60
  return n
}
