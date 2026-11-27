/**
 * Durable rate limits in D1 `rate_limits` (migrations/0013_rate_limits.sql),
 * for the limits that are a plan promise: publishes (5 an hour per IP
 * anonymous, 30 an hour signed in, 500 a day on Pro). Every isolate counts
 * against the same rows, unlike the in-memory limiter.
 *
 * A sliding window from two fixed ones: the current window's count plus the
 * previous window's, weighted by how much of the previous window still
 * falls inside the last `windowSeconds`. One statement checks and counts:
 * it adds one only if the result stays within the limit, and returns no row
 * when it wouldn't. So a refused request writes nothing, and two requests
 * at once can't both take the last slot.
 *
 * No runtime imports, so tests load it directly.
 */

export type DurableLimit = { limit: number; windowSeconds: number };

/** Rows stay readable for two windows: the current and, as "previous", the next. */
const ROW_LIFETIME_WINDOWS = 2;

const CHECK_AND_COUNT = `
INSERT INTO rate_limits (bucket, window_start, count, expires_at)
SELECT ?, ?, 1, ?
WHERE 1 + ? * COALESCE((SELECT p.count FROM rate_limits p WHERE p.bucket = ? AND p.window_start = ?), 0) <= ?
ON CONFLICT (bucket, window_start) DO UPDATE SET count = rate_limits.count + 1
WHERE rate_limits.count + 1 + ? * COALESCE((SELECT p.count FROM rate_limits p WHERE p.bucket = ? AND p.window_start = ?), 0) <= ?
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
  const now = nowMs / 1000;
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const previousWeight = (windowSeconds - (now - windowStart)) / windowSeconds;
  const previousStart = windowStart - windowSeconds;
  const previous = [previousWeight, bucket, previousStart, limit];
  const row = await db
    .prepare(CHECK_AND_COUNT)
    .bind(bucket, windowStart, windowStart + ROW_LIFETIME_WINDOWS * windowSeconds, ...previous, ...previous)
    .first<{ count: number }>();
  return row !== null;
}

/** Delete rows no window reads any more. Returns how many went. */
export async function pruneRateLimits(db: D1Database, nowMs: number): Promise<number> {
  const res = await db
    .prepare("DELETE FROM rate_limits WHERE expires_at < ?")
    .bind(Math.floor(nowMs / 1000))
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
