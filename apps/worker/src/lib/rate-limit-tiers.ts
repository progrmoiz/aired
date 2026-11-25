export type RateLimitTier = {
  bucketPrefix: string;
  limit: number;
  windowSeconds: number;
  /**
   * Workers Rate Limiting binding that also caps anonymous requests per
   * minute (see lib/burst-limit.ts). Signed-in users skip it.
   */
  burst?: 'PUBLISH_BURST' | 'REPORT_BURST';
};

export const TIERS = {
  anonymous:     { bucketPrefix: 'rl:ip',     limit: 5,  windowSeconds: 3600, burst: 'PUBLISH_BURST' },
  report:        { bucketPrefix: 'rl:report', limit: 10, windowSeconds: 3600, burst: 'REPORT_BURST' },
  authenticated: { bucketPrefix: 'rl:user',   limit: 30, windowSeconds: 3600 },
  pro:           { bucketPrefix: 'rl:pro',    limit: 500, windowSeconds: 86400 },
  claim_batch:   { bucketPrefix: 'rl:claim',  limit: 5,  windowSeconds: 3600 },
  delete:        { bucketPrefix: 'rl:delete', limit: 10, windowSeconds: 3600 },
  // Checkout, portal and /upgrade each call Stripe.
  billing:       { bucketPrefix: 'rl:billing', limit: 10, windowSeconds: 3600 },
  // OAuth init endpoints need higher limits — each sign-in attempt fires multiple
  // requests (init + callback + retries on stale browser tabs).
  oauth_init:    { bucketPrefix: 'rl:oauth',  limit: 60, windowSeconds: 3600 },
  // Remote MCP tool calls made with an API key (per account). Publishes also
  // count against the account's publish limit inside the API.
  mcp_key:       { bucketPrefix: 'rl:mcpkey', limit: 120, windowSeconds: 3600 },
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
