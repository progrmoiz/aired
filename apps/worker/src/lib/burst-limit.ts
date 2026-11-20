/**
 * Burst limiting with Cloudflare's Workers Rate Limiting binding.
 *
 * The in-memory limiter in middleware/rate-limit.ts counts per isolate, so a
 * flood spread across Cloudflare's isolates barely touches it. The binding is
 * counted by Cloudflare per location, costs no KV writes, and is the guard
 * against floods. Its window is fixed at 60 seconds, so it complements the
 * hourly in-memory limit rather than replacing it.
 *
 * It fails open: if the binding is missing (local tests) or errors, the
 * request is allowed and the in-memory limit still applies.
 */
export type BurstLimiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

export async function underBurstLimit(
  limiter: BurstLimiter | undefined,
  key: string,
): Promise<boolean> {
  if (limiter === undefined) return true;
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch (err) {
    console.error({ event: "burst_limit_error", error: String(err) });
    return true;
  }
}
