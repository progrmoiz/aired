import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RISK_EVENTS,
  alreadyEnded,
  chargesAllRefunded,
  currentPeriodOf,
  paysForCurrentPeriod,
  provablyEarlierPeriod,
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

const DAY = 86_400;
const END = 1_800_000_000; // current period end
const CURRENT = { priceId: "price_y", periodEndSec: END };

/** A basil-shaped subscription line. */
const line = (o: { price?: string; start?: number; end?: number; amount?: number; proration?: boolean } = {}) => ({
  amount: o.amount ?? 10800,
  period: { start: o.start ?? END - 365 * DAY, end: o.end ?? END },
  pricing: { type: "price_details", price_details: { price: o.price ?? "price_y" } },
  parent: { type: "subscription_item_details", subscription_item_details: { proration: o.proration ?? false } },
});
const inv = (id: string, lines: unknown[] = [line()], amountPaid = 10800) => ({ id, object: "invoice", status: "paid", amount_paid: amountPaid, lines: { data: lines } });
const paidCharge = (refunded: boolean) => ({ status: "succeeded", paid: true, amount: 10800, amount_refunded: refunded ? 10800 : 0, refunded });

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
const decide = (refunded: string[], d: ReturnType<typeof deps>) =>
  refundEndsPro({ refundedInvoiceIds: new Set(refunded), current: CURRENT }, d.deps);

test("paysForCurrentPeriod: a regular line at the current price ending at the period end", () => {
  assert.equal(paysForCurrentPeriod(inv("a"), CURRENT), true);
  // Old monthly invoice from before a switch to yearly.
  assert.equal(paysForCurrentPeriod(inv("m", [line({ price: "price_m", start: END - 400 * DAY, end: END - 370 * DAY, amount: 1200 })]), CURRENT), false);
  // Same price, earlier period.
  assert.equal(paysForCurrentPeriod(inv("p", [line({ end: END - 365 * DAY })]), CURRENT), false);
  // Proration lines and $0 lines don't pay for the period.
  assert.equal(paysForCurrentPeriod(inv("pr", [line({ proration: true })]), CURRENT), false);
  assert.equal(paysForCurrentPeriod(inv("z", [line({ amount: 0 })]), CURRENT), false);
  assert.equal(paysForCurrentPeriod(inv("neg", [line({ amount: -500 })]), CURRENT), false);
  // One qualifying line among others is enough.
  assert.equal(paysForCurrentPeriod(inv("mix", [line({ proration: true, amount: -300 }), line()]), CURRENT), true);
  assert.equal(paysForCurrentPeriod({ id: "x" }, CURRENT), false);
  // A line at the current period end but for another price doesn't count.
  assert.equal(paysForCurrentPeriod(inv("other", [line({ price: "price_other" })]), CURRENT), false);
  assert.equal(paysForCurrentPeriod(inv("a"), { priceId: "price_y", periodEndSec: null }), false);
  assert.equal(paysForCurrentPeriod(inv("a"), { priceId: null, periodEndSec: END }), false);
});

test("paysForCurrentPeriod reads the older line shape too", () => {
  const old = { id: "o", lines: { data: [{ amount: 10800, proration: false, price: { id: "price_y" }, period: { start: END - 365 * DAY, end: END } }] } };
  assert.equal(paysForCurrentPeriod(old, CURRENT), true);
  assert.equal(paysForCurrentPeriod({ id: "o2", lines: { data: [{ ...old.lines.data[0], proration: true }] } }, CURRENT), false);
});

test("currentPeriodOf converts the stored period end to seconds and keeps the status", () => {
  assert.deepEqual(currentPeriodOf({ priceId: "price_y", currentPeriodEnd: new Date(END * 1000).toISOString() }), CURRENT);
  assert.deepEqual(currentPeriodOf({ priceId: "price_y", currentPeriodEnd: new Date(END * 1000).toISOString(), status: "past_due" }), { ...CURRENT, status: "past_due" });
  assert.deepEqual(currentPeriodOf({ priceId: "price_y", currentPeriodEnd: null }), { priceId: "price_y", periodEndSec: null });
});

test("chargesAllRefunded needs at least one succeeded charge, all fully refunded", () => {
  assert.equal(chargesAllRefunded([paidCharge(true)]), true);
  assert.equal(chargesAllRefunded([paidCharge(true), paidCharge(false)]), false);
  assert.equal(chargesAllRefunded([]), false);
  assert.equal(chargesAllRefunded([{ status: "failed", amount: 1200, amount_refunded: 0 }]), false);
  assert.equal(chargesAllRefunded([{ status: "failed", amount: 1200 }, paidCharge(true)]), true);
  assert.equal(chargesAllRefunded([{ ...paidCharge(false), amount_refunded: 5000 }]), false); // partial
});

test("refunding the only payment for the current period ends Pro (the 14-day refund)", async () => {
  const d = deps([inv("in_now"), inv("in_prev", [line({ end: END - 365 * DAY })])]);
  assert.deepEqual(await decide(["in_now"], d), { ends: true, why: "nothing_else_pays", keptBy: null });
  assert.deepEqual(d.asked, []); // the earlier year doesn't pay for this one, so it isn't checked
});

test("refunding a duplicate charge for the current period keeps Pro", async () => {
  const d = deps([inv("in_dup"), inv("in_real")]);
  assert.deepEqual(await decide(["in_dup"], d), { ends: false, why: "other_invoice", keptBy: "in_real" });
});

test("refunding an earlier month keeps Pro while the current period is paid", async () => {
  const d = deps([inv("in_now"), inv("in_prev", [line({ end: END - 365 * DAY })])]);
  assert.deepEqual(await decide(["in_prev"], d), { ends: false, why: "other_invoice", keptBy: "in_now" });
});

test("refunding an earlier period while past_due keeps Pro for Stripe's retries; while active with nothing paid, it ends", async () => {
  const prev = inv("in_prev", [line({ end: END - 365 * DAY })]);
  const pastDue = await refundEndsPro({ refundedInvoiceIds: new Set(["in_prev"]), current: { ...CURRENT, status: "past_due" } }, deps([prev]).deps);
  assert.deepEqual(pastDue, { ends: false, why: "earlier_period_in_dunning", keptBy: null });
  const active = await refundEndsPro({ refundedInvoiceIds: new Set(["in_prev"]), current: { ...CURRENT, status: "active" } }, deps([prev]).deps);
  assert.equal(active.ends, true);
});

test("while past_due, a refunded invoice that can't be read or isn't for an earlier period ends Pro", async () => {
  const pd = { ...CURRENT, status: "past_due" };
  // Not in the listed page.
  assert.equal((await refundEndsPro({ refundedInvoiceIds: new Set(["in_gone"]), current: pd }, deps([]).deps)).ends, true);
  // No readable lines.
  assert.equal((await refundEndsPro({ refundedInvoiceIds: new Set(["in_x"]), current: pd }, deps([{ id: "in_x", amount_paid: 10800 }]).deps)).ends, true);
  // Its period reaches the current period end.
  assert.equal((await refundEndsPro({ refundedInvoiceIds: new Set(["in_now"]), current: pd }, deps([inv("in_now")]).deps)).ends, true);
});

test("provablyEarlierPeriod needs readable regular lines that all end before the current period end", () => {
  assert.equal(provablyEarlierPeriod(inv("p", [line({ end: END - DAY })]), CURRENT), true);
  assert.equal(provablyEarlierPeriod(inv("p", [line({ end: END })]), CURRENT), false);
  assert.equal(provablyEarlierPeriod(inv("p", [line({ end: END - DAY }), line({ end: END + DAY })]), CURRENT), false);
  assert.equal(provablyEarlierPeriod(inv("p", [line({ proration: true, end: END - DAY })]), CURRENT), false);
  assert.equal(provablyEarlierPeriod({ id: "p" }, CURRENT), false);
  assert.equal(provablyEarlierPeriod(inv("p", [line({ end: END - DAY })]), { priceId: "price_y", periodEndSec: null }), false);
});

test("after a yearly-to-monthly switch paid with credit, refunding the yearly charge ends Pro", async () => {
  const MONTHLY = { priceId: "price_m", periodEndSec: END - 330 * DAY, status: "active" };
  const yearly = inv("in_y", [line({ price: "price_y", start: END - 365 * DAY, end: END })]);
  const switchInv = inv("in_switch", [line({ price: "price_m", start: END - 360 * DAY, end: END - 330 * DAY, amount: 1200 }), line({ price: "price_y", proration: true, amount: -10000 })], 0);
  const out = await refundEndsPro({ refundedInvoiceIds: new Set(["in_y"]), current: MONTHLY }, deps([switchInv, yearly]).deps);
  assert.deepEqual(out, { ends: true, why: "nothing_else_pays", keptBy: null });
});

test("after a monthly-to-yearly switch, refunding the yearly charge ends Pro despite the paid monthly invoice", async () => {
  const monthly = inv("in_m", [line({ price: "price_m", start: END - 375 * DAY, end: END - 345 * DAY, amount: 1200 })], 1200);
  const d = deps([inv("in_y"), monthly]);
  assert.deepEqual(await decide(["in_y"], d), { ends: true, why: "nothing_else_pays", keptBy: null });
  assert.deepEqual(d.asked, []);
});

test("a covering invoice paid $0 or with no charges found doesn't keep Pro", async () => {
  assert.equal((await decide(["in_y"], deps([inv("in_y"), inv("in_free", [line()], 0)]))).ends, true);
  assert.equal((await decide(["in_y"], deps([inv("in_y"), inv("in_oob")], { in_oob: [] }))).ends, true);
});

test("a covering invoice that was itself fully refunded doesn't keep Pro; a partial refund does", async () => {
  const both = deps([inv("in_a"), inv("in_b")], { in_a: [paidCharge(true)] });
  assert.deepEqual(await decide(["in_b"], both), { ends: true, why: "nothing_else_pays", keptBy: null });
  assert.deepEqual(both.asked, ["in_a"]);
  const partial = deps([inv("in_a"), inv("in_b")], { in_a: [{ ...paidCharge(false), amount_refunded: 5000 }] });
  assert.equal((await decide(["in_b"], partial)).ends, false);
});

test("the first invoice that keeps Pro stops the search", async () => {
  const d = deps([inv("in_r"), inv("in_k1"), inv("in_k2")]);
  assert.equal((await decide(["in_r"], d)).keptBy, "in_k1");
  assert.deepEqual(d.asked, ["in_k1"]);
});

test("one payment for several invoices of the subscription counts them all as refunded", async () => {
  assert.equal((await decide(["in_a", "in_b"], deps([inv("in_a"), inv("in_b")]))).ends, true);
});

test("an unreadable current period ends Pro, as before; invoices without ids are skipped", async () => {
  const d = deps([inv("in_now")]);
  assert.deepEqual(
    await refundEndsPro({ refundedInvoiceIds: new Set(["in_now"]), current: { priceId: "price_y", periodEndSec: null } }, d.deps),
    { ends: true, why: "period_unknown", keptBy: null },
  );
  const noId = { ...inv("x"), id: undefined };
  assert.equal((await decide(["in_now"], deps([inv("in_now"), noId]))).ends, true);
});

test("Stripe lookup failures propagate so the webhook is retried", async () => {
  await assert.rejects(
    refundEndsPro({ refundedInvoiceIds: new Set(["a"]), current: CURRENT }, { paidInvoices: async () => { throw new Error("stripe 500"); }, chargesForInvoice: async () => [] }),
    /stripe 500/,
  );
  await assert.rejects(
    refundEndsPro({ refundedInvoiceIds: new Set(["a"]), current: CURRENT }, { paidInvoices: async () => [inv("a"), inv("b")], chargesForInvoice: async () => { throw new Error("stripe 503"); } }),
    /stripe 503/,
  );
});

// Tripwire: routes/billing.ts and stripe.ts can't be imported here.
test("billing.ts runs the refund check only for refunds on live subscriptions, and skips the cancel when it keeps Pro", async () => {
  const { readFileSync } = await import("node:fs");
  const code = readFileSync(new URL("../src/routes/billing.ts", import.meta.url), "utf8");
  assert.match(code, /if \(plan\.reason === 'refund' && !alreadyEnded\(before\.status\)\) \{\s*const decision = await refundEndsPro\(/);
  assert.match(code, /\{ refundedInvoiceIds, current: currentPeriodOf\(before\) \}/);
  assert.match(code, /if \(!decision\.ends\) \{[^}]*\}\);\s*continue;/);
  const stripe = readFileSync(new URL("../src/lib/billing/stripe.ts", import.meta.url), "utf8");
  assert.match(stripe, /subscription: subscriptionId, status: 'paid'/);
  assert.match(stripe, /invoice: invoiceId, status: 'paid'/);
  assert.match(stripe, /found\.set\(sub, \(found\.get\(sub\) \?\? new Set\(\)\)\.add\(invoiceId\)\)/);
});
