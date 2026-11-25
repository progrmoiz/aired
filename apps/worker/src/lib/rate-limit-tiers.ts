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
  claim_batch:   { bucketPrefix: 'rl:claim',  limit: 5,  windowSeconds: 3600 },
  delete:        { bucketPrefix: 'rl:delete', limit: 10, windowSeconds: 3600 },
  // OAuth init endpoints need higher limits — each sign-in attempt fires multiple
  // requests (init + callback + retries on stale browser tabs).
  oauth_init:    { bucketPrefix: 'rl:oauth',  limit: 60, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitTier>;

/** Signed-in publishes count against the account; anonymous ones against the IP. */
export function publishTier(user: unknown): RateLimitTier {
  return user !== null && user !== undefined ? TIERS.authenticated : TIERS.anonymous;
}
