export type RateLimitTier = {
  bucketPrefix: string;
  limit: number;
  windowSeconds: number;
  /**
   * Workers Rate Limiting binding that also caps anonymous requests per
   * minute (see lib/burst-limit.ts). Signed-in users skip it.
   */
  burst?: 'PUBLISH_BURST' | 'REPORT_BURST' | 'DEVICE_BURST' | 'OAUTH_BURST' | 'SIGNIN_BURST';
  /**
   * Count in D1 (lib/durable-limit.ts), shared by every isolate, instead of
   * in memory. For the limits that are a plan promise: publishes.
   */
  durable?: true;
};

export const TIERS = {
  // Publishes: durable, so 5 an hour means 5 an hour across all of Cloudflare.
  anonymous:     { bucketPrefix: 'rl:ip',     limit: 5,  windowSeconds: 3600, burst: 'PUBLISH_BURST', durable: true },
  report:        { bucketPrefix: 'rl:report', limit: 10, windowSeconds: 3600, burst: 'REPORT_BURST' },
  authenticated: { bucketPrefix: 'rl:user',   limit: 30, windowSeconds: 3600, durable: true },
  pro:           { bucketPrefix: 'rl:pro',    limit: 500, windowSeconds: 86400, durable: true },
  claim_batch:   { bucketPrefix: 'rl:claim',  limit: 5,  windowSeconds: 3600 },
  delete:        { bucketPrefix: 'rl:delete', limit: 10, windowSeconds: 3600 },
  // Checkout, portal and /upgrade each call Stripe.
  billing:       { bucketPrefix: 'rl:billing', limit: 10, windowSeconds: 3600 },
  // OAuth init endpoints need higher limits — each sign-in attempt fires multiple
  // requests (init + callback + retries on stale browser tabs).
  oauth_init:    { bucketPrefix: 'rl:oauth',  limit: 60, windowSeconds: 3600 },
  // Sign-in starts (/auth/login, /auth/github, /auth/cli, GET /auth/device)
  // write KV on every hit: the same hourly bucket as oauth_init, plus a
  // per-minute flood guard counted by Cloudflare.
  signin_start:  { bucketPrefix: 'rl:oauth',  limit: 60, windowSeconds: 3600, burst: 'SIGNIN_BURST' },
  // Remote MCP tool calls made with an API key (per account). Publishes also
  // count against the account's publish limit inside the API.
  mcp_key:       { bucketPrefix: 'rl:mcpkey', limit: 120, windowSeconds: 3600 },
  // Page settings changes and owner detail reads (PATCH /api/pages/:id,
  // GET /api/pages/:id/details): each change writes D1 and KV.
  page_options:  { bucketPrefix: 'rl:opts',   limit: 60, windowSeconds: 3600 },
  // The owner's data-layer calls (routes/responses.ts): reading responses,
  // CSV, settings and update_data. Per caller.
  responses:     { bucketPrefix: 'rl:resp',   limit: 300, windowSeconds: 3600 },
  // Page checks (POST /api/pages/:id/check) each run a browser. The shared
  // daily browser budget (lib/page-check.ts) is the real cap; CHECK_BURST
  // adds a per-minute guard per caller, signed in or not.
  page_check:    { bucketPrefix: 'rl:check',  limit: 20, windowSeconds: 3600 },
  // Agent feedback (POST /api/feedback), in front of the D1 limit of 10 an
  // hour (lib/feedback.ts), so a flood never reaches D1. Anonymous senders
  // also get REPORT_BURST's per-minute guard.
  feedback:      { bucketPrefix: 'rl:feedback', limit: 20, windowSeconds: 3600, burst: 'REPORT_BURST' },
  // Remote MCP tool calls without a key that don't publish (get_page,
  // set_options, send_feedback), per IP. publish_html keeps the publish limit.
  mcp_anon:      { bucketPrefix: 'rl:mcpanon', limit: 60, windowSeconds: 3600 },
  // CLI device sign-in starts write to D1: an hourly cap plus a per-minute
  // flood guard counted by Cloudflare, not per isolate.
  device_start:  { bucketPrefix: 'rl:devstart', limit: 30, windowSeconds: 3600, burst: 'DEVICE_BURST' },
  // MCP OAuth: dynamic client registration writes KV for anyone.
  oauth_register: { bucketPrefix: 'rl:oauthreg', limit: 20, windowSeconds: 3600, burst: 'OAUTH_BURST' },
  // MCP OAuth token endpoint: hosted clients refresh for many people from few IPs.
  oauth_token:   { bucketPrefix: 'rl:oauthtok', limit: 5000, windowSeconds: 3600 },
  // CLI device sign-in polls: one every 5 seconds for up to 10 minutes.
  device_poll:   { bucketPrefix: 'rl:devpoll', limit: 400, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitTier>;

/**
 * Signed-in publishes count against the account (Pro accounts get the daily
 * Pro allowance); anonymous ones against the IP. `ent` is the caller's
 * entitlements (lib/entitlements.ts), typed structurally to keep this file import-free.
 */
export function publishTier(
  user: unknown,
  ent?: { publishTier: 'authenticated' | 'pro' } | null,
): RateLimitTier {
  if (user === null || user === undefined) return TIERS.anonymous;
  return ent?.publishTier === 'pro' ? TIERS.pro : TIERS.authenticated;
}
