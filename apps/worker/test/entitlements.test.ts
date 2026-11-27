import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FREE_MAX_BYTES,
  PRO_MAX_BYTES,
  GRACE_MS,
  billingEnabled,
  entitlementsFor,
  getEntitlements,
  isEntitled,
  planLimitError,
  upgradeUrl,
} from "../src/lib/entitlements.ts";
import { COLLECT_LIMITS } from "../src/lib/collect-limits.ts";
import { ACCESS_LIMITS } from "../src/lib/access-limits.ts";

const now = new Date("2026-06-15T12:00:00Z");
const future = "2026-07-15T12:00:00Z";
const DAY = 24 * 3600 * 1000;

test("no subscription gets the free limits", () => {
  assert.deepEqual(entitlementsFor(null, now), {
    plan: "free",
    badge: true,
    maxBytes: 2 * 1024 * 1024,
    publishTier: "authenticated",
    collect: COLLECT_LIMITS.free,
    access: ACCESS_LIMITS.free,
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
      collect: COLLECT_LIMITS.pro,
      access: ACCESS_LIMITS.pro,
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
  assert.deepEqual(planLimitError("page_size", "https://aired.sh"), {
    error: "This needs Pro",
    code: "plan_limit",
    limit: "page_size",
    upgrade_url: "https://aired.sh/pricing?ref=api",
  });
  assert.equal(planLimitError("publish_rate", "https://aired.sh", "mcp").upgrade_url, "https://aired.sh/pricing?ref=mcp");
  assert.equal(planLimitError("publish_rate", "https://aired.sh", "mcp").limit, "publish_rate");
  assert.equal(planLimitError("page_size", "http://localhost:8787").upgrade_url, "http://localhost:8787/pricing?ref=api");
  assert.equal(upgradeUrl("https://aired.sh", "publish"), "https://aired.sh/pricing?ref=publish");
});

test("billing is on only when BILLING_ENABLED is exactly 1", () => {
  assert.equal(billingEnabled({ BILLING_ENABLED: "1" }), true);
  assert.equal(billingEnabled({}), false);
  assert.equal(billingEnabled({ BILLING_ENABLED: "0" }), false);
  assert.equal(billingEnabled({ BILLING_ENABLED: "true" }), false);
});

// A stand-in for PAGES_KV that records every read.
function fakeKv(store: Record<string, unknown>, opts: { throws?: boolean } = {}) {
  const calls: { key: string; options: unknown }[] = [];
  return {
    calls,
    async get(key: string, options: { type: "json"; cacheTtl?: number }): Promise<unknown> {
      calls.push({ key, options });
      if (opts.throws) throw new SyntaxError("Unexpected token");
      return key in store ? store[key] : null;
    },
  };
}

const FREE = { plan: "free", badge: true, maxBytes: FREE_MAX_BYTES, publishTier: "authenticated", collect: COLLECT_LIMITS.free, access: ACCESS_LIMITS.free };
const PRO = { plan: "pro", badge: false, maxBytes: PRO_MAX_BYTES, publishTier: "pro", collect: COLLECT_LIMITS.pro, access: ACCESS_LIMITS.pro };
const farFuture = new Date(Date.now() + 30 * DAY).toISOString();

test("getEntitlements reads ent:<uid> as JSON with a 5-minute cache", async () => {
  const kv = fakeKv({ "ent:583231": { plan: "pro", status: "active", currentPeriodEnd: farFuture } });
  assert.deepEqual(await getEntitlements({ BILLING_ENABLED: "1", PAGES_KV: kv }, 583231), PRO);
  assert.deepEqual(kv.calls, [{ key: "ent:583231", options: { type: "json", cacheTtl: 300 } }]);
});

test("getEntitlements is free when signed out, billing is off, or there is no record", async () => {
  const record = { "ent:1": { plan: "pro", status: "active", currentPeriodEnd: farFuture } };
  const off = fakeKv(record);
  assert.deepEqual(await getEntitlements({ PAGES_KV: off }, 1), FREE);
  assert.deepEqual(await getEntitlements({ BILLING_ENABLED: "0", PAGES_KV: off }, 1), FREE);
  assert.equal(off.calls.length, 0, "billing off never touches KV");

  const on = fakeKv(record);
  assert.deepEqual(await getEntitlements({ BILLING_ENABLED: "1", PAGES_KV: on }, null), FREE);
  assert.equal(on.calls.length, 0, "signed out never touches KV");
  assert.deepEqual(await getEntitlements({ BILLING_ENABLED: "1", PAGES_KV: on }, 2), FREE);
});

test("getEntitlements is free for a lapsed or unreadable record", async () => {
  const lapsed = new Date(Date.now() - GRACE_MS - DAY).toISOString();
  const kv = fakeKv({
    "ent:1": { plan: "pro", status: "active", currentPeriodEnd: lapsed },
    "ent:2": { plan: "pro", status: "canceled", currentPeriodEnd: farFuture },
    "ent:3": "not an object",
    "ent:4": { plan: "pro", status: 1, currentPeriodEnd: farFuture },
    "ent:5": { plan: "pro", status: "active" },
    "ent:6": [1, 2],
  });
  const env = { BILLING_ENABLED: "1", PAGES_KV: kv };
  for (const uid of [1, 2, 3, 4, 5, 6]) {
    assert.deepEqual(await getEntitlements(env, uid), FREE, `uid ${uid}`);
  }
  const broken = fakeKv({}, { throws: true });
  assert.deepEqual(await getEntitlements({ BILLING_ENABLED: "1", PAGES_KV: broken }, 1), FREE);
});
