import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RISK_EVENTS,
  alreadyEnded,
  chargesAllRefunded,
  invoiceCoversTime,
  refundEndsPro,
  invoicePaymentsPage,
  isFullRefund,
  paymentIntentOfCharge,
  planRiskEvent,
  riskReason,
  subscriptionOfInvoice,
} from "../src/lib/billing/risk-events.ts";

const evt = (type: string, object: unknown) => ({ type, raw: { id: "evt_1", type, data: { object } } });

// Trimmed Charge, Dispute and EarlyFraudWarning shapes (API 2025-03-31.basil).
const charge = {
  id: "ch_1",
  object: "charge",
  amount: 1200,
  amount_refunded: 1200,
  refunded: true,
  payment_intent: "pi_1",
  customer: "cus_1",
};

test("the three risk events and their reason labels", () => {
  assert.deepEqual([...RISK_EVENTS].sort(), [
    "charge.dispute.created",
    "charge.refunded",
    "radar.early_fraud_warning.created",
  ]);
  assert.equal(riskReason("charge.refunded"), "refund");
  assert.equal(riskReason("charge.dispute.created"), "dispute");
  assert.equal(riskReason("radar.early_fraud_warning.created"), "early_fraud_warning");
  assert.equal(riskReason("charge.dispute.closed"), null);
  assert.equal(riskReason("invoice.paid"), null);
});

test("planRiskEvent ignores everything else", () => {
  assert.deepEqual(planRiskEvent(evt("charge.succeeded", charge)), { action: "ignore" });
  assert.deepEqual(planRiskEvent(evt("customer.subscription.updated", {})), { action: "ignore" });
});

test("full refund → resolve the charge's PaymentIntent", () => {
  assert.deepEqual(planRiskEvent(evt("charge.refunded", charge)), {
    action: "resolve_payment_intent", reason: "refund", paymentIntentId: "pi_1",
  });
  // an expanded payment_intent works too
  assert.deepEqual(planRiskEvent(evt("charge.refunded", { ...charge, payment_intent: { id: "pi_2" } })), {
    action: "resolve_payment_intent", reason: "refund", paymentIntentId: "pi_2",
  });
});

test("partial refund → log only", () => {
  const partial = { ...charge, refunded: false, amount_refunded: 500 };
  assert.deepEqual(planRiskEvent(evt("charge.refunded", partial)), {
    action: "log_partial_refund", reason: "refund", chargeId: "ch_1",
  });
});

test("full refund on a charge with no PaymentIntent (legacy) can't be resolved", () => {
  assert.deepEqual(planRiskEvent(evt("charge.refunded", { ...charge, payment_intent: null })), {
    action: "no_payment_intent", reason: "refund",
  });
});

test("isFullRefund: refunded flag, or amount_refunded covers amount", () => {
  assert.equal(isFullRefund({ refunded: true }), true);
  assert.equal(isFullRefund({ refunded: false, amount: 1200, amount_refunded: 1200 }), true);
  assert.equal(isFullRefund({ refunded: false, amount: 1200, amount_refunded: 1300 }), true);
  assert.equal(isFullRefund({ refunded: false, amount: 1200, amount_refunded: 1199 }), false);
  assert.equal(isFullRefund({ refunded: false, amount: 0, amount_refunded: 0 }), false);
  assert.equal(isFullRefund({ amount: "1200", amount_refunded: "1200" }), false);
  for (const g of [null, undefined, "ch_1", [], {}]) assert.equal(isFullRefund(g), false);
});

test("dispute with payment_intent → resolve it directly", () => {
  const dispute = { id: "dp_1", object: "dispute", charge: "ch_1", payment_intent: "pi_1", reason: "fraudulent" };
  assert.deepEqual(planRiskEvent(evt("charge.dispute.created", dispute)), {
    action: "resolve_payment_intent", reason: "dispute", paymentIntentId: "pi_1",
  });
});

test("dispute without payment_intent → fetch its charge", () => {
  const dispute = { id: "dp_1", object: "dispute", charge: "ch_9", payment_intent: null };
  assert.deepEqual(planRiskEvent(evt("charge.dispute.created", dispute)), {
    action: "fetch_charge", reason: "dispute", chargeId: "ch_9",
  });
});

test("early fraud warning: payment_intent, else an expanded charge's, else fetch the charge", () => {
  const efw = { id: "issfr_1", object: "radar.early_fraud_warning", charge: "ch_1", payment_intent: "pi_1" };
  assert.deepEqual(planRiskEvent(evt("radar.early_fraud_warning.created", efw)), {
    action: "resolve_payment_intent", reason: "early_fraud_warning", paymentIntentId: "pi_1",
  });
  const expanded = { ...efw, payment_intent: null, charge: { id: "ch_1", payment_intent: "pi_7" } };
  assert.deepEqual(planRiskEvent(evt("radar.early_fraud_warning.created", expanded)), {
    action: "resolve_payment_intent", reason: "early_fraud_warning", paymentIntentId: "pi_7",
  });
  const bare = { ...efw, payment_intent: null };
  assert.deepEqual(planRiskEvent(evt("radar.early_fraud_warning.created", bare)), {
    action: "fetch_charge", reason: "early_fraud_warning", chargeId: "ch_1",
  });
});

test("risk event with nothing to follow → no_payment_intent", () => {
  assert.deepEqual(planRiskEvent(evt("charge.dispute.created", { id: "dp_1", charge: null, payment_intent: null })), {
    action: "no_payment_intent", reason: "dispute",
  });
  assert.deepEqual(planRiskEvent({ type: "charge.dispute.created", raw: { data: {} } }), {
    action: "no_payment_intent", reason: "dispute",
  });
});

test("paymentIntentOfCharge reads id strings and expanded objects", () => {
  assert.equal(paymentIntentOfCharge(charge), "pi_1");
  assert.equal(paymentIntentOfCharge({ payment_intent: { id: "pi_3" } }), "pi_3");
  assert.equal(paymentIntentOfCharge({ payment_intent: null }), null);
  assert.equal(paymentIntentOfCharge("ch_1"), null);
});

test("invoicePaymentsPage collects paid invoices and the next cursor", () => {
  const page = {
    object: "list",
    has_more: true,
    data: [
      { id: "inpay_1", object: "invoice_payment", invoice: "in_1", status: "paid",
        payment: { type: "payment_intent", payment_intent: "pi_1" } },
      { id: "inpay_2", object: "invoice_payment", invoice: { id: "in_2", object: "invoice" }, status: "paid" },
      { id: "inpay_3", object: "invoice_payment", invoice: "in_3", status: "open" },
      { id: "inpay_4", object: "invoice_payment", invoice: null, status: "paid" },
    ],
  };
  const { invoices, nextCursor } = invoicePaymentsPage(page);
  assert.deepEqual(invoices, ["in_1", { id: "in_2", object: "invoice" }]);
  assert.equal(nextCursor, "inpay_4");
  assert.equal(invoicePaymentsPage({ ...page, has_more: false }).nextCursor, null);
  for (const g of [null, {}, { data: "x" }, []]) {
    assert.deepEqual(invoicePaymentsPage(g), { invoices: [], nextCursor: null });
  }
});

test("subscriptionOfInvoice: only invoices whose parent is a subscription", () => {
  const inv = {
    id: "in_1",
    object: "invoice",
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_1", metadata: { uid: "4" } } },
  };
  assert.equal(subscriptionOfInvoice(inv), "sub_1");
  assert.equal(
    subscriptionOfInvoice({ parent: { type: "subscription_details", subscription_details: { subscription: { id: "sub_2" } } } }),
    "sub_2",
  );
  assert.equal(subscriptionOfInvoice({ parent: { type: "quote_details", quote_details: { quote: "qt_1" } } }), null);
  assert.equal(subscriptionOfInvoice({ parent: null, subscription: "sub_old" }), null);
  assert.equal(subscriptionOfInvoice(null), null);
});

test("alreadyEnded: canceled and incomplete_expired", () => {
  assert.equal(alreadyEnded("canceled"), true);
  assert.equal(alreadyEnded("incomplete_expired"), true);
  for (const s of ["active", "past_due", "unpaid", "incomplete", "trialing", null, undefined]) {
    assert.equal(alreadyEnded(s), false, String(s));
  }
});

// --- Which full refunds end Pro --------------------------------------------------

const NOW = 1_800_000_000;
const DAY = 86_400;
/** A paid subscription invoice whose line covers [start, end). */
const inv = (id: string, start: number, end: number) => ({
  id,
  object: "invoice",
  status: "paid",
  // invoice.period_* describe the previous period on renewals; only lines count.
  period_start: start - 30 * DAY,
  period_end: start,
  lines: { data: [{ id: `il_${id}`, period: { start, end } }] },
});
const paidCharge = (refunded: boolean) => ({ status: "succeeded", paid: true, amount: 1200, amount_refunded: refunded ? 1200 : 0, refunded });

function deps(invoices: unknown[], charges: Record<string, unknown[]> = {}) {
  const asked: string[] = [];
  return {
    asked,
    deps: {
      paidInvoices: async () => invoices,
      chargesForInvoice: async (id: string) => { asked.push(id); return charges[id] ?? [paidCharge(false)]; },
    },
  };
}

test("invoiceCoversTime reads line periods, not invoice.period_*", () => {
  const current = inv("in_now", NOW - DAY, NOW + 29 * DAY);
  assert.equal(invoiceCoversTime(current, NOW), true);
  assert.equal(invoiceCoversTime(inv("in_old", NOW - 40 * DAY, NOW - 10 * DAY), NOW), false);
  // End is exclusive.
  assert.equal(invoiceCoversTime(inv("in_edge", NOW - 30 * DAY, NOW), NOW), false);
  assert.equal(invoiceCoversTime({ id: "in_x" }, NOW), false);
  // The invoice-level period (previous period) alone doesn't count.
  assert.equal(invoiceCoversTime({ id: "in_y", period_start: NOW - DAY, period_end: NOW + DAY, lines: { data: [] } }, NOW), false);
});

test("chargesAllRefunded needs at least one succeeded charge, all fully refunded", () => {
  assert.equal(chargesAllRefunded([paidCharge(true)]), true);
  assert.equal(chargesAllRefunded([paidCharge(true), paidCharge(false)]), false);
  assert.equal(chargesAllRefunded([]), false);
  assert.equal(chargesAllRefunded([{ status: "failed", amount: 1200, amount_refunded: 0 }]), false);
  assert.equal(chargesAllRefunded([{ status: "failed", amount: 1200 }, paidCharge(true)]), true);
});

test("refunding the only payment for the current period ends Pro (the 14-day refund)", async () => {
  const current = inv("in_now", NOW - DAY, NOW + 29 * DAY);
  const d = deps([current, inv("in_prev", NOW - 31 * DAY, NOW - DAY)]);
  assert.deepEqual(await refundEndsPro({ refundedInvoiceIds: new Set(["in_now"]), nowSec: NOW }, d.deps), { ends: true, keptBy: null });
  assert.deepEqual(d.asked, []); // the earlier month doesn't cover today, so it isn't even checked
});

test("refunding a duplicate charge for the same period keeps Pro", async () => {
  const real = inv("in_real", NOW - DAY, NOW + 29 * DAY);
  const dup = inv("in_dup", NOW - DAY, NOW + 29 * DAY);
  const d = deps([dup, real]);
  assert.deepEqual(await refundEndsPro({ refundedInvoiceIds: new Set(["in_dup"]), nowSec: NOW }, d.deps), { ends: false, keptBy: "in_real" });
});

test("refunding an earlier month keeps Pro while the current period is paid", async () => {
  const d = deps([inv("in_now", NOW - DAY, NOW + 29 * DAY), inv("in_prev", NOW - 31 * DAY, NOW - DAY)]);
  assert.deepEqual(await refundEndsPro({ refundedInvoiceIds: new Set(["in_prev"]), nowSec: NOW }, d.deps), { ends: false, keptBy: "in_now" });
});

test("refunding the second of two charges ends Pro when the first was already refunded", async () => {
  const d = deps(
    [inv("in_a", NOW - DAY, NOW + 29 * DAY), inv("in_b", NOW - DAY, NOW + 29 * DAY)],
    { in_a: [paidCharge(true)] },
  );
  assert.deepEqual(await refundEndsPro({ refundedInvoiceIds: new Set(["in_b"]), nowSec: NOW }, d.deps), { ends: true, keptBy: null });
  assert.deepEqual(d.asked, ["in_a"]);
});

test("one payment refunding several invoices of the subscription counts them all as refunded", async () => {
  const d = deps([inv("in_a", NOW - DAY, NOW + 29 * DAY), inv("in_b", NOW - DAY, NOW + 29 * DAY)]);
  assert.deepEqual(await refundEndsPro({ refundedInvoiceIds: new Set(["in_a", "in_b"]), nowSec: NOW }, d.deps), { ends: true, keptBy: null });
});
