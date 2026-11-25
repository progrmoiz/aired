export type Plan = 'free' | 'pro';

/** What we keep per user: the Stripe subscription status and when the paid period ends (ISO). */
export type SubscriptionState = { status: string; currentPeriodEnd: string | null };

export type Entitlements = {
  plan: Plan;
  /** Show the "Made with aired" badge on the owner's pages. */
  badge: boolean;
  maxBytes: number;
  /** Rate-limit tier for signed-in publishes (see lib/rate-limit-tiers.ts). */
  publishTier: 'authenticated' | 'pro';
};

export const FREE_MAX_BYTES = 2 * 1024 * 1024;
export const PRO_MAX_BYTES = 10 * 1024 * 1024;

/** A failed renewal keeps Pro for three days while Stripe retries the card. */
export const GRACE_MS = 3 * 24 * 3600 * 1000;

export const UPGRADE_URL = 'https://aired.sh/pricing';

const PAID_STATUSES = new Set(['active', 'trialing', 'past_due']);

const FREE: Entitlements = { plan: 'free', badge: true, maxBytes: FREE_MAX_BYTES, publishTier: 'authenticated' };
const PRO: Entitlements = { plan: 'pro', badge: false, maxBytes: PRO_MAX_BYTES, publishTier: 'pro' };

export function isEntitled(state: SubscriptionState | null, now: Date): boolean {
  if (!state || !PAID_STATUSES.has(state.status) || !state.currentPeriodEnd) return false;
  const end = Date.parse(state.currentPeriodEnd);
  if (Number.isNaN(end)) return false;
  return now.getTime() < end + GRACE_MS;
}

export function entitlementsFor(state: SubscriptionState | null, now: Date): Entitlements {
  return { ...(isEntitled(state, now) ? PRO : FREE) };
}

/** Body of the 402 a signed-in user gets when a free-plan limit blocks the request. */
export function planLimitError(
  limit: 'page_size' | 'publish_rate',
  ref?: string,
): { error: string; code: 'plan_limit'; limit: string; upgrade_url: string } {
  return {
    error: 'This needs Pro',
    code: 'plan_limit',
    limit,
    upgrade_url: `${UPGRADE_URL}?ref=${ref ?? 'api'}`,
  };
}

export function billingEnabled(env: { BILLING_ENABLED?: string }): boolean {
  return env.BILLING_ENABLED === '1';
}
