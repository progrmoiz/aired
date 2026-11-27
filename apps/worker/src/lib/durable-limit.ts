/**
 * Durable rate limits in D1 `rate_limits` (migrations/0013_rate_limits.sql),
 * for the limits that are a plan promise: publishes (5 an hour per IP
 * anonymous, 30 an hour signed in, 500 a day on Pro). Every isolate counts
 * against the same row, unlike the in-memory limiter.
 *
 * The same rule the in-memory limiter always had: a bucket's window starts
 * at its first request and lasts `windowSeconds`; up to `limit` requests
 * fit in it; the next request after it ends starts a new window. So a
 * caller can use the whole quota at once and gets all of it back one window
 * later. One statement checks and counts: it adds one only while the count
 * is under the limit (or the window has ended), and returns no row
 * otherwise. So a refused request writes nothing, and two requests at once
 * can't both take the last slot.
 *
 * No runtime imports, so tests load it directly.
 */

export type DurableLimit = { limit: number; windowSeconds: number };

// In SET, every column refers to the row as it was, so all three CASEs see
// the old expires_at.
const CHECK_AND_COUNT = `
INSERT INTO rate_limits (bucket, window_start, count, expires_at) VALUES (?, ?, 1, ?)
ON CONFLICT (bucket) DO UPDATE SET
  window_start = CASE WHEN rate_limits.expires_at <= excluded.window_start THEN excluded.window_start ELSE rate_limits.window_start END,
  count = CASE WHEN rate_limits.expires_at <= excluded.window_start THEN 1 ELSE rate_limits.count + 1 END,
  expires_at = CASE WHEN rate_limits.expires_at <= excluded.window_start THEN excluded.expires_at ELSE rate_limits.expires_at END
WHERE rate_limits.expires_at <= excluded.window_start OR rate_limits.count < ?
RETURNING count`;

/**
 * Count one request against `bucket`. True if it's within the limit (and
 * was counted), false if it's over (and wasn't). Throws on a D1 error, so the
 * caller decides what to do then.
 */
export async function takeDurableSlot(
  db: D1Database,
  bucket: string,
  { limit, windowSeconds }: DurableLimit,
  nowMs: number,
): Promise<boolean> {
  const now = Math.floor(nowMs);
  const row = await db
    .prepare(CHECK_AND_COUNT)
    .bind(bucket, now, now + windowSeconds * 1000, limit)
    .first<{ count: number }>();
  return row !== null;
}

/** Delete rows whose window has ended: the next request starts afresh either way. Returns how many went. */
export async function pruneRateLimits(db: D1Database, nowMs: number): Promise<number> {
  const res = await db
    .prepare("DELETE FROM rate_limits WHERE expires_at <= ?")
    .bind(Math.floor(nowMs))
    .run();
  return res.meta.changes ?? 0;
}

/** Stripe stops retrying a webhook after 3 days; 30 days of event ids is plenty for dedupe. */
export const BILLING_EVENTS_KEEP_DAYS = 30;

/** Delete webhook dedupe rows older than BILLING_EVENTS_KEEP_DAYS. Returns how many went. */
export async function pruneBillingEvents(db: D1Database, nowMs: number): Promise<number> {
  const cutoff = new Date(nowMs - BILLING_EVENTS_KEEP_DAYS * 86_400_000).toISOString();
  const res = await db.prepare("DELETE FROM billing_events WHERE received_at < ?").bind(cutoff).run();
  return res.meta.changes ?? 0;
}
