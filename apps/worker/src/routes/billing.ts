import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppBindings } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCsrfHeader } from '../middleware/csrf.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { TIERS } from '../lib/rate-limit-tiers.js';
import { billingEnabled, isEntitled } from '../lib/entitlements.js';
import { verifyStripeSignature } from '../lib/billing/signature.js';
import { HANDLED_EVENTS, subscriptionIdFromEvent, uidFromEvent } from '../lib/billing/stripe-shapes.js';
import {
  createCheckout,
  createCustomer,
  createPortal,
  fetchSubscription,
  listActiveSubscriptions,
} from '../lib/billing/stripe.js';
import {
  ensureUser,
  hasEvent,
  recordEvent,
  getSubscription,
  getCustomerId,
  saveCustomerId,
  findUidByCustomer,
  syncSubscription,
} from '../lib/billing/store.js';
import {
  billingStatus,
  checkoutGate,
  isProPrice,
  parseInterval,
  parseWebhookEvent,
  planWebhookEvent,
  siteOrigin,
  upgradeInterval,
  type Interval,
  type WebhookEvent,
} from '../lib/billing/webhook-plan.js';

type User = NonNullable<AppBindings['Variables']['user']>;

const BILLING_OFF = 'Billing is not available yet';
const CHECKOUT_FAILED = 'Could not start checkout. Please try again.';
const ALREADY_PRO = 'You already have Pro';
const PROCESSING = 'Your payment is still processing. Check back in a minute.';

const billing = new Hono<AppBindings>();
const upgrade = new Hono<AppBindings>();

type CheckoutResult = { kind: 'pro' } | { kind: 'processing' } | { kind: 'url'; url: string };

/**
 * Start a Stripe Checkout for this user, unless they already pay or a payment
 * is in progress. Every checkout runs on the user's one Stripe customer, and
 * Stripe is asked for that customer's live subscriptions first, so a second
 * checkout before the first webhook lands can't open a second subscription.
 */
async function startCheckout(c: Context<AppBindings>, user: User, interval: Interval): Promise<CheckoutResult> {
  const db = c.env.DB;
  const existing = await getSubscription(db, user.id);
  if (isEntitled(existing, new Date())) return { kind: 'pro' };

  // The users row first: billing_customers and subscriptions both reference it.
  await ensureUser(db, user);
  const customerId =
    existing?.customerId ?? (await getCustomerId(db, user.id)) ?? (await newCustomer(c, user));

  const live = (await listActiveSubscriptions(c.env, customerId)).filter((s) =>
    isProPrice(s.priceId, c.env),
  );
  const gate = checkoutGate(live);
  if (gate?.kind === 'pro') {
    // The webhook hasn't landed yet (or was lost): store what Stripe says now.
    await syncSubscription(c.env, user.id, gate.sub);
    return { kind: 'pro' };
  }
  if (gate?.kind === 'processing') return { kind: 'processing' };

  const { url } = await createCheckout(c.env, {
    uid: user.id,
    interval,
    customerId,
    email: user.email,
    origin: siteOrigin(c.env),
  });
  return { kind: 'url', url };
}

/** Create and save the user's Stripe customer; if another request saved one first, use that. */
async function newCustomer(c: Context<AppBindings>, user: User): Promise<string> {
  const { id } = await createCustomer(c.env, { uid: user.id, email: user.email });
  await saveCustomerId(c.env.DB, user.id, id);
  return (await getCustomerId(c.env.DB, user.id)) ?? id;
}

function logBillingError(event: string, uid: number | null, err: unknown): void {
  // Messages from lib/billing never carry keys; never log bodies or emails.
  console.error({ event, uid, error: err instanceof Error ? err.message : String(err) });
}

// GET /api/billing/status — public; plan is null when signed out.
billing.get('/status', async (c) => {
  const enabled = billingEnabled(c.env);
  const user = c.get('user');
  const row = enabled && user ? await getSubscription(c.env.DB, user.id) : null;
  return c.json(
    billingStatus({ enabled, signedIn: user !== null, row, entitled: isEntitled(row, new Date()) }),
  );
});

// POST /api/billing/checkout — {interval} → {url} of a Stripe Checkout session
billing.post('/checkout', requireAuth, requireCsrfHeader, rateLimit(TIERS.billing), async (c) => {
  if (!billingEnabled(c.env)) return c.json({ error: BILLING_OFF }, 503);
  const user = c.get('user')!;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const interval =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? parseInterval((body as Record<string, unknown>)['interval'])
      : null;
  if (interval === null) {
    return c.json({ error: "interval must be 'month' or 'year'" }, 400);
  }

  try {
    const result = await startCheckout(c, user, interval);
    if (result.kind === 'pro') return c.json({ error: ALREADY_PRO }, 409);
    if (result.kind === 'processing') return c.json({ error: PROCESSING }, 409);
    return c.json({ url: result.url });
  } catch (err) {
    logBillingError('billing_checkout_failed', user.id, err);
    return c.json({ error: CHECKOUT_FAILED }, 502);
  }
});

// POST /api/billing/portal — {url} of a Stripe billing portal session
billing.post('/portal', requireAuth, requireCsrfHeader, rateLimit(TIERS.billing), async (c) => {
  if (!billingEnabled(c.env)) return c.json({ error: BILLING_OFF }, 503);
  const user = c.get('user')!;

  try {
    const row = await getSubscription(c.env.DB, user.id);
    if (!row) return c.json({ error: 'No billing account yet' }, 404);
    const { url } = await createPortal(c.env, row.customerId, `${siteOrigin(c.env)}/dashboard`);
    return c.json({ url });
  } catch (err) {
    logBillingError('billing_portal_failed', user.id, err);
    return c.json({ error: 'Could not open billing. Please try again.' }, 502);
  }
});

// POST /api/billing/webhook — Stripe events. No cookie, so no CSRF header.
// Handled synchronously so the status code tells Stripe whether to retry.
billing.post('/webhook', async (c) => {
  // Raw body first: the signature covers these exact bytes.
  const body = await c.req.text();
  const secret = c.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: BILLING_OFF }, 503);

  const signed = await verifyStripeSignature(
    body,
    c.req.header('Stripe-Signature'),
    secret,
    Math.floor(Date.now() / 1000),
  );
  if (!signed) return c.json({ error: 'Invalid signature' }, 400);

  const evt = parseWebhookEvent(body);
  if (!evt) return c.json({ error: 'Invalid event' }, 400);

  if (await hasEvent(c.env.DB, evt.id)) {
    return c.json({ received: true, duplicate: true });
  }

  // Recorded only after handling succeeds, so a failure leaves nothing behind
  // and Stripe's retry is processed in full.
  try {
    await handleEvent(c, evt);
    await recordEvent(c.env.DB, evt.id, evt.type);
    return c.json({ received: true });
  } catch (err) {
    console.error({
      event: 'billing_webhook_failed',
      eventId: evt.id,
      type: evt.type,
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});

/** Re-fetch the subscription an event points at and store it. Returns quietly for events to ignore. */
async function handleEvent(c: Context<AppBindings>, evt: WebhookEvent): Promise<void> {
  const plan = planWebhookEvent(evt, HANDLED_EVENTS, subscriptionIdFromEvent);
  if (plan === 'ignore') return;

  const sub = await fetchSubscription(c.env, plan.subscriptionId);
  if (!sub) return;

  // Only our Pro prices grant Pro; other products on the Stripe account don't.
  if (!isProPrice(sub.priceId, c.env)) {
    console.warn({ event: 'billing_webhook_not_pro_price', eventId: evt.id, subscriptionId: sub.id, priceId: sub.priceId });
    return;
  }

  const uid = sub.uid ?? uidFromEvent(evt.raw) ?? (await findUidByCustomer(c.env.DB, sub.customerId));
  if (uid === null) {
    console.warn({ event: 'billing_webhook_no_uid', eventId: evt.id, type: evt.type });
    return;
  }

  // INSERT OR IGNORE: leaves a real users row alone; adds a stub only when none exists.
  await ensureUser(c.env.DB, { id: uid, login: `user-${uid}`, email: null, name: null });
  await syncSubscription(c.env, uid, sub);
}

// GET /upgrade?interval=year|month — sign in if needed, then go to Stripe Checkout.
upgrade.get('/upgrade', rateLimit(TIERS.billing), async (c) => {
  if (!billingEnabled(c.env)) return c.redirect('/pricing', 302);
  const interval = upgradeInterval(c.req.query('interval'));

  const user = c.get('user');
  if (!user) {
    const back = `/upgrade?interval=${interval}`;
    return c.redirect(`/auth/github?return=${encodeURIComponent(back)}`, 302);
  }

  try {
    const result = await startCheckout(c, user, interval);
    if (result.kind === 'pro') return c.redirect('/dashboard', 302);
    if (result.kind === 'processing') return c.redirect('/pricing?checkout=processing', 302);
    return c.redirect(result.url, 303);
  } catch (err) {
    logBillingError('billing_upgrade_failed', user.id, err);
    return c.redirect('/pricing?checkout=error', 302);
  }
});

export { billing, upgrade };
