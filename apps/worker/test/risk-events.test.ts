import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RISK_EVENTS,
  alreadyEnded,
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
