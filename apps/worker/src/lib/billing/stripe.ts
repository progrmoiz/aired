import type { Env } from '../../types.js';
import {
  STRIPE_API_VERSION,
  checkoutParams,
  liveSubscriptions,
  normalizeSubscription,
  stripeErrorFrom,
  type NormalizedSubscription,
} from './stripe-shapes.js';

/**
 * The three Stripe REST calls billing needs, over plain fetch with form bodies
 * (no SDK). Every call pins `Stripe-Version`. Errors never carry the key.
 */

type StripeEnv = Pick<
  Env,
  | 'STRIPE_SECRET_KEY'
  | 'STRIPE_PRICE_MONTHLY'
  | 'STRIPE_PRICE_YEARLY'
  | 'STRIPE_AUTOMATIC_TAX'
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
  const body = checkoutParams({
    ...input,
    priceMonthly: env.STRIPE_PRICE_MONTHLY ?? '',
    priceYearly: env.STRIPE_PRICE_YEARLY ?? '',
    automaticTax: env.STRIPE_AUTOMATIC_TAX === '1',
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

async function stripeRequest(
  env: StripeEnv,
  method: 'GET' | 'POST',
  path: string,
  body: URLSearchParams | null,
  allowStatuses: number[] = [],
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; data: unknown }> {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)');
  const base = (env.STRIPE_API_BASE ?? 'https://api.stripe.com').replace(/\/+$/, '');

  const headers = {
    'Authorization': `Bearer ${key}`,
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
