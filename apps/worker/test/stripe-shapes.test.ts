import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HANDLED_EVENTS,
  STRIPE_API_VERSION,
  checkoutParams,
  LIVE_STATUSES,
  BillingConfigError,
  StripeError,
  checkoutConfigProblem,
  eventSubscription,
  stripeKeyProblem,
  isMissingCustomer,
  stripeErrorFrom,
  liveSubscriptions,
  normalizeSubscription,
  shouldStoreSubscription,
  subscriptionIdFromEvent,
  uidFromEvent,
} from "../src/lib/billing/stripe-shapes.ts";

// Trimmed from real Stripe API responses; unrelated fields kept so the
// normalizer has to pick the right ones.

// 2025-03-31.basil and later: the period lives on the subscription item.
const basilSubscription = {
  id: "sub_1RbasilA2b3C4d5E",
  object: "subscription",
  application: null,
  billing_cycle_anchor: 1_782_000_000,
  cancel_at: null,
  cancel_at_period_end: false,
  canceled_at: null,
  collection_method: "charge_automatically",
  created: 1_782_000_000,
  currency: "usd",
  customer: "cus_SbasilCustomer1",
  default_payment_method: "pm_1RbasilCard",
  items: {
    object: "list",
    data: [
      {
        id: "si_SbasilItem1",
        object: "subscription_item",
        created: 1_782_000_001,
        current_period_end: 1_813_536_000,
        current_period_start: 1_782_000_000,
        metadata: {},
        price: {
          id: "price_1RyearlyPro",
          object: "price",
          active: true,
          currency: "usd",
          product: "prod_SPro",
          recurring: { interval: "year", interval_count: 1, usage_type: "licensed" },
          type: "recurring",
          unit_amount: 10800,
        },
        quantity: 1,
        subscription: "sub_1RbasilA2b3C4d5E",
      },
    ],
    has_more: false,
    total_count: 1,
    url: "/v1/subscription_items?subscription=sub_1RbasilA2b3C4d5E",
  },
  latest_invoice: "in_1RbasilInvoice",
  livemode: false,
  metadata: { uid: "583231" },
  start_date: 1_782_000_000,
  status: "active",
  trial_end: null,
};

// Pre-2025-03 shape: top-level period end, legacy `plan` on the item.
const olderSubscription = {
  id: "sub_1OolderX9y8Z7w6V",
  object: "subscription",
  cancel_at_period_end: true,
  current_period_end: 1_767_225_600,
  current_period_start: 1_764_547_200,
  customer: {
    id: "cus_OolderCustomer2",
    object: "customer",
    email: "someone@example.com",
  },
  items: {
    object: "list",
    data: [
      {
        id: "si_OolderItem2",
        object: "subscription_item",
        plan: { id: "price_1OmonthlyPro", object: "plan", interval: "month", amount: 1200 },
        price: { id: "price_1OmonthlyPro", object: "price", recurring: null },
        quantity: 1,
      },
    ],
    has_more: false,
  },
  metadata: { uid: 1000000000007 },
  status: "past_due",
};

const checkoutCompleted = {
  id: "evt_1RcheckoutDone",
  object: "event",
  api_version: "2025-03-31.basil",
  created: 1_782_000_005,
  data: {
    object: {
      id: "cs_test_a1B2c3D4e5F6",
      object: "checkout.session",
      client_reference_id: "583231",
      customer: "cus_SbasilCustomer1",
      customer_details: { email: "someone@example.com" },
      metadata: { uid: "583231" },
      mode: "subscription",
      payment_status: "paid",
      status: "complete",
      subscription: "sub_1RbasilA2b3C4d5E",
      success_url: "https://aired.sh/dashboard?upgraded=1",
    },
  },
  livemode: false,
  pending_webhooks: 1,
  request: { id: null, idempotency_key: null },
  type: "checkout.session.completed",
};

// basil invoices drop the top-level `subscription`; it moves under `parent`.
const invoicePaymentFailed = {
  id: "evt_1RinvoiceFailed",
  object: "event",
  api_version: "2025-03-31.basil",
  created: 1_813_536_100,
  data: {
    object: {
      id: "in_1RrenewalInvoice",
      object: "invoice",
      amount_due: 10800,
      attempt_count: 1,
      billing_reason: "subscription_cycle",
      customer: "cus_SbasilCustomer1",
      metadata: {},
      parent: {
        type: "subscription_details",
        quote_details: null,
        subscription_details: {
          metadata: { uid: "583231" },
          subscription: "sub_1RbasilA2b3C4d5E",
        },
      },
      status: "open",
    },
  },
  livemode: false,
  type: "invoice.payment_failed",
};

const subscriptionDeleted = {
  id: "evt_1RsubDeleted",
  object: "event",
  data: { object: { ...basilSubscription, status: "canceled" } },
  type: "customer.subscription.deleted",
};

const garbage: unknown[] = [
  null,
  undefined,
  0,
  42,
  "",
  "sub_123",
  [],
  [basilSubscription],
  {},
  { type: "checkout.session.completed" },
  { type: "checkout.session.completed", data: null },
  { type: "checkout.session.completed", data: { object: "nope" } },
  { type: 7, data: { object: { subscription: "sub_x" } } },
  { type: "charge.succeeded", data: { object: { id: "ch_1", subscription: "sub_x", metadata: { uid: "5" } } } },
  { data: { object: basilSubscription } },
];

test("the API version is pinned to basil", () => {
  assert.equal(STRIPE_API_VERSION, "2025-03-31.basil");
});

test("handles exactly the six lifecycle webhook events", () => {
  assert.deepEqual([...HANDLED_EVENTS].sort(), [
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.deleted",
    "customer.subscription.updated",
    "invoice.paid",
    "invoice.payment_failed",
  ]);
});

test("normalizes a basil subscription (period end on the item)", () => {
  assert.deepEqual(normalizeSubscription(basilSubscription), {
    id: "sub_1RbasilA2b3C4d5E",
    customerId: "cus_SbasilCustomer1",
    status: "active",
    interval: "year",
    currentPeriodEnd: new Date(1_813_536_000 * 1000).toISOString(),
    cancelAtPeriodEnd: false,
    uid: 583231,
    priceId: "price_1RyearlyPro",
  });
});

test("normalizes an older subscription (top-level period end, expanded customer)", () => {
  assert.deepEqual(normalizeSubscription(olderSubscription), {
    id: "sub_1OolderX9y8Z7w6V",
    customerId: "cus_OolderCustomer2",
    status: "past_due",
    interval: "month",
    currentPeriodEnd: "2026-01-01T00:00:00.000Z",
    cancelAtPeriodEnd: true,
    uid: 1000000000007,
    priceId: "price_1OmonthlyPro",
  });
});

test("the item period end wins over the top-level one", () => {
  const both = { ...basilSubscription, current_period_end: 1_700_000_000 };
  assert.equal(normalizeSubscription(both)?.currentPeriodEnd, new Date(1_813_536_000 * 1000).toISOString());
});

test("missing or odd fields normalize to null rather than guesses", () => {
  const sub = normalizeSubscription({
    id: "sub_bare",
    customer: "cus_bare",
    status: "incomplete",
    items: { data: [{ price: { recurring: { interval: "week" } } }] },
    metadata: { uid: "-4" },
  });
  assert.deepEqual(sub, {
    id: "sub_bare",
    customerId: "cus_bare",
    status: "incomplete",
    interval: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    uid: null,
    priceId: null,
  });
  for (const uid of ["0", "1.5", "12abc", "", 0, 3.2, -1, "9007199254740993", true, null]) {
    const s = normalizeSubscription({ ...basilSubscription, metadata: { uid } });
    assert.equal(s?.uid, null, String(uid));
  }
  assert.equal(normalizeSubscription({ ...basilSubscription, metadata: undefined })?.uid, null);
});

test("a subscription without an id, customer or status is rejected", () => {
  assert.equal(normalizeSubscription({ ...basilSubscription, id: undefined }), null);
  assert.equal(normalizeSubscription({ ...basilSubscription, customer: null }), null);
  assert.equal(normalizeSubscription({ ...basilSubscription, customer: { object: "customer" } }), null);
  assert.equal(normalizeSubscription({ ...basilSubscription, status: 3 }), null);
});

test("garbage never throws and normalizes to null", () => {
  for (const g of garbage) {
    assert.doesNotThrow(() => normalizeSubscription(g));
    assert.equal(normalizeSubscription(g), null, JSON.stringify(g));
    assert.equal(subscriptionIdFromEvent(g), null, JSON.stringify(g));
    assert.equal(uidFromEvent(g), null, JSON.stringify(g));
  }
});

test("checkout.session.completed gives the subscription id and uid", () => {
  assert.equal(subscriptionIdFromEvent(checkoutCompleted), "sub_1RbasilA2b3C4d5E");
  assert.equal(uidFromEvent(checkoutCompleted), 583231);
});

test("a checkout session falls back to metadata.uid, and to an expanded subscription id", () => {
  const evt = {
    type: "checkout.session.completed",
    data: {
      object: {
        client_reference_id: null,
        metadata: { uid: "77" },
        subscription: { id: "sub_expanded", object: "subscription" },
      },
    },
  };
  assert.equal(uidFromEvent(evt), 77);
  assert.equal(subscriptionIdFromEvent(evt), "sub_expanded");
});

test("invoice.payment_failed with only parent.subscription_details", () => {
  assert.equal(subscriptionIdFromEvent(invoicePaymentFailed), "sub_1RbasilA2b3C4d5E");
  assert.equal(uidFromEvent(invoicePaymentFailed), 583231);
});

test("an older invoice with a top-level subscription", () => {
  const evt = {
    type: "invoice.payment_failed",
    data: { object: { id: "in_old", subscription: "sub_old", subscription_details: { metadata: { uid: "9" } } } },
  };
  assert.equal(subscriptionIdFromEvent(evt), "sub_old");
  assert.equal(uidFromEvent(evt), 9);
});

test("customer.subscription.* gives the object id and metadata uid", () => {
  assert.equal(subscriptionIdFromEvent(subscriptionDeleted), "sub_1RbasilA2b3C4d5E");
  assert.equal(uidFromEvent(subscriptionDeleted), 583231);
  const updated = { type: "customer.subscription.updated", data: { object: { id: "sub_u", metadata: {} } } };
  assert.equal(subscriptionIdFromEvent(updated), "sub_u");
  assert.equal(uidFromEvent(updated), null);
});

const baseCheckout = {
  uid: 583231,
  interval: "year" as const,
  priceMonthly: "price_monthly",
  priceYearly: "price_yearly",
  customerId: null,
  email: "someone@example.com",
  automaticTax: false,
  origin: "https://aired.sh",
};

test("checkout params for a new customer, tax off", () => {
  const p = checkoutParams(baseCheckout);
  assert.deepEqual(Object.fromEntries(p), {
    mode: "subscription",
    "line_items[0][price]": "price_yearly",
    "line_items[0][quantity]": "1",
    client_reference_id: "583231",
    "metadata[uid]": "583231",
    "subscription_data[metadata][uid]": "583231",
    customer_email: "someone@example.com",
    success_url: "https://aired.sh/dashboard?upgraded=1",
    cancel_url: "https://aired.sh/pricing",
  });
  assert.equal(p.has("automatic_tax[enabled]"), false);
  assert.equal(p.has("customer_update[address]"), false);
  assert.equal(p.has("customer"), false);
});

test("checkout params pick the monthly price", () => {
  const p = checkoutParams({ ...baseCheckout, interval: "month" });
  assert.equal(p.get("line_items[0][price]"), "price_monthly");
});

test("checkout params with tax on", () => {
  const p = checkoutParams({ ...baseCheckout, automaticTax: true });
  assert.equal(p.get("automatic_tax[enabled]"), "true");
  // customer_update only applies to an existing customer
  assert.equal(p.has("customer_update[address]"), false);
});

test("a known customer is reused instead of the email", () => {
  const off = checkoutParams({ ...baseCheckout, customerId: "cus_123" });
  assert.equal(off.get("customer"), "cus_123");
  assert.equal(off.has("customer_email"), false);
  assert.equal(off.has("customer_update[address]"), false);
  assert.equal(off.has("automatic_tax[enabled]"), false);

  const on = checkoutParams({ ...baseCheckout, customerId: "cus_123", automaticTax: true });
  assert.equal(on.get("customer"), "cus_123");
  assert.equal(on.get("automatic_tax[enabled]"), "true");
  assert.equal(on.get("customer_update[address]"), "auto");
});

test("no customer and no email sends neither", () => {
  const p = checkoutParams({ ...baseCheckout, email: null });
  assert.equal(p.has("customer"), false);
  assert.equal(p.has("customer_email"), false);
});

test("the dev origin is used for the return urls", () => {
  const p = checkoutParams({ ...baseCheckout, origin: "http://localhost:8787" });
  assert.equal(p.get("success_url"), "http://localhost:8787/dashboard?upgraded=1");
  assert.equal(p.get("cancel_url"), "http://localhost:8787/pricing");
});

// A late or retried event for an old subscription must not replace a newer, paid one.
const nowS = new Date("2026-06-15T12:00:00Z");
const DAY_MS = 24 * 3600 * 1000;
const nextMonth = new Date(nowS.getTime() + 30 * DAY_MS).toISOString();
const lastMonth = new Date(nowS.getTime() - 30 * DAY_MS).toISOString();
const incomingSub = (id: string, status: string, currentPeriodEnd: string | null) => ({
  id, customerId: "cus_1", status, interval: "month" as const, currentPeriodEnd, cancelAtPeriodEnd: false, uid: 5,
});

test("the same subscription is always stored", () => {
  const existing = { subscriptionId: "sub_A", status: "active", currentPeriodEnd: nextMonth };
  assert.equal(shouldStoreSubscription(existing, incomingSub("sub_A", "canceled", nextMonth), nowS), true);
  assert.equal(shouldStoreSubscription(existing, incomingSub("sub_A", "active", nextMonth), nowS), true);
});

test("a first subscription is stored", () => {
  assert.equal(shouldStoreSubscription(null, incomingSub("sub_A", "active", nextMonth), nowS), true);
  assert.equal(shouldStoreSubscription(null, incomingSub("sub_A", "canceled", lastMonth), nowS), true);
});

test("an old canceled subscription does not replace an active new one", () => {
  const existing = { subscriptionId: "sub_B", status: "active", currentPeriodEnd: nextMonth };
  assert.equal(shouldStoreSubscription(existing, incomingSub("sub_A", "canceled", lastMonth), nowS), false);
  // still protected during the grace window, and for past_due / trialing
  const inGrace = new Date(nowS.getTime() - 2 * DAY_MS).toISOString();
  for (const status of ["past_due", "trialing"]) {
    const e = { subscriptionId: "sub_B", status, currentPeriodEnd: inGrace };
    assert.equal(shouldStoreSubscription(e, incomingSub("sub_A", "canceled", nextMonth), nowS), false, status);
  }
});

test("a new active subscription replaces an old canceled one", () => {
  const existing = { subscriptionId: "sub_A", status: "canceled", currentPeriodEnd: lastMonth };
  assert.equal(shouldStoreSubscription(existing, incomingSub("sub_B", "active", nextMonth), nowS), true);
  // and an entitled one may replace another entitled one
  const active = { subscriptionId: "sub_A", status: "active", currentPeriodEnd: nextMonth };
  assert.equal(shouldStoreSubscription(active, incomingSub("sub_B", "active", nextMonth), nowS), true);
});

test("when neither is entitled, the incoming one is stored", () => {
  const existing = { subscriptionId: "sub_B", status: "canceled", currentPeriodEnd: lastMonth };
  assert.equal(shouldStoreSubscription(existing, incomingSub("sub_A", "unpaid", lastMonth), nowS), true);
  // an active row whose period ended past the grace is no longer entitled
  const lapsed = { subscriptionId: "sub_B", status: "active", currentPeriodEnd: lastMonth };
  assert.equal(shouldStoreSubscription(lapsed, incomingSub("sub_A", "canceled", lastMonth), nowS), true);
  const noEnd = { subscriptionId: "sub_B", status: "active", currentPeriodEnd: null };
  assert.equal(shouldStoreSubscription(noEnd, incomingSub("sub_A", "canceled", lastMonth), nowS), true);
});

test("normalize carries the first item's price id, null when absent or not a string", () => {
  assert.equal(normalizeSubscription(basilSubscription)?.priceId, "price_1RyearlyPro");
  assert.equal(normalizeSubscription({ ...basilSubscription, items: { data: [] } })?.priceId, null);
  assert.equal(normalizeSubscription({ ...basilSubscription, items: undefined })?.priceId, null);
  assert.equal(
    normalizeSubscription({ ...basilSubscription, items: { data: [{ price: { id: 42 } }] } })?.priceId,
    null,
  );
});

test("live statuses are the paying ones plus unpaid and incomplete", () => {
  assert.deepEqual([...LIVE_STATUSES].sort(), ["active", "incomplete", "past_due", "trialing", "unpaid"]);
});

test("liveSubscriptions keeps live, normalizable entries of a list response", () => {
  const list = {
    object: "list",
    data: [
      basilSubscription,
      { ...basilSubscription, id: "sub_canceled", status: "canceled" },
      { ...basilSubscription, id: "sub_expired", status: "incomplete_expired" },
      { ...basilSubscription, id: "sub_pending", status: "incomplete" },
      { ...basilSubscription, id: undefined },
      "junk",
    ],
    has_more: false,
  };
  assert.deepEqual(liveSubscriptions(list).map((s) => [s.id, s.status]), [
    ["sub_1RbasilA2b3C4d5E", "active"],
    ["sub_pending", "incomplete"],
  ]);
  for (const bad of [null, undefined, {}, { data: "x" }, [], "list"]) {
    assert.deepEqual(liveSubscriptions(bad), [], JSON.stringify(bad));
  }
});

test("stripeErrorFrom keeps type, code and param, never the message", () => {
  const body = {
    error: {
      type: "invalid_request_error",
      code: "resource_missing",
      param: "customer",
      message: "No such customer: 'cus_gone'; a similar object exists in live mode, but a test mode key (rk_test_***abcd) was used",
    },
  };
  const err = stripeErrorFrom("POST", "/v1/checkout/sessions", 400, body);
  assert.ok(err instanceof StripeError);
  assert.ok(err instanceof Error);
  assert.equal(err.status, 400);
  assert.equal(err.type, "invalid_request_error");
  assert.equal(err.code, "resource_missing");
  assert.equal(err.param, "customer");
  assert.equal(err.message, "Stripe POST /v1/checkout/sessions failed: 400 invalid_request_error/resource_missing");
  assert.ok(!err.message.includes("rk_test") && !err.message.includes("No such"));
});

test("stripeErrorFrom handles bodies without a usable error", () => {
  for (const body of [null, "oops", {}, { error: "x" }, { error: { code: 3 } }]) {
    const err = stripeErrorFrom("GET", "/v1/subscriptions/sub_1", 500, body);
    assert.equal(err.code, null, JSON.stringify(body));
    assert.equal(err.type, null);
    assert.equal(err.message, "Stripe GET /v1/subscriptions/sub_1 failed: 500");
  }
});

test("isMissingCustomer: resource_missing on the customer, or with no param", () => {
  const e = (code: unknown, param?: unknown) =>
    stripeErrorFrom("POST", "/v1/checkout/sessions", 400, { error: { type: "invalid_request_error", code, param } });
  assert.equal(isMissingCustomer(e("resource_missing", "customer")), true);
  assert.equal(isMissingCustomer(e("resource_missing")), true);
  assert.equal(isMissingCustomer(e("resource_missing", "line_items[0][price]")), false);
  assert.equal(isMissingCustomer(e("card_declined")), false);
  assert.equal(isMissingCustomer(e(undefined)), false);
  assert.equal(isMissingCustomer(new Error("resource_missing")), false);
  assert.equal(isMissingCustomer(null), false);
});

test("checkout params with Managed Payments on: managed_payments, never tax or customer_update", () => {
  for (const automaticTax of [false, true]) {
    const p = checkoutParams({ ...baseCheckout, customerId: "cus_1", automaticTax, managedPayments: true });
    assert.equal(p.get("managed_payments[enabled]"), "true", `tax ${automaticTax}`);
    assert.equal(p.get("customer"), "cus_1");
    for (const key of p.keys()) {
      assert.ok(!key.startsWith("automatic_tax"), key);
      assert.ok(!key.startsWith("customer_update"), key);
    }
  }
});

test("checkout params with Managed Payments off keep today's tax behaviour", () => {
  const off = checkoutParams({ ...baseCheckout, customerId: "cus_1", automaticTax: true, managedPayments: false });
  assert.equal(off.has("managed_payments[enabled]"), false);
  assert.equal(off.get("automatic_tax[enabled]"), "true");
  assert.equal(off.get("customer_update[address]"), "auto");
  const none = checkoutParams({ ...baseCheckout, customerId: "cus_1" });
  assert.equal(none.has("managed_payments[enabled]"), false);
  assert.equal(none.has("automatic_tax[enabled]"), false);
});

test("checkoutConfigProblem refuses Managed Payments together with automatic tax", () => {
  assert.equal(checkoutConfigProblem({}), null);
  assert.equal(checkoutConfigProblem({ STRIPE_MANAGED_PAYMENTS: "1" }), null);
  assert.equal(checkoutConfigProblem({ STRIPE_AUTOMATIC_TAX: "1" }), null);
  assert.equal(checkoutConfigProblem({ STRIPE_MANAGED_PAYMENTS: "1", STRIPE_AUTOMATIC_TAX: "" }), null);
  assert.match(
    checkoutConfigProblem({ STRIPE_MANAGED_PAYMENTS: "1", STRIPE_AUTOMATIC_TAX: "1" }) ?? "",
    /STRIPE_MANAGED_PAYMENTS and STRIPE_AUTOMATIC_TAX/,
  );
});

test("stripeKeyProblem accepts only restricted keys", () => {
  assert.equal(stripeKeyProblem("rk_test_abc"), null);
  assert.equal(stripeKeyProblem("rk_live_abc"), null);
  assert.equal(stripeKeyProblem("sk_test_abc"), "Use a restricted key (rk_…), not a secret key");
  assert.equal(stripeKeyProblem("sk_live_abc"), "Use a restricted key (rk_…), not a secret key");
  assert.match(stripeKeyProblem("pk_test_abc") ?? "", /must be a restricted key/);
  assert.match(stripeKeyProblem(undefined) ?? "", /STRIPE_SECRET_KEY missing/);
  assert.match(stripeKeyProblem("") ?? "", /STRIPE_SECRET_KEY missing/);
  // the message never echoes the key
  assert.ok(!(stripeKeyProblem("sk_live_secretvalue") ?? "").includes("secretvalue"));
});

test("BillingConfigError carries a fixed code", () => {
  const e = new BillingConfigError("x");
  assert.ok(e instanceof Error);
  assert.equal(e.code, "billing_misconfigured");
  assert.equal(e.message, "x");
});

test("eventSubscription normalizes the object of a customer.subscription.* event only", () => {
  const sub = eventSubscription(subscriptionDeleted);
  assert.equal(sub?.id, "sub_1RbasilA2b3C4d5E");
  assert.equal(sub?.status, "canceled");
  assert.equal(sub?.priceId, "price_1RyearlyPro");
  assert.equal(eventSubscription({ type: "invoice.paid", data: { object: basilSubscription } }), null);
  assert.equal(eventSubscription({ type: "customer.subscription.deleted", data: { object: { id: "sub_x" } } }), null);
  for (const g of garbage) assert.equal(eventSubscription(g), null);
});

test("isPermissionError: 401 and 403 from Stripe only", async () => {
  const { isPermissionError, StripeError } = await import("../src/lib/billing/stripe-shapes.ts");
  const err = (status: number) => new StripeError("POST", "/v1/refunds", status, { type: "invalid_request_error", code: null, param: null });
  assert.equal(isPermissionError(err(403)), true);
  assert.equal(isPermissionError(err(401)), true);
  assert.equal(isPermissionError(err(400)), false);
  assert.equal(isPermissionError(err(500)), false);
  assert.equal(isPermissionError(new Error("network")), false);
});
