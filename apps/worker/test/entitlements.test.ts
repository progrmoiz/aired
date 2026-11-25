import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FREE_MAX_BYTES,
  PRO_MAX_BYTES,
  GRACE_MS,
  UPGRADE_URL,
  billingEnabled,
  entitlementsFor,
  isEntitled,
  planLimitError,
} from "../src/lib/entitlements.ts";

const now = new Date("2026-06-15T12:00:00Z");
const future = "2026-07-15T12:00:00Z";
const DAY = 24 * 3600 * 1000;

test("no subscription gets the free limits", () => {
  assert.deepEqual(entitlementsFor(null, now), {
    plan: "free",
    badge: true,
    maxBytes: 2 * 1024 * 1024,
    publishTier: "authenticated",
  });
  assert.equal(FREE_MAX_BYTES, 2 * 1024 * 1024);
  assert.equal(PRO_MAX_BYTES, 10 * 1024 * 1024);
  assert.equal(GRACE_MS, 3 * DAY);
});

test("active, trialing and past_due subscriptions get Pro", () => {
  for (const status of ["active", "trialing", "past_due"]) {
    assert.deepEqual(entitlementsFor({ status, currentPeriodEnd: future }, now), {
      plan: "pro",
      badge: false,
      maxBytes: 10 * 1024 * 1024,
      publishTier: "pro",
    }, status);
    assert.equal(isEntitled({ status, currentPeriodEnd: future }, now), true, status);
  }
});

test("ended or unpaid subscriptions fall back to free", () => {
  for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused", ""]) {
    assert.equal(isEntitled({ status, currentPeriodEnd: future }, now), false, status);
    assert.equal(entitlementsFor({ status, currentPeriodEnd: future }, now).plan, "free", status);
  }
});

test("a missing or bad period end is not entitled", () => {
  assert.equal(isEntitled({ status: "active", currentPeriodEnd: null }, now), false);
  assert.equal(isEntitled({ status: "active", currentPeriodEnd: "not a date" }, now), false);
  assert.equal(isEntitled(null, now), false);
});

test("Pro lasts three days past the period end, then stops", () => {
  const end = new Date(now.getTime() - 2 * DAY).toISOString();
  assert.equal(isEntitled({ status: "past_due", currentPeriodEnd: end }, now), true);
  const justInside = new Date(now.getTime() - GRACE_MS + 1).toISOString();
  assert.equal(isEntitled({ status: "active", currentPeriodEnd: justInside }, now), true);
  const atEdge = new Date(now.getTime() - GRACE_MS).toISOString();
  assert.equal(isEntitled({ status: "active", currentPeriodEnd: atEdge }, now), false);
  const longAgo = new Date(now.getTime() - 4 * DAY).toISOString();
  assert.equal(isEntitled({ status: "active", currentPeriodEnd: longAgo }, now), false);
  assert.equal(entitlementsFor({ status: "active", currentPeriodEnd: longAgo }, now).badge, true);
});

test("plan limit errors carry the upgrade link", () => {
  assert.deepEqual(planLimitError("page_size"), {
    error: "This needs Pro",
    code: "plan_limit",
    limit: "page_size",
    upgrade_url: "https://aired.sh/pricing?ref=api",
  });
  assert.equal(planLimitError("publish_rate", "mcp").upgrade_url, `${UPGRADE_URL}?ref=mcp`);
  assert.equal(planLimitError("publish_rate", "mcp").limit, "publish_rate");
});

test("billing is on only when BILLING_ENABLED is exactly 1", () => {
  assert.equal(billingEnabled({ BILLING_ENABLED: "1" }), true);
  assert.equal(billingEnabled({}), false);
  assert.equal(billingEnabled({ BILLING_ENABLED: "0" }), false);
  assert.equal(billingEnabled({ BILLING_ENABLED: "true" }), false);
});
