/**
 * GET /health: does the Worker reach its storage? Each probe is one cheap
 * read (a KV get, a D1 `SELECT 1`, an R2 head), all run at once with a
 * timeout. 200 when all pass, 503 when any fails, so an uptime monitor
 * pointed at /health catches a storage outage, not just a dead Worker.
 *
 * Results are reused for CACHE_MS per isolate so the endpoint can't be used
 * to run up storage reads.
 *
 * No imports, so tests load it directly under node --experimental-strip-types.
 */

export type Probe = () => Promise<unknown>;
export type CheckResult = { ok: boolean; ms: number; error?: string };
export type HealthReport = { status: "ok" | "degraded"; checks: Record<string, CheckResult> };

export const PROBE_TIMEOUT_MS = 3000;
export const CACHE_MS = 10_000;

/** The probes for the Worker's bindings. Missing keys and objects are fine: a reply means the store is up. */
export function storageProbes(env: {
  PAGES_KV: { get(key: string): Promise<unknown> };
  DB: { prepare(sql: string): { first(): Promise<unknown> } };
  PAGES_BUCKET: { head(key: string): Promise<unknown> };
}): Record<string, Probe> {
  return {
    kv: () => env.PAGES_KV.get("health:probe"),
    d1: () => env.DB.prepare("SELECT 1").first(),
    r2: () => env.PAGES_BUCKET.head("health/probe"),
  };
}

async function runProbe(probe: Probe, timeoutMs: number, now: () => number): Promise<CheckResult> {
  const start = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
    return { ok: true, ms: now() - start };
  } catch (err) {
    return { ok: false, ms: now() - start, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function checkHealth(
  probes: Record<string, Probe>,
  opts: { timeoutMs?: number; now?: () => number } = {},
): Promise<HealthReport> {
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  const now = opts.now ?? Date.now;
  const names = Object.keys(probes);
  const results = await Promise.all(names.map((n) => runProbe(probes[n]!, timeoutMs, now)));
  const checks: Record<string, CheckResult> = {};
  names.forEach((n, i) => (checks[n] = results[i]!));
  return { status: results.every((r) => r.ok) ? "ok" : "degraded", checks };
}

/** What the endpoint shows: pass/fail and timing only. Error text goes to the logs, not the public. */
export function publicReport(report: HealthReport): {
  status: HealthReport["status"];
  checks: Record<string, { ok: boolean; ms: number }>;
} {
  const checks: Record<string, { ok: boolean; ms: number }> = {};
  for (const [name, r] of Object.entries(report.checks)) checks[name] = { ok: r.ok, ms: r.ms };
  return { status: report.status, checks };
}

/** Per-isolate memo of the last report. */
export function cachedHealth(cacheMs = CACHE_MS, now: () => number = Date.now) {
  let last: { at: number; report: Promise<HealthReport> } | null = null;
  return (run: () => Promise<HealthReport>): { report: Promise<HealthReport>; fresh: boolean } => {
    const t = now();
    if (last !== null && t - last.at < cacheMs) return { report: last.report, fresh: false };
    const report = run();
    last = { at: t, report };
    // A rejected run isn't kept (checkHealth doesn't reject, but stay safe).
    report.catch(() => {
      if (last?.report === report) last = null;
    });
    return { report, fresh: true };
  };
}
