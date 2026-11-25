/**
 * How a view writes the page's read count back to KV without changing when
 * the page expires. No imports, so tests load it directly.
 *
 * - `expired`: the page's expiresAt has passed (KV can still hand out the
 *   record for a moment). Don't serve it, and don't write it back: a write
 *   without a TTL would make it permanent.
 * - `options: null`: under a minute left, which is below KV's minimum TTL.
 *   Skip the count rather than risk a failed or TTL-less write.
 * - otherwise the KV put options that keep the original expiry.
 */
export type ViewWrite = { expired: true } | { expired: false; options: { expiration?: number } | null };

export const KV_MIN_TTL_SEC = 60;

export function viewWrite(page: { permanent: boolean; expiresAt: string | null }, nowMs: number): ViewWrite {
  if (page.permanent || page.expiresAt === null) return { expired: false, options: {} };
  const expMs = Date.parse(page.expiresAt);
  if (!Number.isFinite(expMs)) return { expired: false, options: null };
  if (expMs <= nowMs) return { expired: true };
  if (expMs - nowMs < KV_MIN_TTL_SEC * 1000) return { expired: false, options: null };
  return { expired: false, options: { expiration: Math.floor(expMs / 1000) } };
}
