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
  /** Workers Rate Limiting bindings (wrangler.toml [[ratelimits]]). Optional so tests run without them. */
  PUBLISH_BURST?: RateLimit;
  REPORT_BURST?: RateLimit;
  PIN_GUESS?: RateLimit;
  PIN_GUESS_PAGE?: RateLimit;
  /** D1 database for accounts and billing state (wrangler.toml [[d1_databases]]). */
  DB: D1Database;
  /** "1" turns billing on (checkout, portal, Pro limits). Unset or anything else: off. */
  BILLING_ENABLED?: string;
  /** Stripe restricted API key (rk_…). Secret keys (sk_…) are refused. */
  STRIPE_SECRET_KEY?: string;
  /** Stripe webhook signing secret (whsec_…). */
  STRIPE_WEBHOOK_SECRET?: string;
  /** Stripe price id for the monthly Pro plan (price_…). */
  STRIPE_PRICE_MONTHLY?: string;
  /** Stripe price id for the yearly Pro plan (price_…). */
  STRIPE_PRICE_YEARLY?: string;
  /**
   * Older Pro price ids that still grant Pro, comma-separated (e.g. after a price
   * change). New checkouts always use the two prices above. Unset: none.
   */
  STRIPE_LEGACY_PRICE_IDS?: string;
  /** "1" turns on Stripe automatic tax in checkout. Unset: off. */
  STRIPE_AUTOMATIC_TAX?: string;
  /**
   * "1" turns on Stripe Managed Payments (Stripe as merchant of record; it
   * handles tax itself). Unset: off. Can't be combined with STRIPE_AUTOMATIC_TAX.
   */
  STRIPE_MANAGED_PAYMENTS?: string;
  /** Stripe API origin. Default https://api.stripe.com; override only for local mocks. */
  STRIPE_API_BASE?: string;
  /** Site origin for Stripe success/cancel/portal return URLs. Default https://aired.sh; set only for local dev. */
  SITE_ORIGIN?: string;
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
};
