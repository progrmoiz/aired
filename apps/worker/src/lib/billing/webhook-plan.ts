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

export type PriceEnv = {
  STRIPE_PRICE_MONTHLY?: string;
  STRIPE_PRICE_YEARLY?: string;
  STRIPE_LEGACY_PRICE_IDS?: string;
};

/** `STRIPE_LEGACY_PRICE_IDS` as a list: comma-separated, trimmed, empty entries dropped. */
export function legacyPriceIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((p) => p.trim()).filter((p) => p !== '');
}

/**
 * Whether a subscription's price grants Pro: one of the two current prices, or
 * an older Pro price listed in STRIPE_LEGACY_PRICE_IDS (so changing the price
 * doesn't drop people who subscribed at the old one). Any other price on the
 * Stripe account doesn't.
 */
export function isProPrice(priceId: string | null, env: PriceEnv): boolean {
  if (!priceId) return false;
  if (priceId === env.STRIPE_PRICE_MONTHLY || priceId === env.STRIPE_PRICE_YEARLY) return true;
  return legacyPriceIds(env.STRIPE_LEGACY_PRICE_IDS).includes(priceId);
}

/** Origin for the URLs Stripe sends the user back to. Never taken from the request. */
export function siteOrigin(env: { SITE_ORIGIN?: string }): string {
  return (env.SITE_ORIGIN || 'https://aired.sh').replace(/\/+$/, '');
}

/**
 * Idempotency key for creating a user's Stripe customer. Scoped by site host so
 * two environments sharing a Stripe test account never get each other's
 * customer. `replacing` (the id of a customer Stripe no longer has) gives a
 * fresh key, because replaying the old one would return the deleted customer.
 */
export function customerIdempotencyKey(origin: string, uid: number, replacing?: string | null): string {
  const base = `aired-customer-${new URL(origin).host}-${uid}`;
  return replacing ? `${base}-${replacing}` : base;
}

export type CheckoutGate<S> =
  | { kind: 'pro'; sub: S }
  | { kind: 'payment_failed'; sub: S }
  | { kind: 'processing' }
  | null;

/**
 * Whether the customer's live subscriptions (see liveSubscriptions) rule out a
 * new Checkout. Any live subscription on the user's own customer blocks one,
 * whatever its price; the caller decides separately whether to store it.
 *  - 'pro': one is entitled now (paying, or past_due inside the grace period)
 *  - 'payment_failed': one is past_due after the grace period, or unpaid;
 *    the fix is a new card in the portal, not a second subscription
 *  - 'processing': anything else live (an incomplete first payment)
 *  - null: nothing live, go ahead
 */
export function checkoutGate<S extends { status: string }>(
  subs: readonly S[],
  entitled: (sub: S) => boolean,
): CheckoutGate<S> {
  const paying = subs.find(entitled);
  if (paying) return { kind: 'pro', sub: paying };
  const failed = subs.find((s) => s.status === 'past_due' || s.status === 'unpaid');
  if (failed) return { kind: 'payment_failed', sub: failed };
  if (subs.length > 0) return { kind: 'processing' };
  return null;
}

/**
 * Which user a webhook's subscription belongs to. Our own customer mapping
 * (subscriptions / billing_customers) wins; metadata.uid or client_reference_id
 * is only a fallback for a customer we have no row for. `conflict` is set when
 * both exist and disagree, so the caller can log it.
 */
export function resolveWebhookUid(
  dbUid: number | null,
  metadataUid: number | null,
): { uid: number | null; conflict: boolean } {
  if (dbUid !== null) return { uid: dbUid, conflict: metadataUid !== null && metadataUid !== dbUid };
  return { uid: metadataUid, conflict: false };
}
