import type { StatsLive } from "../types.js";

/**
 * Load the merged stats blob from KV.
 * If "stats:live" doesn't exist yet, migrates from the legacy separate keys
 * (stats:publishes, stats:views, stats:geo:*, stats:recent-views) and
 * persists the merged result.
 */
export async function loadStats(kv: KVNamespace): Promise<StatsLive> {
  const raw = await kv.get("stats:live");
  if (raw) return JSON.parse(raw);

  // Migrate from legacy keys
  const [publishes, views, recentRaw, geoKeys] = await Promise.all([
    kv.get("stats:publishes"),
    kv.get("stats:views"),
    kv.get("stats:recent-views"),
    kv.list({ prefix: "stats:geo:" }),
  ]);

  const geo: Record<string, number> = {};
  if (geoKeys.keys.length > 0) {
    const values = await Promise.all(
      geoKeys.keys.map((k) => kv.get(k.name)),
    );
    for (let i = 0; i < geoKeys.keys.length; i++) {
      const cc = geoKeys.keys[i]!.name.replace("stats:geo:", "");
      geo[cc] = parseInt(values[i] ?? "0", 10);
    }
  }

  const stats: StatsLive = {
    publishes: parseInt(publishes ?? "0", 10),
    views: parseInt(views ?? "0", 10),
    recent: recentRaw ? JSON.parse(recentRaw) : [],
    geo,
  };

  // Persist the merged blob and clean up legacy keys.
  // If writes fail (e.g. daily limit), return the data anyway —
  // next call will retry the migration until it sticks.
  try {
    await kv.put("stats:live", JSON.stringify(stats));
    // Only clean up after successful persist
    await Promise.all([
      kv.delete("stats:publishes"),
      kv.delete("stats:views"),
      kv.delete("stats:recent-views"),
      ...geoKeys.keys.map((k) => kv.delete(k.name)),
    ]).catch(() => {});
  } catch {
    // Write limit hit — data is still returned from legacy keys
  }

  return stats;
}

/**
 * Persist the stats blob back to KV.
 */
export async function saveStats(kv: KVNamespace, stats: StatsLive): Promise<void> {
  await kv.put("stats:live", JSON.stringify(stats));
}
