import { test } from "node:test";
import assert from "node:assert/strict";
import {
  billingStatus,
  parseInterval,
  parseWebhookEvent,
  planWebhookEvent,
  upgradeInterval,
} from "../src/lib/billing/webhook-plan.ts";

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
