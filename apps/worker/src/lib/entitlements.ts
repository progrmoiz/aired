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

/**
 * Extra time after current_period_end before Pro ends. It covers a renewal
 * webhook arriving late. A failed renewal is not limited to this: Stripe moves
 * the period end forward when it creates the renewal invoice, so a past_due
 * subscription keeps Pro until Stripe gives up and cancels it (Stripe setting:
 * "cancel the subscription" after the last retry).
 */
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

/** The slice of Env that getEntitlements reads; structural so this module stays import-free. */
export type EntitlementsEnv = {
  BILLING_ENABLED?: string;
  PAGES_KV: { get(key: string, options: { type: 'json'; cacheTtl?: number }): Promise<unknown> };
};

/**
 * The caller's plan, from the KV projection `ent:<uid>` the billing webhook writes.
 * Free when signed out, when billing is off, or when the record is missing or unreadable.
 */
export async function getEntitlements(env: EntitlementsEnv, uid: number | null): Promise<Entitlements> {
  if (uid === null || !billingEnabled(env)) return entitlementsFor(null, new Date());
  let state: SubscriptionState | null = null;
  try {
    const raw = await env.PAGES_KV.get(`ent:${uid}`, { type: 'json', cacheTtl: 300 });
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      const { status, currentPeriodEnd } = raw as Record<string, unknown>;
      if (typeof status === 'string' && (typeof currentPeriodEnd === 'string' || currentPeriodEnd === null)) {
        state = { status, currentPeriodEnd };
      }
    }
  } catch {
    state = null;
  }
  return entitlementsFor(state, new Date());
}
