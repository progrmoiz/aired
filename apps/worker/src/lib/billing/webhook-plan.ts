/**
 * Pure decisions for the billing routes: what a webhook event asks for, which
 * interval a request means, and the public status body. No imports and no I/O,
 * so node tests can load it directly; routes/billing.ts does the calls.
 */

export type Interval = 'month' | 'year';

export type WebhookEvent = { id: string; type: string; raw: unknown };

/** Parse a verified webhook body. Null unless it is a JSON object with a string id and type. */
export function parseWebhookEvent(body: string): WebhookEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { id, type } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || !id || typeof type !== 'string' || !type) return null;
  return { id, type, raw };
}

/**
 * What to do with a recorded event: ignore it (an unhandled type, or no
 * subscription to look up), or re-fetch the subscription it points at.
 */
export function planWebhookEvent(
  evt: WebhookEvent,
  handled: readonly string[],
  subscriptionIdOf: (raw: unknown) => string | null,
): 'ignore' | { subscriptionId: string } {
  if (!handled.includes(evt.type)) return 'ignore';
  const subscriptionId = subscriptionIdOf(evt.raw);
  return subscriptionId ? { subscriptionId } : 'ignore';
}

/** The interval from a checkout body; null for anything but 'month' or 'year'. */
export function parseInterval(v: unknown): Interval | null {
  return v === 'month' || v === 'year' ? v : null;
}

/** The interval from `/upgrade?interval=`; yearly unless the query says month. */
export function upgradeInterval(q: string | undefined | null): Interval {
  return q === 'month' ? 'month' : 'year';
}

export type BillingStatus = {
  enabled: boolean;
  plan: 'free' | 'pro' | null;
  status: string | null;
  interval: Interval | null;
  renewsAt: string | null;
  cancelAtPeriodEnd: boolean | null;
};

/**
 * The public `GET /api/billing/status` body. `signedIn` false → plan null.
 * `row` is the stored subscription (or null) and `entitled` whether it pays now;
 * both are ignored when billing is off.
 */
export function billingStatus(input: {
  enabled: boolean;
  signedIn: boolean;
  row: { status: string; interval: Interval | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  entitled: boolean;
}): BillingStatus {
  const plan = !input.signedIn ? null : input.enabled && input.entitled ? 'pro' : 'free';
  const row = input.enabled && input.signedIn ? input.row : null;
  return {
    enabled: input.enabled,
    plan,
    status: row?.status ?? null,
    interval: row?.interval ?? null,
    renewsAt: row?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: row ? row.cancelAtPeriodEnd : null,
  };
}

/**
 * Whether a subscription's price is one of ours. Only the configured Pro
 * prices grant Pro; any other subscription on the Stripe account is ignored.
 */
export function isProPrice(
  priceId: string | null,
  env: { STRIPE_PRICE_MONTHLY?: string; STRIPE_PRICE_YEARLY?: string },
): boolean {
  if (!priceId) return false;
  return priceId === env.STRIPE_PRICE_MONTHLY || priceId === env.STRIPE_PRICE_YEARLY;
}

/** Origin for the URLs Stripe sends the user back to. Never taken from the request. */
export function siteOrigin(env: { SITE_ORIGIN?: string }): string {
  return (env.SITE_ORIGIN || 'https://aired.sh').replace(/\/+$/, '');
}

const PAYING = new Set(['active', 'trialing', 'past_due']);

/**
 * Whether the customer's live subscriptions (see liveSubscriptions) rule out a
 * new Checkout: one that pays (store it and say Pro), or one whose first
 * payment is still in progress. null → go ahead.
 */
export function checkoutGate<S extends { status: string }>(
  subs: readonly S[],
): { kind: 'pro'; sub: S } | { kind: 'processing' } | null {
  const paying = subs.find((s) => PAYING.has(s.status));
  if (paying) return { kind: 'pro', sub: paying };
  if (subs.some((s) => s.status === 'incomplete')) return { kind: 'processing' };
  return null;
}
