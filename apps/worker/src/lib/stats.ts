import type { StatsLive } from "../types.js";

/**
 * Keep only the aggregate counters. Older blobs also carried a `recent`
 * list of page titles; dropping unknown fields here means the next save
 * removes those titles from KV.
 */
export function parseStats(raw: string | null): StatsLive {
  const data = raw ? (JSON.parse(raw) as Partial<StatsLive>) : {};
  return {
    publishes: data.publishes ?? 0,
    views: data.views ?? 0,
    geo: { ...(data.geo ?? {}) },
  };
}

/**
 * Count one page view. Only the total and the viewer's country are
 * recorded, never anything about the page itself.
 */
export function recordView(stats: StatsLive, country: string): StatsLive {
  stats.views += 1;
  stats.geo[country] = (stats.geo[country] ?? 0) + 1;
  return stats;
}

/** The body of the public GET /api/stats endpoint. */
export function publicStats(stats: StatsLive): StatsLive {
  return { publishes: stats.publishes, views: stats.views, geo: stats.geo };
}

/**
 * Load the merged stats blob from KV.
 */
export async function loadStats(kv: KVNamespace): Promise<StatsLive> {
  return parseStats(await kv.get("stats:live"));
}

/**
 * Persist the stats blob back to KV.
 */
export async function saveStats(kv: KVNamespace, stats: StatsLive): Promise<void> {
  await kv.put("stats:live", JSON.stringify(stats));
}
