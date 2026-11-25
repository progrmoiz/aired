/**
 * Pure Stripe request/response shapes: Checkout form params, a normalized
 * subscription, and the ids a webhook event points at. No I/O here.
 *
 * Field locations moved in the 2025-03 API versions (period end on the
 * subscription item; invoice → subscription under `parent`), so the readers
 * accept both the old and the new place. Nothing here throws: input that
 * doesn't look like Stripe comes back as null.
 */

export const STRIPE_API_VERSION = '2025-03-31.basil';

export type NormalizedSubscription = {
  id: string;
  customerId: string;
  status: string;
  interval: 'month' | 'year' | null;
  /** ISO timestamp, or null when Stripe sent none. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** aired user id from `metadata.uid`, or null. */
  uid: number | null;
  /** Price of the first item (`items.data[0].price.id`), or null. */
  priceId: string | null;
};

/** Lifecycle events: each re-fetches the subscription and stores it. */
export const HANDLED_EVENTS: readonly string[] = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
];

export function checkoutParams(i: {
  uid: number;
  interval: 'month' | 'year';
  priceMonthly: string;
  priceYearly: string;
  customerId: string | null;
  email: string | null;
  automaticTax: boolean;
  /** Stripe Managed Payments (merchant of record). Stripe handles tax, so no tax params are sent. */
  managedPayments?: boolean;
  origin: string;
}): URLSearchParams {
  const uid = String(i.uid);
  const p = new URLSearchParams();
  p.set('mode', 'subscription');
  p.set('line_items[0][price]', i.interval === 'year' ? i.priceYearly : i.priceMonthly);
  p.set('line_items[0][quantity]', '1');
  p.set('client_reference_id', uid);
  p.set('metadata[uid]', uid);
  p.set('subscription_data[metadata][uid]', uid);
  if (i.customerId) p.set('customer', i.customerId);
  else if (i.email) p.set('customer_email', i.email);
  p.set('success_url', `${i.origin}/dashboard?upgraded=1`);
  p.set('cancel_url', `${i.origin}/pricing`);
  if (i.managedPayments) {
    // Managed Payments rejects automatic_tax and customer_update[name|address]:
    // it collects name and address itself and updates the passed customer.
    p.set('managed_payments[enabled]', 'true');
  } else if (i.automaticTax) {
    p.set('automatic_tax[enabled]', 'true');
    // Stripe Tax needs an address; let Checkout save it on an existing customer.
    if (i.customerId) p.set('customer_update[address]', 'auto');
  }
  return p;
}

export function normalizeSubscription(obj: unknown): NormalizedSubscription | null {
  const sub = record(obj);
  if (!sub) return null;
  const id = str(sub.id);
  const customerId = idOf(sub.customer);
  const status = str(sub.status);
  if (!id || !customerId || !status) return null;

  const items = record(sub.items);
  const item = Array.isArray(items?.data) ? record(items.data[0]) : null;
  const price = record(item?.price);
  const rawInterval = record(price?.recurring)?.interval ?? record(item?.plan)?.interval;
  const interval = rawInterval === 'month' || rawInterval === 'year' ? rawInterval : null;

  const periodEnd = unixToIso(item?.current_period_end) ?? unixToIso(sub.current_period_end);

  return {
    id,
    customerId,
    status,
    interval,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    uid: parseUid(record(sub.metadata)?.uid),
    priceId: str(price?.id),
  };
}

/**
 * Subscription statuses that block a new Checkout: paying now, a payment in
 * progress, or a failed payment the user should fix in the portal.
 */
export const LIVE_STATUSES: readonly string[] = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'];

/**
 * A failed Stripe call. Carries Stripe's machine-readable `type`, `code` and
 * `param` only: its `message` can echo part of the key, so it is never kept.
 */
export class StripeError extends Error {
  readonly status: number;
  readonly type: string | null;
  readonly code: string | null;
  readonly param: string | null;

  constructor(
    method: string,
    path: string,
    status: number,
    detail: { type: string | null; code: string | null; param: string | null },
  ) {
    const tag = [detail.type, detail.code].filter((v) => v !== null).join('/');
    super(`Stripe ${method} ${path} failed: ${status}${tag ? ` ${tag}` : ''}`);
    this.name = 'StripeError';
    this.status = status;
    this.type = detail.type;
    this.code = detail.code;
    this.param = detail.param;
  }
}

/** Billing is set up wrong (key type, conflicting flags). Never retried against Stripe. */
export class BillingConfigError extends Error {
  readonly code = 'billing_misconfigured';
  constructor(message: string) {
    super(message);
    this.name = 'BillingConfigError';
  }
}

/**
 * Why this Stripe key can't be used, or null. Only restricted keys (rk_…) are
 * accepted: a leaked secret key (sk_…) can do anything on the account.
 */
export function stripeKeyProblem(key: string | undefined): string | null {
  if (!key) return 'Stripe is not configured (STRIPE_SECRET_KEY missing)';
  if (key.startsWith('sk_')) return 'Use a restricted key (rk_…), not a secret key';
  if (!key.startsWith('rk_')) return 'STRIPE_SECRET_KEY must be a restricted key (rk_…)';
  return null;
}

/** Why Checkout can't be created with these flags, or null. */
export function checkoutConfigProblem(env: { STRIPE_MANAGED_PAYMENTS?: string; STRIPE_AUTOMATIC_TAX?: string }): string | null {
  if (env.STRIPE_MANAGED_PAYMENTS === '1' && env.STRIPE_AUTOMATIC_TAX === '1') {
    return 'STRIPE_MANAGED_PAYMENTS and STRIPE_AUTOMATIC_TAX are both on; Managed Payments handles tax, so turn STRIPE_AUTOMATIC_TAX off';
  }
  return null;
}

/**
 * The subscription carried in a customer.subscription.* event, normalized.
 * Used when the re-fetch 404s on a deleted subscription (Managed Payments can
 * delete customer data on request); otherwise the re-fetch is the truth.
 */
export function eventSubscription(evt: unknown): NormalizedSubscription | null {
  const e = eventObject(evt);
  return e && e.kind === 'subscription' ? normalizeSubscription(e.obj) : null;
}

/** Build the StripeError for a non-2xx response body. */
export function stripeErrorFrom(method: string, path: string, status: number, body: unknown): StripeError {
  const err = record(record(body)?.error);
  return new StripeError(method, path, status, {
    type: str(err?.type),
    code: str(err?.code),
    param: str(err?.param),
  });
}

/**
 * Whether a Stripe call failed because the customer no longer exists (deleted
 * in the dashboard, or saved from another Stripe account or mode).
 */
export function isMissingCustomer(err: unknown): boolean {
  if (!(err instanceof StripeError) || err.code !== 'resource_missing') return false;
  return err.param === null || err.param === 'customer';
}

/**
 * The live subscriptions in a `GET /v1/subscriptions` list response,
 * normalized. Entries that don't normalize, or have another status, are dropped.
 */
export function liveSubscriptions(list: unknown): NormalizedSubscription[] {
  const data = record(list)?.data;
  if (!Array.isArray(data)) return [];
  const out: NormalizedSubscription[] = [];
  for (const item of data) {
    const sub = normalizeSubscription(item);
    if (sub && LIVE_STATUSES.includes(sub.status)) out.push(sub);
  }
  return out;
}

export function subscriptionIdFromEvent(evt: unknown): string | null {
  const e = eventObject(evt);
  if (!e) return null;
  const { kind, obj } = e;
  if (kind === 'checkout') return idOf(obj.subscription);
  if (kind === 'subscription') return str(obj.id);
  return (
    idOf(obj.subscription) ??
    idOf(record(record(obj.parent)?.subscription_details)?.subscription)
  );
}

export function uidFromEvent(evt: unknown): number | null {
  const e = eventObject(evt);
  if (!e) return null;
  const { kind, obj } = e;
  if (kind === 'checkout') {
    return parseUid(obj.client_reference_id) ?? parseUid(record(obj.metadata)?.uid);
  }
  if (kind === 'subscription') return parseUid(record(obj.metadata)?.uid);
  const details =
    record(record(obj.parent)?.subscription_details) ?? record(obj.subscription_details);
  return parseUid(record(details?.metadata)?.uid);
}

/**
 * Whether to store `incoming` over the user's current row. Stripe retries and
 * reorders events, so a late event for an old, ended subscription must not
 * replace a newer one that still pays. Only that case is refused.
 */
export function shouldStoreSubscription(
  existing: { subscriptionId: string | null; status: string; currentPeriodEnd: string | null } | null,
  incoming: NormalizedSubscription,
  now: Date,
): boolean {
  if (!existing || existing.subscriptionId === incoming.id) return true;
  return !(paidThrough(existing, now) && !paidThrough(incoming, now));
}

// Same rule as isEntitled in lib/entitlements.ts, repeated so this module stays import-free.
const PAID_STATUSES = new Set(['active', 'trialing', 'past_due']);
const GRACE_MS = 3 * 24 * 3600 * 1000;

function paidThrough(s: { status: string; currentPeriodEnd: string | null }, now: Date): boolean {
  if (!PAID_STATUSES.has(s.status) || !s.currentPeriodEnd) return false;
  const end = Date.parse(s.currentPeriodEnd);
  return !Number.isNaN(end) && now.getTime() < end + GRACE_MS;
}

type Obj = Record<string, unknown>;

function eventObject(
  evt: unknown,
): { kind: 'checkout' | 'subscription' | 'invoice'; obj: Obj } | null {
  const e = record(evt);
  const type = str(e?.type);
  const obj = record(record(e?.data)?.object);
  if (!type || !obj) return null;
  if (type.startsWith('checkout.session.')) return { kind: 'checkout', obj };
  if (type.startsWith('customer.subscription.')) return { kind: 'subscription', obj };
  if (type.startsWith('invoice.')) return { kind: 'invoice', obj };
  return null;
}

function record(v: unknown): Obj | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/** A Stripe reference is either an id string or the expanded object. */
function idOf(v: unknown): string | null {
  return str(v) ?? str(record(v)?.id);
}

function unixToIso(v: unknown): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  const d = new Date(v * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseUid(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\d+$/.test(v)) n = Number(v);
  else return null;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
