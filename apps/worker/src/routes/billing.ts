import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppBindings } from '../types.js';
import { kvKeys } from '@aired/core';
import { requireAuth } from '../middleware/auth.js';
import { requireCsrfHeader } from '../middleware/csrf.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { TIERS } from '../lib/rate-limit-tiers.js';
import { billingEnabled, isEntitled } from '../lib/entitlements.js';
import { verifyStripeSignature } from '../lib/billing/signature.js';
import {
  isPermissionError,
  BillingConfigError,
  HANDLED_EVENTS,
  checkoutConfigProblem,
  eventSubscription,
  isMissingCustomer,
  stripeKeyProblem,
  subscriptionIdFromEvent,
  uidFromEvent,
  type NormalizedSubscription,
} from '../lib/billing/stripe-shapes.js';
import {
  fetchCharge,
  refundFraudulentCharge,
  cancelSubscription,
  createCheckout,
  createCustomer,
  createPortal,
  chargesForInvoice,
  fetchChargePaymentIntent,
  paidInvoicesOfSubscription,
  fetchSubscription,
  listActiveSubscriptions,
  subscriptionsForPaymentIntent,
} from '../lib/billing/stripe.js';
import {
  RISK_EVENTS,
  alreadyEnded,
  currentPeriodOf,
  fraudWarningChargeId,
  fraudWarningRefundAction,
  planRiskEvent,
  refundEndsPro,
} from '../lib/billing/risk-events.js';
import { userRowExists,
  ensureUser,
  hasEvent,
  recordEvent,
  getSubscription,
  getCustomerId,
  saveCustomerId,
  forgetCustomer,
  findUidByCustomer,
  syncSubscription,
} from '../lib/billing/store.js';
import {
  billingStatus,
  checkoutGate,
  customerIdempotencyKey,
  isProPrice,
  parseInterval,
  parseWebhookEvent,
  planWebhookEvent,
  resolveWebhookUid,
  siteOrigin,
  upgradeInterval,
  type Interval,
  type WebhookEvent,
} from '../lib/billing/webhook-plan.js';

type User = NonNullable<AppBindings['Variables']['user']>;

const BILLING_OFF = 'Billing is not available yet';
const CHECKOUT_FAILED = 'Could not start checkout. Please try again.';
const ALREADY_PRO = 'You already have Pro';
const PROCESSING = 'Your payment is still processing. This can take a few minutes, or longer for bank payments.';
const NO_ACCOUNT = 'No billing account yet';
const PAYMENT_FAILED = 'Your last payment failed. Update your card in Manage billing.';
const MISCONFIGURED = 'Billing is misconfigured';

/** A setup problem that makes every Stripe call pointless (bad key type, conflicting flags), or null. */
function configProblem(env: AppBindings['Bindings']): string | null {
  return stripeKeyProblem(env.STRIPE_SECRET_KEY) ?? checkoutConfigProblem(env);
}

const billing = new Hono<AppBindings>();
const upgrade = new Hono<AppBindings>();

type CheckoutResult =
  | { kind: 'pro' }
  | { kind: 'payment_failed' }
  | { kind: 'processing' }
  | { kind: 'url'; url: string };

/**
 * Start a Stripe Checkout for this user, unless a live subscription already
 * exists. Every checkout runs on the user's one Stripe customer, and Stripe is
 * asked for that customer's live subscriptions first, so a second checkout
 * before the first webhook lands can't open a second subscription.
 * If Stripe no longer has the saved customer (deleted, or saved against another
 * Stripe account), the stale rows are dropped and it retries once on a new one.
 */
async function startCheckout(c: Context<AppBindings>, user: User, interval: Interval): Promise<CheckoutResult> {
  const db = c.env.DB;
  const existing = await getSubscription(db, user.id);
  if (isEntitled(existing, new Date())) return { kind: 'pro' };

  // The users row first: billing_customers and subscriptions both reference it.
  await ensureUser(db, user);
  const customerId =
    existing?.customerId ?? (await getCustomerId(db, user.id)) ?? (await newCustomer(c, user, null));

  try {
    return await checkoutOn(c, user, interval, customerId);
  } catch (err) {
    if (!isMissingCustomer(err)) throw err;
    console.warn({ event: 'billing_customer_missing', uid: user.id, customerId });
    await forgetCustomer(db, user.id, customerId);
    const fresh = await newCustomer(c, user, customerId);
    return await checkoutOn(c, user, interval, fresh);
  }
}

/** The live-subscription check and the Checkout session, on one customer. */
async function checkoutOn(
  c: Context<AppBindings>,
  user: User,
  interval: Interval,
  customerId: string,
): Promise<CheckoutResult> {
  const now = new Date();
  // Any live subscription on the user's own customer blocks a new one, whatever its price.
  const gate = checkoutGate(await listActiveSubscriptions(c.env, customerId), (s) => isEntitled(s, now));
  if (gate?.kind === 'pro' || gate?.kind === 'payment_failed') {
    // The webhook hasn't landed yet (or was lost): store what Stripe says now,
    // so status and the portal see it. Only a Pro price is stored.
    await storeIfProPrice(c, user.id, gate.sub);
    return { kind: gate.kind };
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

async function storeIfProPrice(c: Context<AppBindings>, uid: number, sub: NormalizedSubscription): Promise<void> {
  if (!isProPrice(sub.priceId, c.env)) {
    console.warn({ event: 'billing_live_sub_not_pro_price', uid, subscriptionId: sub.id, priceId: sub.priceId });
    return;
  }
  await syncSubscription(c.env, uid, sub);
}

/**
 * Create and save the user's Stripe customer; if another request saved one
 * first, use that. `replacing` is the id of a customer Stripe no longer has.
 */
async function newCustomer(c: Context<AppBindings>, user: User, replacing: string | null): Promise<string> {
  const { id } = await createCustomer(c.env, {
    uid: user.id,
    email: user.email,
    idempotencyKey: customerIdempotencyKey(siteOrigin(c.env), user.id, replacing),
  });
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
  const problem = configProblem(c.env);
  if (problem) {
    console.error({ event: 'billing_misconfigured', error: problem });
    return c.json({ error: MISCONFIGURED }, 503);
  }

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
    if (result.kind === 'pro') return c.json({ error: ALREADY_PRO, code: 'already_pro' }, 409);
    if (result.kind === 'payment_failed') {
      return c.json({ error: PAYMENT_FAILED, code: 'payment_failed' }, 409);
    }
    if (result.kind === 'processing') return c.json({ error: PROCESSING, code: 'processing' }, 409);
    return c.json({ url: result.url });
  } catch (err) {
    logBillingError('billing_checkout_failed', user.id, err);
    if (err instanceof BillingConfigError) return c.json({ error: MISCONFIGURED }, 503);
    return c.json({ error: CHECKOUT_FAILED }, 502);
  }
});

// POST /api/billing/portal — {url} of a Stripe billing portal session
billing.post('/portal', requireAuth, requireCsrfHeader, rateLimit(TIERS.billing), async (c) => {
  if (!billingEnabled(c.env)) return c.json({ error: BILLING_OFF }, 503);
  const user = c.get('user')!;

  let customerId: string | null = null;
  try {
    customerId =
      (await getSubscription(c.env.DB, user.id))?.customerId ?? (await getCustomerId(c.env.DB, user.id));
    if (!customerId) return c.json({ error: NO_ACCOUNT }, 404);
    const { url } = await createPortal(c.env, customerId, `${siteOrigin(c.env)}/dashboard`);
    return c.json({ url });
  } catch (err) {
    if (customerId && isMissingCustomer(err)) {
      // Stripe no longer has this customer: drop the stale rows; nothing to manage.
      console.warn({ event: 'billing_customer_missing', uid: user.id, customerId });
      try {
        await forgetCustomer(c.env.DB, user.id, customerId);
        return c.json({ error: NO_ACCOUNT }, 404);
      } catch (forgetErr) {
        err = forgetErr;
      }
    }
    logBillingError('billing_portal_failed', user.id, err);
    if (err instanceof BillingConfigError) return c.json({ error: MISCONFIGURED }, 503);
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
  if (RISK_EVENTS.includes(evt.type)) return handleRiskEvent(c, evt);

  const plan = planWebhookEvent(evt, HANDLED_EVENTS, subscriptionIdFromEvent);
  if (plan === 'ignore') return;

  let sub = await fetchSubscription(c.env, plan.subscriptionId);
  if (!sub && evt.type === 'customer.subscription.deleted') {
    // Gone from Stripe (e.g. a Managed Payments data deletion): the event's own
    // object is the last state we'll ever see, so store that.
    sub = eventSubscription(evt.raw);
    if (sub) console.warn({ event: 'billing_webhook_sub_gone_using_event', eventId: evt.id, subscriptionId: sub.id });
  }
  if (!sub) return;
  await storeSubscription(c, evt, sub);
}

/** Store a subscription for its user. Returns the uid, or null when it was skipped (not Pro, no user). */
async function storeSubscription(
  c: Context<AppBindings>,
  evt: WebhookEvent,
  sub: NormalizedSubscription,
): Promise<number | null> {
  // Only our Pro prices grant Pro; other products on the Stripe account don't.
  if (!isProPrice(sub.priceId, c.env)) {
    console.warn({ event: 'billing_webhook_not_pro_price', eventId: evt.id, subscriptionId: sub.id, priceId: sub.priceId });
    return null;
  }

  const uid = await webhookUid(c, evt, sub);
  if (uid === null) {
    console.warn({ event: 'billing_webhook_no_uid', eventId: evt.id, type: evt.type });
    return null;
  }

  // INSERT OR IGNORE: leaves a real users row alone; adds a stub only when none exists.
  await ensureUser(c.env.DB, { id: uid, login: `user-${uid}`, email: null, name: null });
  await syncSubscription(c.env, uid, sub);
  return uid;
}

/** Our customer → user mapping first; metadata only for a customer we've never stored. */
async function webhookUid(c: Context<AppBindings>, evt: WebhookEvent, sub: NormalizedSubscription): Promise<number | null> {
  const dbUid = await findUidByCustomer(c.env.DB, sub.customerId);
  const metadataUid = sub.uid ?? uidFromEvent(evt.raw);
  // The account must still exist (its KV user record or its D1 users row;
  // account deletion removes both), or an event arriving during or after
  // account deletion would re-create the billing rows it removed.
  const candidate = dbUid ?? metadataUid;
  const userExists =
    candidate === null ||
    (await c.env.PAGES_KV.get(kvKeys.user(candidate))) !== null ||
    (await userRowExists(c.env.DB, candidate));
  const { uid, conflict, deletedUser } = resolveWebhookUid(dbUid, metadataUid, userExists);
  if (deletedUser) {
    console.log({ event: 'billing_webhook_deleted_account', eventId: evt.id, customerId: sub.customerId, metadataUid });
  }
  if (conflict) {
    console.warn({
      event: 'billing_webhook_uid_mismatch',
      eventId: evt.id,
      customerId: sub.customerId,
      dbUid,
      metadataUid,
    });
  }
  return uid;
}

/**
 * Risk events. A dispute or an early fraud warning ends Pro; a full refund
 * ends it when it refunds the current period's payment (refundEndsPro). Ending
 * Pro cancels the subscription now and stores the result, which removes
 * `ent:<uid>`. An early fraud warning also refunds the charge in full.
 */
async function handleRiskEvent(c: Context<AppBindings>, evt: WebhookEvent): Promise<void> {
  await endProForRiskEvent(c, evt);
  // After Pro has ended, so a refund failure can never keep Pro on.
  if (evt.type === 'radar.early_fraud_warning.created') await refundFlaggedCharge(c, evt);
}

/**
 * An early fraud warning: refund the charge in full (owner's decision,
 * 2026-11-25), unless it's already refunded or disputed. The refund then
 * sends charge.refunded, which finds the subscription already canceled and
 * stops there. Logs one line. A key without "Refunds: write" is logged and
 * answered 200: Pro has already ended, and retrying wouldn't help.
 */
async function refundFlaggedCharge(c: Context<AppBindings>, evt: WebhookEvent): Promise<void> {
  const chargeId = fraudWarningChargeId(evt);
  if (!chargeId) {
    console.warn({ event: 'billing_efw_refund_skipped', eventId: evt.id, why: 'no_charge' });
    return;
  }
  const charge = await fetchCharge(c.env, chargeId);
  if (charge === null) {
    console.warn({ event: 'billing_efw_refund_skipped', eventId: evt.id, chargeId, why: 'charge_missing' });
    return;
  }
  const action = fraudWarningRefundAction(charge);
  if (action !== 'refund') {
    console.log({ event: 'billing_efw_refund_skipped', eventId: evt.id, chargeId, why: action });
    return;
  }
  try {
    const refundId = await refundFraudulentCharge(c.env, chargeId);
    console.log({ event: 'billing_efw_refunded', eventId: evt.id, chargeId, refundId });
  } catch (err) {
    if (!isPermissionError(err)) throw err;
    console.error({ event: 'billing_efw_refund_not_permitted', eventId: evt.id, chargeId, fix: 'add Refunds: write to the restricted key' });
  }
}

async function endProForRiskEvent(c: Context<AppBindings>, evt: WebhookEvent): Promise<void> {
  const plan = planRiskEvent(evt);
  if (plan.action === 'ignore') return;
  if (plan.action === 'log_partial_refund') {
    console.log({ event: 'billing_partial_refund', eventId: evt.id, chargeId: plan.chargeId });
    return;
  }
  const notSubscription = (why: string) =>
    console.log({ event: 'billing_risk_not_subscription', reason: plan.reason, eventId: evt.id, why });
  if (plan.action === 'no_payment_intent') return notSubscription('no_payment_intent');

  const paymentIntentId =
    plan.action === 'resolve_payment_intent'
      ? plan.paymentIntentId
      : await fetchChargePaymentIntent(c.env, plan.chargeId);
  if (!paymentIntentId) return notSubscription('no_payment_intent');

  const paidBy = await subscriptionsForPaymentIntent(c.env, paymentIntentId);
  if (paidBy.size === 0) return notSubscription('no_invoice_payment');

  for (const [subscriptionId, refundedInvoiceIds] of paidBy) {
    const before = await fetchSubscription(c.env, subscriptionId);
    if (!before) {
      notSubscription('subscription_gone');
      continue;
    }
    if (!isProPrice(before.priceId, c.env)) {
      console.warn({ event: 'billing_risk_not_pro_price', eventId: evt.id, subscriptionId, priceId: before.priceId });
      continue;
    }
    // A refund ends Pro only when it refunds the payment for the current
    // period and nothing else pays for it (risk-events.ts refundEndsPro).
    // Disputes and fraud warnings always end it.
    if (plan.reason === 'refund' && !alreadyEnded(before.status)) {
      const decision = await refundEndsPro(
        { refundedInvoiceIds, current: currentPeriodOf(before) },
        {
          paidInvoices: () => paidInvoicesOfSubscription(c.env, subscriptionId),
          chargesForInvoice: (invoiceId) => chargesForInvoice(c.env, invoiceId),
        },
      );
      if (!decision.ends) {
        console.log({ event: 'billing_refund_kept_pro', eventId: evt.id, subscriptionId, why: decision.why, keptBy: decision.keptBy });
        continue;
      }
    }
    const result = alreadyEnded(before.status)
      ? 'already_ended'
      : await cancelSubscription(c.env, subscriptionId, `aired: ${plan.reason}`);
    const after = (await fetchSubscription(c.env, subscriptionId)) ?? {
      ...before,
      status: 'canceled',
      cancelAtPeriodEnd: false,
    };
    const uid = await storeSubscription(c, evt, after);
    console.log({ event: 'billing_pro_revoked', reason: plan.reason, eventId: evt.id, uid, subscriptionId, result });
  }
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

  const problem = configProblem(c.env);
  if (problem) {
    console.error({ event: 'billing_misconfigured', error: problem });
    return c.redirect('/pricing?checkout=error', 302);
  }

  try {
    const result = await startCheckout(c, user, interval);
    if (result.kind === 'pro') return c.redirect('/dashboard', 302);
    if (result.kind === 'payment_failed') return c.redirect('/dashboard?billing=payment_failed', 302);
    if (result.kind === 'processing') return c.redirect('/pricing?checkout=processing', 302);
    return c.redirect(result.url, 303);
  } catch (err) {
    logBillingError('billing_upgrade_failed', user.id, err);
    return c.redirect('/pricing?checkout=error', 302);
  }
});

export { billing, upgrade };
