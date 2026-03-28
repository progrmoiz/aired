export type Env = {
  PAGES_BUCKET: R2Bucket;
  PAGES_KV: KVNamespace;
  // Cloudflare Workers static assets binding (populated by [assets] in wrangler.toml)
  ASSETS: Fetcher;
};

export type AppBindings = {
  Bindings: Env;
};
