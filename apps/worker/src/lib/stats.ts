import type { StatsLive } from "../types.js";

const EMPTY_STATS: StatsLive = { publishes: 0, views: 0, geo: {}, recent: [] };

/**
 * Load the merged stats blob from KV.
 */
export async function loadStats(kv: KVNamespace): Promise<StatsLive> {
  const raw = await kv.get("stats:live");
  return raw ? JSON.parse(raw) : EMPTY_STATS;
}

/**
 * Persist the stats blob back to KV.
 */
export async function saveStats(kv: KVNamespace, stats: StatsLive): Promise<void> {
  await kv.put("stats:live", JSON.stringify(stats));
}
