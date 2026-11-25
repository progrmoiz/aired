/**
 * Refunds, disputes and early fraud warnings end Pro. Pure decisions only: which
 * Stripe id to resolve next, whether a refund is full, and the reason label.
 * The lookups (charge → invoice payments → invoice → subscription, then cancel)
 * happen in routes/billing.ts. No imports, so node tests load this directly.
 *
 * Object graph for API 2025-03-31.basil and later (Stripe: "Handle refund,
 * dispute, and early fraud warning events"): PaymentIntent id → GET
 * /v1/invoice_payments?payment[type]=payment_intent&payment[payment_intent]=…&status=paid
 * → each invoice → parent.subscription_details.subscription.
 */

export const RISK_EVENTS: readonly string[] = [
  'charge.refunded',
  'charge.dispute.created',
  'radar.early_fraud_warning.created',
];

export type RiskReason = 'refund' | 'dispute' | 'early_fraud_warning';

export type RiskPlan =
  /** Not a risk event. */
  | { action: 'ignore' }
  /** A partial refund: log it, keep Pro. */
  | { action: 'log_partial_refund'; reason: 'refund'; chargeId: string | null }
  /** Resolve the subscriptions paid by this PaymentIntent. */
  | { action: 'resolve_payment_intent'; reason: RiskReason; paymentIntentId: string }
  /** Fetch this charge first; its payment_intent leads on. */
  | { action: 'fetch_charge'; reason: RiskReason; chargeId: string }
  /** No PaymentIntent and no charge to fetch: not something we can tie to a subscription. */
  | { action: 'no_payment_intent'; reason: RiskReason };

type Obj = Record<string, unknown>;

export function riskReason(type: string): RiskReason | null {
  if (type === 'charge.refunded') return 'refund';
  if (type === 'charge.dispute.created') return 'dispute';
  if (type === 'radar.early_fraud_warning.created') return 'early_fraud_warning';
  return null;
}

/** What to do with a risk event, from the event body alone. */
export function planRiskEvent(evt: { type: string; raw: unknown }): RiskPlan {
  const reason = riskReason(evt.type);
  if (!reason) return { action: 'ignore' };
  const obj = record(record(record(evt.raw)?.data)?.object);
  if (!obj) return { action: 'no_payment_intent', reason };

  if (reason === 'refund') {
    // The event object is the Charge itself.
    if (!isFullRefund(obj)) return { action: 'log_partial_refund', reason, chargeId: str(obj.id) };
    const pi = idOf(obj.payment_intent);
    return pi ? { action: 'resolve_payment_intent', reason, paymentIntentId: pi } : { action: 'no_payment_intent', reason };
  }

  // Dispute or EarlyFraudWarning: payment_intent is nullable; fall back to its charge.
  const pi = idOf(obj.payment_intent) ?? paymentIntentOfCharge(obj.charge);
  if (pi) return { action: 'resolve_payment_intent', reason, paymentIntentId: pi };
  const chargeId = idOf(obj.charge);
  return chargeId ? { action: 'fetch_charge', reason, chargeId } : { action: 'no_payment_intent', reason };
}

/** A refund counts as full when Stripe says `refunded`, or the refunded amount covers the charge. */
export function isFullRefund(charge: unknown): boolean {
  const c = record(charge);
  if (!c) return false;
  if (c.refunded === true) return true;
  const amount = c.amount;
  const refunded = c.amount_refunded;
  return (
    typeof amount === 'number' && typeof refunded === 'number' && amount > 0 && refunded >= amount
  );
}

/** The PaymentIntent id on a Charge (id string or expanded object), or null. */
export function paymentIntentOfCharge(charge: unknown): string | null {
  return idOf(record(charge)?.payment_intent);
}

/**
 * One page of GET /v1/invoice_payments: the invoices it points at (ids, or the
 * expanded invoice objects) and the cursor for the next page.
 */
export function invoicePaymentsPage(list: unknown): {
  invoices: Array<string | Obj>;
  nextCursor: string | null;
} {
  const l = record(list);
  const data = Array.isArray(l?.data) ? l.data : [];
  const invoices: Array<string | Obj> = [];
  let lastId: string | null = null;
  for (const item of data) {
    const p = record(item);
    if (!p) continue;
    lastId = str(p.id) ?? lastId;
    if (p.status !== undefined && p.status !== 'paid') continue;
    const inv = p.invoice;
    if (str(inv)) invoices.push(inv as string);
    else if (record(inv) && str(record(inv)!.id)) invoices.push(record(inv)!);
  }
  return { invoices, nextCursor: l?.has_more === true && lastId ? lastId : null };
}

/** The subscription an invoice belongs to, or null when its parent isn't a subscription. */
export function subscriptionOfInvoice(invoice: unknown): string | null {
  const parent = record(record(invoice)?.parent);
  if (!parent || parent.type !== 'subscription_details') return null;
  return idOf(record(parent.subscription_details)?.subscription);
}

/** The subscription's current price and period end, which an invoice must pay for to count. */
export type CurrentPeriod = { priceId: string | null; periodEndSec: number | null };

/** The current period of a normalized subscription (period end as an ISO string). */
export function currentPeriodOf(sub: { priceId: string | null; currentPeriodEnd: string | null }): CurrentPeriod {
  const ms = sub.currentPeriodEnd === null ? NaN : Date.parse(sub.currentPeriodEnd);
  return { priceId: sub.priceId, periodEndSec: Number.isFinite(ms) ? Math.floor(ms / 1000) : null };
}

/**
 * Whether an invoice pays for the subscription's current period: it has a
 * regular (non-proration) line with a positive amount, for the current price,
 * whose period ends at the current period end. An invoice from before a
 * monthly↔yearly switch, a proration credit, or a $0 line doesn't count.
 * Reads basil line shapes (parent.subscription_item_details.proration,
 * pricing.price_details.price) and the older ones (proration, price.id).
 */
export function paysForCurrentPeriod(invoice: unknown, current: CurrentPeriod): boolean {
  if (current.priceId === null || current.periodEndSec === null) return false;
  const lines = record(record(invoice)?.lines)?.data;
  if (!Array.isArray(lines)) return false;
  return lines.some((raw) => {
    const line = record(raw);
    if (!line) return false;
    const details = record(record(line.parent)?.subscription_item_details);
    const proration = details?.proration ?? line.proration;
    if (proration === true) return false;
    const amount = line.amount;
    if (typeof amount !== 'number' || amount <= 0) return false;
    const price = idOf(record(record(line.pricing)?.price_details)?.price) ?? idOf(line.price);
    if (price !== current.priceId) return false;
    const end = record(line.period)?.end;
    return typeof end === 'number' && end >= current.periodEndSec!;
  });
}

/** True when there is at least one succeeded charge and every succeeded charge is fully refunded. */
export function chargesAllRefunded(charges: unknown[]): boolean {
  const paid = charges.filter((c) => record(c)?.status === 'succeeded' || record(c)?.paid === true);
  return paid.length > 0 && paid.every(isFullRefund);
}

export type RefundDecision = {
  ends: boolean;
  /** Why Pro is kept: the refund was for an earlier period, or another invoice pays for this one. */
  why: 'earlier_period' | 'other_invoice' | 'nothing_else_pays' | 'period_unknown';
  keptBy: string | null;
};

/**
 * Does a full refund end Pro? Only when it refunds the payment for the
 * subscription's current period and no other invoice still pays for that
 * period with a real, unrefunded charge.
 * - Refunding an earlier period (or a duplicate of one) keeps Pro: the current
 *   period is paid, or Stripe's normal retries deal with it.
 * - Refunding a duplicate charge for the current period keeps Pro: the other
 *   payment still covers it.
 * - Refunding the only payment for the current period (the 14-day refund) ends Pro.
 * When the current period can't be read, it ends Pro, as before this rule.
 * Disputes and fraud warnings don't use this: they always end Pro.
 */
export async function refundEndsPro(
  input: { refundedInvoiceIds: ReadonlySet<string>; current: CurrentPeriod },
  deps: {
    /** The subscription's recent paid invoices (most recent first). */
    paidInvoices: () => Promise<unknown[]>;
    /** Every charge that paid this invoice. */
    chargesForInvoice: (invoiceId: string) => Promise<unknown[]>;
  },
): Promise<RefundDecision> {
  if (input.current.priceId === null || input.current.periodEndSec === null) {
    return { ends: true, why: 'period_unknown', keptBy: null };
  }
  const invoices = await deps.paidInvoices();
  const idOfInvoice = (inv: unknown) => str(record(inv)?.id);

  const refundedCurrent = invoices.some((inv) => {
    const id = idOfInvoice(inv);
    return id !== null && input.refundedInvoiceIds.has(id) && paysForCurrentPeriod(inv, input.current);
  });
  if (!refundedCurrent) return { ends: false, why: 'earlier_period', keptBy: null };

  for (const invoice of invoices) {
    const id = idOfInvoice(invoice);
    if (id === null || input.refundedInvoiceIds.has(id)) continue;
    if (!paysForCurrentPeriod(invoice, input.current)) continue;
    const paid = record(invoice)?.amount_paid;
    if (typeof paid !== 'number' || paid <= 0) continue;
    const charges = await deps.chargesForInvoice(id);
    // No charges found means we can't show it was paid: it doesn't keep Pro.
    if (charges.length > 0 && !chargesAllRefunded(charges)) return { ends: false, why: 'other_invoice', keptBy: id };
  }
  return { ends: true, why: 'nothing_else_pays', keptBy: null };
}

/** A subscription status that means there is nothing left to cancel. */
export function alreadyEnded(status: string | null | undefined): boolean {
  return status === 'canceled' || status === 'incomplete_expired';
}

function record(v: unknown): Obj | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function idOf(v: unknown): string | null {
  return str(v) ?? str(record(v)?.id);
}
