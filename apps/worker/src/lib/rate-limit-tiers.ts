export type RateLimitTier = {
  bucketPrefix: string;
  limit: number;
  windowSeconds: number;
};

export const TIERS = {
  anonymous:     { bucketPrefix: 'rl:ip',     limit: 5,  windowSeconds: 3600 },
  authenticated: { bucketPrefix: 'rl:user',   limit: 30, windowSeconds: 3600 },
  claim_batch:   { bucketPrefix: 'rl:claim',  limit: 5,  windowSeconds: 3600 },
  delete:        { bucketPrefix: 'rl:delete', limit: 10, windowSeconds: 3600 },
  // OAuth init endpoints need higher limits — each sign-in attempt fires multiple
  // requests (init + callback + retries on stale browser tabs).
  oauth_init:    { bucketPrefix: 'rl:oauth',  limit: 60, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitTier>;
