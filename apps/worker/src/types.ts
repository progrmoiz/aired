export type Env = {
  PAGES_BUCKET: R2Bucket;
  PAGES_KV: KVNamespace;
  // Cloudflare Workers static assets binding (populated by [assets] in wrangler.toml)
  ASSETS: Fetcher;
};

export type AppBindings = {
  Bindings: Env;
};

/** Merged stats blob — single KV key "stats:live" replaces separate counters */
export type StatsLive = {
  publishes: number;
  views: number;
  geo: Record<string, number>;
  recent: { title: string; country: string; ts: number }[];
};
