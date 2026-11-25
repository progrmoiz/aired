import type { Env } from '../../types.js';
import {
  STRIPE_API_VERSION,
  checkoutParams,
  normalizeSubscription,
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
  customerId: string | null;
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
): Promise<{ status: number; data: unknown }> {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)');
  const base = (env.STRIPE_API_BASE ?? 'https://api.stripe.com').replace(/\/+$/, '');

  const headers = {
    'Authorization': `Bearer ${key}`,
    'Stripe-Version': STRIPE_API_VERSION,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { method, headers, body: body ?? undefined });
  } catch {
    throw new Error(`Stripe ${method} ${path} failed: network error`);
  }

  const data: unknown = await res.json().catch(() => null);
  if (res.ok || allowStatuses.includes(res.status)) return { status: res.status, data };

  // Only Stripe's machine-readable type/code: its `message` can echo part of the key.
  const err = (data as { error?: { type?: unknown; code?: unknown } } | null)?.error;
  const detail = [err?.type, err?.code].filter((v) => typeof v === 'string').join('/');
  throw new Error(`Stripe ${method} ${path} failed: ${res.status}${detail ? ` ${detail}` : ''}`);
}

function urlOf(data: unknown, what: string): string {
  const url = (data as { url?: unknown } | null)?.url;
  if (typeof url !== 'string' || !url) throw new Error(`Stripe ${what} has no url`);
  return url;
}
