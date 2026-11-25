import { test } from "node:test";
import assert from "node:assert/strict";
import {
  billingStatus,
  checkoutGate,
  customerIdempotencyKey,
  isProPrice,
  legacyPriceIds,
  siteOrigin,
  parseInterval,
  parseWebhookEvent,
  planWebhookEvent,
  upgradeInterval,
} from "../src/lib/billing/webhook-plan.ts";
import { isEntitled } from "../src/lib/entitlements.ts";

const HANDLED = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
];

// Stand-in for stripe-shapes' subscriptionIdFromEvent (that module has its own tests).
const subIdOf = (raw: unknown): string | null => {
  const obj = (raw as { data?: { object?: { id?: unknown; subscription?: unknown } } }).data?.object;
  if (typeof obj?.subscription === "string") return obj.subscription;
  return typeof obj?.id === "string" && obj.id.startsWith("sub_") ? obj.id : null;
};

const updated = JSON.stringify({
  id: "evt_1",
  type: "customer.subscription.updated",
  data: { object: { id: "sub_test_1", object: "subscription", customer: "cus_test_1" } },
});

test("parseWebhookEvent keeps id, type and the raw object", () => {
  const evt = parseWebhookEvent(updated);
  assert.ok(evt);
  assert.equal(evt.id, "evt_1");
  assert.equal(evt.type, "customer.subscription.updated");
  assert.deepEqual(evt.raw, JSON.parse(updated));
});

test("parseWebhookEvent rejects bodies that aren't an event", () => {
  for (const body of ["", "not json", "null", "[]", "42", '"evt"', "{}",
    '{"id":"evt_1"}', '{"type":"x"}', '{"id":"","type":"x"}', '{"id":1,"type":"x"}',
    '{"id":"evt_1","type":""}']) {
    assert.equal(parseWebhookEvent(body), null, body);
  }
});

test("planWebhookEvent ignores event types we don't handle", () => {
  const evt = parseWebhookEvent(JSON.stringify({
    id: "evt_2", type: "customer.created", data: { object: { id: "sub_x" } },
  }))!;
  assert.equal(planWebhookEvent(evt, HANDLED, subIdOf), "ignore");
});

test("planWebhookEvent returns the subscription id for a handled event", () => {
  const evt = parseWebhookEvent(updated)!;
  assert.deepEqual(planWebhookEvent(evt, HANDLED, subIdOf), { subscriptionId: "sub_test_1" });
});

test("planWebhookEvent ignores a handled event with no subscription", () => {
  // e.g. a one-off payment Checkout: no subscription attached
  const evt = parseWebhookEvent(JSON.stringify({
    id: "evt_3", type: "checkout.session.completed", data: { object: { id: "cs_1", subscription: null } },
  }))!;
  assert.equal(planWebhookEvent(evt, HANDLED, subIdOf), "ignore");
});

test("planWebhookEvent doesn't look up the subscription for an unhandled type", () => {
  let called = false;
  const evt = parseWebhookEvent(JSON.stringify({ id: "evt_4", type: "charge.refunded" }))!;
  planWebhookEvent(evt, HANDLED, () => { called = true; return "sub_x"; });
  assert.equal(called, false);
});

test("parseInterval accepts only month and year", () => {
  assert.equal(parseInterval("month"), "month");
  assert.equal(parseInterval("year"), "year");
  for (const v of [undefined, null, "", "Year", "week", "monthly", 1, {}, ["year"]]) {
    assert.equal(parseInterval(v), null, String(v));
  }
});

test("upgradeInterval defaults to year", () => {
  assert.equal(upgradeInterval("month"), "month");
  assert.equal(upgradeInterval("year"), "year");
  assert.equal(upgradeInterval(undefined), "year");
  assert.equal(upgradeInterval(null), "year");
  assert.equal(upgradeInterval("weekly"), "year");
});

const row = {
  status: "active",
  interval: "year" as const,
  currentPeriodEnd: "2027-11-25T00:00:00.000Z",
  cancelAtPeriodEnd: false,
};

test("billingStatus: signed out → plan null, no row fields", () => {
  assert.deepEqual(billingStatus({ enabled: true, signedIn: false, row: null, entitled: false }), {
    enabled: true, plan: null, status: null, interval: null, renewsAt: null, cancelAtPeriodEnd: null,
  });
});

test("billingStatus: signed in with an entitled row → pro and the row's fields", () => {
  assert.deepEqual(billingStatus({ enabled: true, signedIn: true, row, entitled: true }), {
    enabled: true,
    plan: "pro",
    status: "active",
    interval: "year",
    renewsAt: "2027-11-25T00:00:00.000Z",
    cancelAtPeriodEnd: false,
  });
});

test("billingStatus: a row that no longer pays → free, fields still shown", () => {
  const ended = { ...row, status: "canceled", cancelAtPeriodEnd: true };
  assert.deepEqual(billingStatus({ enabled: true, signedIn: true, row: ended, entitled: false }), {
    enabled: true,
    plan: "free",
    status: "canceled",
    interval: "year",
    renewsAt: "2027-11-25T00:00:00.000Z",
    cancelAtPeriodEnd: true,
  });
});

test("billingStatus: signed in, no row → free", () => {
  assert.deepEqual(billingStatus({ enabled: true, signedIn: true, row: null, entitled: false }), {
    enabled: true, plan: "free", status: null, interval: null, renewsAt: null, cancelAtPeriodEnd: null,
  });
});

test("billingStatus: billing off → never pro, row fields hidden", () => {
  assert.deepEqual(billingStatus({ enabled: false, signedIn: true, row, entitled: true }), {
    enabled: false, plan: "free", status: null, interval: null, renewsAt: null, cancelAtPeriodEnd: null,
  });
  assert.equal(billingStatus({ enabled: false, signedIn: false, row: null, entitled: false }).plan, null);
});

const prices = { STRIPE_PRICE_MONTHLY: "price_m", STRIPE_PRICE_YEARLY: "price_y" };

test("isProPrice accepts only the configured Pro prices", () => {
  assert.equal(isProPrice("price_m", prices), true);
  assert.equal(isProPrice("price_y", prices), true);
  assert.equal(isProPrice("price_other", prices), false);
  assert.equal(isProPrice(null, prices), false);
  assert.equal(isProPrice("", prices), false);
});

test("isProPrice grants nothing when prices are unset", () => {
  assert.equal(isProPrice("price_y", {}), false);
  assert.equal(isProPrice("price_y", { STRIPE_PRICE_YEARLY: "" }), false);
  // an unset monthly price doesn't make a null or empty price match
  assert.equal(isProPrice(null, { STRIPE_PRICE_YEARLY: "price_y" }), false);
  assert.equal(isProPrice("", { STRIPE_PRICE_MONTHLY: "" }), false);
});

test("siteOrigin defaults to https://aired.sh and drops a trailing slash", () => {
  assert.equal(siteOrigin({}), "https://aired.sh");
  assert.equal(siteOrigin({ SITE_ORIGIN: "" }), "https://aired.sh");
  assert.equal(siteOrigin({ SITE_ORIGIN: "http://localhost:8787/" }), "http://localhost:8787");
});

test("legacyPriceIds splits, trims and drops empty entries", () => {
  assert.deepEqual(legacyPriceIds(undefined), []);
  assert.deepEqual(legacyPriceIds(""), []);
  assert.deepEqual(legacyPriceIds(" , ,"), []);
  assert.deepEqual(legacyPriceIds("price_old"), ["price_old"]);
  assert.deepEqual(legacyPriceIds(" price_old , ,price_older ,"), ["price_old", "price_older"]);
});

test("isProPrice accepts legacy Pro prices listed in STRIPE_LEGACY_PRICE_IDS", () => {
  const env = { ...prices, STRIPE_LEGACY_PRICE_IDS: " price_old , ,price_older" };
  assert.equal(isProPrice("price_old", env), true);
  assert.equal(isProPrice("price_older", env), true);
  assert.equal(isProPrice("price_m", env), true);
  assert.equal(isProPrice("price_other", env), false);
  assert.equal(isProPrice(" price_old ", env), false);
  assert.equal(isProPrice("price_old", prices), false);
  // empty entries never match an empty or missing price
  assert.equal(isProPrice("", { STRIPE_LEGACY_PRICE_IDS: ",," }), false);
  assert.equal(isProPrice(null, { STRIPE_LEGACY_PRICE_IDS: "price_old" }), false);
});

test("customerIdempotencyKey is scoped by site host and uid", () => {
  assert.equal(customerIdempotencyKey("https://aired.sh", 4242), "aired-customer-aired.sh-4242");
  assert.equal(customerIdempotencyKey("http://localhost:8787", 7), "aired-customer-localhost:8787-7");
  assert.notEqual(
    customerIdempotencyKey("https://staging.aired.sh", 7),
    customerIdempotencyKey("https://aired.sh", 7),
  );
});

test("customerIdempotencyKey gives a fresh key when replacing a missing customer", () => {
  assert.equal(
    customerIdempotencyKey("https://aired.sh", 4242, "cus_gone"),
    "aired-customer-aired.sh-4242-cus_gone",
  );
  assert.equal(customerIdempotencyKey("https://aired.sh", 4242, null), "aired-customer-aired.sh-4242");
});

const NOW = new Date("2026-11-25T12:00:00Z");
const DAY = 24 * 3600 * 1000;
const at = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * DAY).toISOString();
const live = (id: string, status: string, periodEndDays: number | null) => ({
  id,
  status,
  currentPeriodEnd: periodEndDays === null ? null : at(periodEndDays),
});
const entitledNow = (s: { status: string; currentPeriodEnd: string | null }) => isEntitled(s, NOW);

test("checkoutGate: no live subscription → go ahead", () => {
  assert.equal(checkoutGate([], entitledNow), null);
});

test("checkoutGate: active or trialing in period → pro, with that subscription", () => {
  for (const status of ["active", "trialing"]) {
    const sub = live("sub_1", status, 30);
    assert.deepEqual(checkoutGate([sub], entitledNow), { kind: "pro", sub }, status);
  }
});

test("checkoutGate: past_due inside the grace period → pro", () => {
  const sub = live("sub_1", "past_due", -1);
  assert.deepEqual(checkoutGate([sub], entitledNow), { kind: "pro", sub });
});

test("checkoutGate: past_due after the grace period → payment_failed", () => {
  const sub = live("sub_1", "past_due", -5);
  assert.deepEqual(checkoutGate([sub], entitledNow), { kind: "payment_failed", sub });
});

test("checkoutGate: unpaid → payment_failed, even inside the period", () => {
  const sub = live("sub_1", "unpaid", 10);
  assert.deepEqual(checkoutGate([sub], entitledNow), { kind: "payment_failed", sub });
});

test("checkoutGate: incomplete → processing", () => {
  assert.deepEqual(checkoutGate([live("sub_1", "incomplete", null)], entitledNow), { kind: "processing" });
});

test("checkoutGate: any other live subscription still blocks (processing)", () => {
  // active but its period ended long ago (stale data): not entitled, still live
  assert.deepEqual(checkoutGate([live("sub_1", "active", -30)], entitledNow), { kind: "processing" });
});

test("checkoutGate: entitled wins over failed, failed over incomplete", () => {
  const paying = live("sub_2", "active", 30);
  const failed = live("sub_3", "unpaid", 10);
  const pending = live("sub_1", "incomplete", null);
  assert.deepEqual(checkoutGate([pending, failed, paying], entitledNow), { kind: "pro", sub: paying });
  assert.deepEqual(checkoutGate([pending, failed], entitledNow), { kind: "payment_failed", sub: failed });
});

test("checkoutGate doesn't look at the price", () => {
  const sub = { ...live("sub_1", "active", 30), priceId: "price_someone_else" };
  assert.deepEqual(checkoutGate([sub], entitledNow), { kind: "pro", sub });
});
