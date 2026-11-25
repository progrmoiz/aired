import type { Env } from '../../types.js';
import {
  BillingConfigError,
  STRIPE_API_VERSION,
  StripeError,
  checkoutConfigProblem,
  checkoutParams,
  liveSubscriptions,
  normalizeSubscription,
  stripeErrorFrom,
  stripeKeyProblem,
  type NormalizedSubscription,
} from './stripe-shapes.js';
import { alreadyEnded, invoicePaymentsPage, subscriptionOfInvoice } from './risk-events.js';

/**
 * The Stripe REST calls billing needs, over plain fetch with form bodies
 * (no SDK). Every call pins `Stripe-Version`. Errors never carry the key.
 * Only restricted keys (rk_…) are accepted.
 */

type StripeEnv = Pick<
  Env,
  | 'STRIPE_SECRET_KEY'
  | 'STRIPE_PRICE_MONTHLY'
  | 'STRIPE_PRICE_YEARLY'
  | 'STRIPE_AUTOMATIC_TAX'
  | 'STRIPE_MANAGED_PAYMENTS'
  | 'STRIPE_API_BASE'
>;

export type CheckoutInput = {
  uid: number;
  interval: 'month' | 'year';
  /** Always set: every Checkout runs on the user's one Stripe customer (see createCustomer). */
  customerId: string;
  email: string | null;
  /** Site origin for the success and cancel URLs, e.g. https://aired.sh */
  origin: string;
};

export async function createCheckout(env: StripeEnv, input: CheckoutInput): Promise<{ url: string }> {
  const price = input.interval === 'year' ? env.STRIPE_PRICE_YEARLY : env.STRIPE_PRICE_MONTHLY;
  if (!price) throw new Error(`Stripe price for interval "${input.interval}" is not configured`);
  const problem = checkoutConfigProblem(env);
  if (problem) throw new BillingConfigError(problem);
  const body = checkoutParams({
    ...input,
    priceMonthly: env.STRIPE_PRICE_MONTHLY ?? '',
    priceYearly: env.STRIPE_PRICE_YEARLY ?? '',
    automaticTax: env.STRIPE_AUTOMATIC_TAX === '1',
    managedPayments: env.STRIPE_MANAGED_PAYMENTS === '1',
  });
  const { data } = await stripeRequest(env, 'POST', '/v1/checkout/sessions', body);
  return { url: urlOf(data, 'checkout session') };
}

export async function createPortal(env: StripeEnv, customerId: string, returnUrl: string): Promise<{ url: string }> {
  const body = new URLSearchParams({ customer: customerId, return_url: returnUrl });
  const { data } = await stripeRequest(env, 'POST', '/v1/billing_portal/sessions', body);
  return { url: urlOf(data, 'portal session') };
}

/**
 * Create the user's Stripe customer. The idempotency key (customerIdempotencyKey)
 * makes a retry, or a second checkout racing the first, get the same customer
 * back within Stripe's 24-hour key window; after that, the saved
 * billing_customers row is used.
 */
export async function createCustomer(
  env: StripeEnv,
  input: { uid: number; email: string | null; idempotencyKey: string },
): Promise<{ id: string }> {
  const body = new URLSearchParams({ 'metadata[uid]': String(input.uid) });
  if (input.email) body.set('email', input.email);
  const { data } = await stripeRequest(env, 'POST', '/v1/customers', body, [], {
    'Idempotency-Key': input.idempotencyKey,
  });
  const id = (data as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || !id) throw new Error('Stripe customer has no id');
  return { id };
}

/** The customer's subscriptions that are paying or have a payment in progress. */
export async function listActiveSubscriptions(env: StripeEnv, customerId: string): Promise<NormalizedSubscription[]> {
  const q = new URLSearchParams({ customer: customerId, status: 'all', limit: '10' });
  const { data } = await stripeRequest(env, 'GET', `/v1/subscriptions?${q.toString()}`, null);
  return liveSubscriptions(data);
}

/** Current state of a subscription; null when Stripe has no such subscription. */
export async function fetchSubscription(env: StripeEnv, id: string): Promise<NormalizedSubscription | null> {
  const { status, data } = await stripeRequest(
    env, 'GET', `/v1/subscriptions/${encodeURIComponent(id)}`, null, [404],
  );
  if (status === 404) return null;
  return normalizeSubscription(data);
}

/** The PaymentIntent behind a charge, or null (a legacy charge without one, or no such charge). */
export async function fetchChargePaymentIntent(env: StripeEnv, chargeId: string): Promise<string | null> {
  const { status, data } = await stripeRequest(
    env, 'GET', `/v1/charges/${encodeURIComponent(chargeId)}`, null, [404],
  );
  if (status === 404) return null;
  const pi = (data as { payment_intent?: unknown } | null)?.payment_intent;
  if (typeof pi === 'string' && pi) return pi;
  const expanded = (pi as { id?: unknown } | null)?.id;
  return typeof expanded === 'string' && expanded ? expanded : null;
}

const MAX_INVOICE_PAYMENT_PAGES = 10;

/**
 * Subscriptions paid by a PaymentIntent, each with the invoices it paid: its
 * paid invoice payments (all pages), each invoice's parent subscription.
 * Empty when it paid no subscription invoice.
 */
export async function subscriptionsForPaymentIntent(
  env: StripeEnv,
  paymentIntentId: string,
): Promise<Map<string, Set<string>>> {
  const found = new Map<string, Set<string>>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_INVOICE_PAYMENT_PAGES; page++) {
    const q = new URLSearchParams({
      'payment[type]': 'payment_intent',
      'payment[payment_intent]': paymentIntentId,
      status: 'paid',
      limit: '100',
      'expand[]': 'data.invoice',
    });
    if (cursor) q.set('starting_after', cursor);
    const { data } = await stripeRequest(env, 'GET', `/v1/invoice_payments?${q.toString()}`, null);
    const { invoices, nextCursor } = invoicePaymentsPage(data);
    for (const inv of invoices) {
      const invoice = typeof inv === 'string' ? await fetchInvoice(env, inv) : inv;
      const sub = invoice ? subscriptionOfInvoice(invoice) : null;
      const invoiceId = typeof inv === 'string' ? inv : (inv as { id: string }).id;
      if (sub) found.set(sub, (found.get(sub) ?? new Set()).add(invoiceId));
    }
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return found;
}

/** A subscription's paid invoices, most recent first (one page of 20 is plenty for "covers today"). */
export async function paidInvoicesOfSubscription(env: StripeEnv, subscriptionId: string): Promise<unknown[]> {
  const q = new URLSearchParams({ subscription: subscriptionId, status: 'paid', limit: '20' });
  const { data } = await stripeRequest(env, 'GET', `/v1/invoices?${q.toString()}`, null);
  const list = (data as { data?: unknown } | null)?.data;
  return Array.isArray(list) ? list : [];
}

/** Every charge that paid an invoice: its paid invoice payments → PaymentIntent charges (or the charge itself). */
export async function chargesForInvoice(env: StripeEnv, invoiceId: string): Promise<unknown[]> {
  const q = new URLSearchParams({ invoice: invoiceId, status: 'paid', limit: '100' });
  const { data } = await stripeRequest(env, 'GET', `/v1/invoice_payments?${q.toString()}`, null);
  const payments = (data as { data?: unknown } | null)?.data;
  const charges: unknown[] = [];
  for (const item of Array.isArray(payments) ? payments : []) {
    const payment = (item as { payment?: { type?: unknown; payment_intent?: unknown; charge?: unknown } } | null)?.payment;
    const pi = idOrNull(payment?.payment_intent);
    const chargeId = idOrNull(payment?.charge);
    if (pi) {
      const cq = new URLSearchParams({ payment_intent: pi, limit: '100' });
      const res = await stripeRequest(env, 'GET', `/v1/charges?${cq.toString()}`, null);
      const list = (res.data as { data?: unknown } | null)?.data;
      if (Array.isArray(list)) charges.push(...list);
    } else if (chargeId) {
      const res = await stripeRequest(env, 'GET', `/v1/charges/${encodeURIComponent(chargeId)}`, null, [404]);
      if (res.status !== 404) charges.push(res.data);
    }
  }
  return charges;
}

function idOrNull(v: unknown): string | null {
  if (typeof v === 'string' && v) return v;
  const id = (v as { id?: unknown } | null)?.id;
  return typeof id === 'string' && id ? id : null;
}

async function fetchInvoice(env: StripeEnv, id: string): Promise<unknown> {
  const { status, data } = await stripeRequest(env, 'GET', `/v1/invoices/${encodeURIComponent(id)}`, null, [404]);
  return status === 404 ? null : data;
}

/**
 * Cancel a subscription now (no proration, no final invoice). Idempotent: when
 * Stripe refuses because it is already canceled or gone, that counts as done.
 * Never refunds anything.
 */
export async function cancelSubscription(
  env: StripeEnv,
  id: string,
  comment: string,
): Promise<'canceled' | 'already_ended'> {
  const q = new URLSearchParams({ 'cancellation_details[comment]': comment });
  try {
    await stripeRequest(env, 'DELETE', `/v1/subscriptions/${encodeURIComponent(id)}?${q.toString()}`, null);
    return 'canceled';
  } catch (err) {
    if (!(err instanceof StripeError)) throw err;
    if (err.code === 'resource_missing') return 'already_ended';
    // Whatever the error code, re-read the subscription: if it already ended, we're done.
    const now = await fetchSubscription(env, id);
    if (!now || alreadyEnded(now.status)) return 'already_ended';
    throw err;
  }
}

async function stripeRequest(
  env: StripeEnv,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body: URLSearchParams | null,
  allowStatuses: number[] = [],
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; data: unknown }> {
  const key = env.STRIPE_SECRET_KEY;
  const keyProblem = stripeKeyProblem(key);
  if (keyProblem) {
    console.error({ event: 'billing_misconfigured', error: keyProblem });
    throw new BillingConfigError(keyProblem);
  }
  const base = (env.STRIPE_API_BASE ?? 'https://api.stripe.com').replace(/\/+$/, '');

  const headers = {
    'Authorization': `Bearer ${key!}`,
    'Stripe-Version': STRIPE_API_VERSION,
    'Content-Type': 'application/x-www-form-urlencoded',
    ...extraHeaders,
  };

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { method, headers, body: body ?? undefined });
  } catch {
    throw new Error(`Stripe ${method} ${path} failed: network error`);
  }

  const data: unknown = await res.json().catch(() => null);
  if (res.ok || allowStatuses.includes(res.status)) return { status: res.status, data };

  // Only Stripe's machine-readable type/code/param: its `message` can echo part of the key.
  throw stripeErrorFrom(method, path, res.status, data);
}

function urlOf(data: unknown, what: string): string {
  const url = (data as { url?: unknown } | null)?.url;
  if (typeof url !== 'string' || !url) throw new Error(`Stripe ${what} has no url`);
  return url;
}
