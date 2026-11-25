import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppBindings } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCsrfHeader } from '../middleware/csrf.js';
import { billingEnabled, isEntitled } from '../lib/entitlements.js';
import { verifyStripeSignature } from '../lib/billing/signature.js';
import { HANDLED_EVENTS, subscriptionIdFromEvent, uidFromEvent } from '../lib/billing/stripe-shapes.js';
import { createCheckout, createPortal, fetchSubscription } from '../lib/billing/stripe.js';
import {
  ensureUser,
  recordEvent,
  forgetEvent,
  getSubscription,
  findUidByCustomer,
  syncSubscription,
} from '../lib/billing/store.js';
import {
  billingStatus,
  parseInterval,
  parseWebhookEvent,
  planWebhookEvent,
  upgradeInterval,
  type Interval,
} from '../lib/billing/webhook-plan.js';

type User = NonNullable<AppBindings['Variables']['user']>;

const BILLING_OFF = 'Billing is not available yet';
const CHECKOUT_FAILED = 'Could not start checkout. Please try again.';

const billing = new Hono<AppBindings>();
const upgrade = new Hono<AppBindings>();

/**
 * Start a Stripe Checkout for this user, or report that they already have Pro.
 * Makes sure the users row exists first: the webhook's subscriptions row needs it.
 */
async function startCheckout(
  c: Context<AppBindings>,
  user: User,
  interval: Interval,
): Promise<{ alreadyPro: true } | { alreadyPro: false; url: string }> {
  const existing = await getSubscription(c.env.DB, user.id);
  if (isEntitled(existing, new Date())) return { alreadyPro: true };
  await ensureUser(c.env.DB, user);
  const { url } = await createCheckout(c.env, {
    uid: user.id,
    interval,
    customerId: existing?.customerId ?? null,
    email: user.email,
    origin: new URL(c.req.url).origin,
  });
  return { alreadyPro: false, url };
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
billing.post('/checkout', requireAuth, requireCsrfHeader, async (c) => {
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
    if (result.alreadyPro) return c.json({ error: 'You already have Pro' }, 409);
    return c.json({ url: result.url });
  } catch (err) {
    logBillingError('billing_checkout_failed', user.id, err);
    return c.json({ error: CHECKOUT_FAILED }, 502);
  }
});

// POST /api/billing/portal — {url} of a Stripe billing portal session
billing.post('/portal', requireAuth, requireCsrfHeader, async (c) => {
  if (!billingEnabled(c.env)) return c.json({ error: BILLING_OFF }, 503);
  const user = c.get('user')!;

  try {
    const row = await getSubscription(c.env.DB, user.id);
    if (!row) return c.json({ error: 'No billing account yet' }, 404);
    const origin = new URL(c.req.url).origin;
    const { url } = await createPortal(c.env, row.customerId, `${origin}/dashboard`);
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

  if (!(await recordEvent(c.env.DB, evt.id, evt.type))) {
    return c.json({ received: true, duplicate: true });
  }

  try {
    const plan = planWebhookEvent(evt, HANDLED_EVENTS, subscriptionIdFromEvent);
    if (plan === 'ignore') return c.json({ received: true });

    const sub = await fetchSubscription(c.env, plan.subscriptionId);
    if (!sub) return c.json({ received: true });

    const uid = sub.uid ?? uidFromEvent(evt.raw) ?? (await findUidByCustomer(c.env.DB, sub.customerId));
    if (uid === null) {
      console.warn({ event: 'billing_webhook_no_uid', eventId: evt.id, type: evt.type });
      return c.json({ received: true });
    }

    // INSERT OR IGNORE: leaves a real users row alone; adds a stub only when none exists.
    await ensureUser(c.env.DB, { id: uid, login: `user-${uid}`, email: null, name: null });
    await syncSubscription(c.env, uid, sub);
    return c.json({ received: true });
  } catch (err) {
    console.error({
      event: 'billing_webhook_failed',
      eventId: evt.id,
      type: evt.type,
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      await forgetEvent(c.env.DB, evt.id);
    } catch (forgetErr) {
      console.error({
        event: 'billing_webhook_forget_failed',
        eventId: evt.id,
        error: forgetErr instanceof Error ? forgetErr.message : String(forgetErr),
      });
    }
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});

// GET /upgrade?interval=year|month — sign in if needed, then go to Stripe Checkout.
upgrade.get('/upgrade', async (c) => {
  if (!billingEnabled(c.env)) return c.redirect('/pricing', 302);
  const interval = upgradeInterval(c.req.query('interval'));

  const user = c.get('user');
  if (!user) {
    const back = `/upgrade?interval=${interval}`;
    return c.redirect(`/auth/github?return=${encodeURIComponent(back)}`, 302);
  }

  try {
    const result = await startCheckout(c, user, interval);
    if (result.alreadyPro) return c.redirect('/dashboard', 302);
    return c.redirect(result.url, 303);
  } catch (err) {
    logBillingError('billing_upgrade_failed', user.id, err);
    return c.redirect('/pricing?checkout=error', 302);
  }
});

export { billing, upgrade };
