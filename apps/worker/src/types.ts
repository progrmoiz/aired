export type Env = {
  PAGES_BUCKET: R2Bucket;
  PAGES_KV: KVNamespace;
  // Cloudflare Workers static assets binding (populated by [assets] in wrangler.toml)
  ASSETS: Fetcher;
  SESSION_SECRET: string;
  /** ISO timestamp; JWTs issued before this moment are rejected. Default: '1970-01-01T00:00:00Z' */
  SESSION_VALID_SINCE: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
};

export type AppBindings = {
  Bindings: Env;
  Variables: {
    user: { id: number; login: string; email: string | null; name: string | null } | null;
    jti: string | null;
  };
};

/** Merged stats blob — single KV key "stats:live" replaces separate counters */
export type StatsLive = {
  publishes: number;
  views: number;
  geo: Record<string, number>;
  recent: { title: string; country: string; ts: number }[];
};
