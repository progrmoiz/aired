/**
 * Per-account "sessions valid since" (KV svs:<uid>, Unix seconds). Set when
 * the account is deleted or its owner signs out everywhere; every session
 * (web cookie or CLI token) and every MCP OAuth grant issued before it stops
 * working. Read with a short edge cache, so the check is cheap on every
 * request; a revocation reaches every location within about a minute.
 * No runtime imports, so tests load it directly.
 */

/** Kept past the longest session (CLI tokens: 365 days). */
const MARKER_TTL_SECONDS = 400 * 24 * 60 * 60;

export const sessionsValidSinceKey = (uid: number) => `svs:${uid}`;

/**
 * The account's marker. `fresh` asks for the shortest cache KV allows (not a
 * consistent read: KV writes take up to a minute to reach every location).
 * Revocation doesn't depend on it: anything minted from a stale read keeps
 * the original sign-in time and is retired once the marker is seen.
 */
export async function sessionsValidSince(kv: KVNamespace, uid: number, opts: { fresh?: boolean } = {}): Promise<number | null> {
  const raw = await kv.get(sessionsValidSinceKey(uid), opts.fresh ? undefined : { cacheTtl: 60 });
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Retire everything issued so far. Rounded up, so a token minted in this same second is retired too. */
export async function revokeAllSessions(kv: KVNamespace, uid: number, nowMs = Date.now()): Promise<number> {
  const since = Math.ceil(nowMs / 1000);
  await kv.put(sessionsValidSinceKey(uid), String(since), { expirationTtl: MARKER_TTL_SECONDS });
  return since;
}

/** Whether something issued at `issuedAt` (Unix seconds) is retired by the marker. */
export function retiredBy(since: number | null, issuedAt: number | null | undefined): boolean {
  if (since === null) return false;
  return typeof issuedAt !== 'number' || issuedAt < since;
}
