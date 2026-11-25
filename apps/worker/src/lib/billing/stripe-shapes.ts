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
};

export const HANDLED_EVENTS: readonly string[] = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
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
  if (i.automaticTax) {
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
  };
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
