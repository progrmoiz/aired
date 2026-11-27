export type Env = {
  PAGES_BUCKET: R2Bucket;
  /**
   * Backups (lib/backup.ts): nightly KV + D1 snapshots and the sweep's copies
   * of the files it deletes. Optional so tests run without it; without it the
   * sweep deletes nothing.
   */
  BACKUP_BUCKET?: R2Bucket;
  /**
   * Secret (`wrangler secret put ADMIN_TOKEN`, 32+ characters) that turns on
   * /api/admin/* (routes/admin.ts), sent as X-Admin-Token. Unset: those
   * routes answer 404. Delete it when the job it was set for is done.
   */
  ADMIN_TOKEN?: string;
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
  DEVICE_BURST?: RateLimit;
  OAUTH_BURST?: RateLimit;
  /** Sign-in starts (/auth/login, /auth/github, /auth/cli, GET /auth/device), per IP. */
  SIGNIN_BURST?: RateLimit;
  /** Favicon fetches on a cache miss (routes/favicon.ts), per account. */
  FAVICON_BURST?: RateLimit;
  /** The OAuth grant store for the remote MCP (bound to the PAGES_KV namespace). */
  OAUTH_KV?: KVNamespace;
  /**
   * Set only in code, on the env of an in-process API call made for an MCP
   * tool call that came with an OAuth token (withMcpOAuthUser). Never a var.
   */
  AIRED_MCP_OAUTH_USER?: number;
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
  /**
   * This deploy's own origin, for every absolute link the Worker writes
   * (lib/origin.ts siteOrigin). Unset in production (https://aired.sh);
   * local dev and self-hosted deploys set it.
   */
  SITE_ORIGIN?: string;
  /** WorkOS AuthKit sign-in: on only when both are set (lib/workos.ts). */
  WORKOS_CLIENT_ID?: string;
  WORKOS_API_KEY?: string;
  /** Local tests point this at a mock. */
  WORKOS_API_BASE?: string;
  /** Browser Rendering (wrangler.toml [browser]), for link-preview screenshots. Unset: cards only. */
  BROWSER?: Fetcher;
  /** Daily browser time for screenshots, in seconds (lib/og-shot.ts). Default 480; "0" turns them off. */
  OG_SHOT_DAILY_SECONDS?: string;
  /** Daily browser time for check_page, in seconds, inside OG_SHOT_DAILY_SECONDS (lib/page-check.ts). Default 180; "0" turns checks off. */
  CHECK_DAILY_SECONDS?: string;
  /** Workers Rate Limiting binding: data-layer calls per network per minute (routes/collect.ts). */
  COLLECT_BURST?: RateLimit;
  /** Workers Rate Limiting binding: page checks per caller per minute (routes/page-tools.ts). */
  CHECK_BURST?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /**
   * Analytics Engine dataset `aired_views` (wrangler.toml): one data point
   * per page view (lib/view-event.ts). Optional so tests run without it;
   * local `wrangler dev` accepts writes and keeps nothing.
   */
  VIEWS?: AnalyticsEngineDataset;
  /**
   * Secret: a Cloudflare API token with Account Analytics Read, for the
   * Analytics Engine SQL API that Pro analytics reads (lib/analytics.ts).
   * Unset: /api/me/analytics answers 503.
   */
  CF_ANALYTICS_TOKEN?: string;
  /** The Cloudflare account id that owns the dataset (a var, not secret). */
  CF_ACCOUNT_ID?: string;
  /**
   * Local dev only (.dev.vars): "1" makes /api/me/analytics answer with
   * made-up numbers instead of calling Cloudflare, which keeps nothing locally.
   */
  ANALYTICS_DEMO?: string;
  /**
   * Email for "only these people" codes (lib/email-sender.ts). ACCESS_EMAIL
   * is the Cloudflare Email Service binding (wrangler.toml [[send_email]]);
   * RESEND_API_KEY a fallback provider; EMAIL_FROM the sender, e.g.
   * `aired <access@aired.sh>`. EMAIL_MODE "log" (local dev only, in
   * .dev.vars) writes the email to the console instead of sending it.
   */
  ACCESS_EMAIL?: { send(message: { to: string; from: string | { email: string; name: string }; subject: string; text?: string; html?: string }): Promise<unknown> };
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_MODE?: string;
};

export type AppBindings = {
  Bindings: Env;
  Variables: {
    user: { id: number; login: string; email: string | null; name: string | null } | null;
    jti: string | null;
    /** How the caller signed in: a session (cookie or CLI header), an API key, or not at all. */
    /**
     * How the caller signed in: 'cookie' (the website), 'cli' (a CLI token in
     * the aired-Session header), 'key' (an API key) or 'oauth' (an MCP tool
     * call made with an OAuth token). null when anonymous.
     */
    via: 'cookie' | 'cli' | 'key' | 'oauth' | null;
    /** When the person signed in (Unix seconds), for 'cookie' and 'cli' callers. */
    authTime: number | null;
    /** The API key's id when via is 'key'. */
    apiKeyId: string | null;
    /** This request's id for log lines (middleware/request-id.ts). */
    requestId: string;
  };
};

/** Merged stats blob — single KV key "stats:live" replaces separate counters */
export type StatsLive = {
  publishes: number;
  views: number;
  geo: Record<string, number>;
};
