import type { Env } from '../../types.js';
import { GRACE_MS, isEntitled } from '../entitlements.js';
import { shouldStoreSubscription, type NormalizedSubscription } from './stripe-shapes.js';

/**
 * Billing state in D1 (source of truth) plus the KV projection `ent:<uid>`
 * that the hot paths read through getEntitlements.
 */

export type StoredSubscription = {
  userId: number;
  provider: string;
  customerId: string;
  subscriptionId: string | null;
  plan: string;
  status: string;
  interval: 'month' | 'year' | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  updatedAt: string;
};

type SubscriptionRow = {
  user_id: number;
  provider: string;
  customer_id: string;
  subscription_id: string | null;
  plan: string;
  status: string;
  interval: string | null;
  current_period_end: string | null;
  cancel_at_period_end: number;
  updated_at: string;
};

const DAY_SEC = 24 * 3600;

/**
 * Make sure a users row exists for this id. GitHub users have no row until
 * they sign in after Phase 3, and subscriptions.user_id is a foreign key.
 */
export async function ensureUser(
  db: D1Database,
  user: { id: number; login: string; email: string | null; name: string | null },
): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO users (id, email, name, login, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(user.id, user.email, user.name, user.login, new Date().toISOString())
    .run();
}

/** Whether a webhook event id was already handled. */
export async function hasEvent(db: D1Database, id: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS seen FROM billing_events WHERE event_id = ?')
    .bind(id)
    .first<{ seen: number }>();
  return row !== null;
}

/**
 * Record a webhook event id once it has been handled. Returns false when it was
 * already recorded (a duplicate delivery handled concurrently).
 */
export async function recordEvent(db: D1Database, id: string, type: string): Promise<boolean> {
  const res = await db
    .prepare('INSERT OR IGNORE INTO billing_events (event_id, type, received_at) VALUES (?, ?, ?)')
    .bind(id, type, new Date().toISOString())
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** The user's Stripe customer id, saved before their first Checkout. */
export async function getCustomerId(db: D1Database, uid: number): Promise<string | null> {
  const row = await db
    .prepare('SELECT customer_id FROM billing_customers WHERE user_id = ?')
    .bind(uid)
    .first<{ customer_id: string }>();
  return row ? row.customer_id : null;
}

/**
 * Save the user's Stripe customer id. Keeps an existing row (first writer
 * wins), so callers should read it back with getCustomerId.
 */
export async function saveCustomerId(db: D1Database, uid: number, customerId: string): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO billing_customers (user_id, customer_id, created_at) VALUES (?, ?, ?)')
    .bind(uid, customerId, new Date().toISOString())
    .run();
}

export async function getSubscription(db: D1Database, uid: number): Promise<StoredSubscription | null> {
  const row = await db
    .prepare('SELECT * FROM subscriptions WHERE user_id = ?')
    .bind(uid)
    .first<SubscriptionRow>();
  return row ? fromRow(row) : null;
}

export async function findUidByCustomer(db: D1Database, customerId: string): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT user_id FROM subscriptions WHERE customer_id = ?1
       UNION ALL
       SELECT user_id FROM billing_customers WHERE customer_id = ?1
       LIMIT 1`,
    )
    .bind(customerId)
    .first<{ user_id: number }>();
  return row ? row.user_id : null;
}

/**
 * Store a subscription's current state for a user, then project it to KV:
 * `ent:<uid>` while entitled (expiring a day after the grace period ends),
 * deleted otherwise. Needs a users row for uid (see ensureUser).
 * Does nothing when the event is about an older subscription and the stored
 * one still pays (see shouldStoreSubscription).
 */
export async function syncSubscription(
  env: Pick<Env, 'DB' | 'PAGES_KV'>,
  uid: number,
  sub: NormalizedSubscription,
): Promise<void> {
  const now = new Date();
  const existing = await getSubscription(env.DB, uid);
  if (!shouldStoreSubscription(existing, sub, now)) return;

  await env.DB
    .prepare(
      `INSERT INTO subscriptions
         (user_id, provider, customer_id, subscription_id, plan, status, interval,
          current_period_end, cancel_at_period_end, updated_at)
       VALUES (?, 'stripe', ?, ?, 'pro', ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         provider = excluded.provider,
         customer_id = excluded.customer_id,
         subscription_id = excluded.subscription_id,
         plan = excluded.plan,
         status = excluded.status,
         interval = excluded.interval,
         current_period_end = excluded.current_period_end,
         cancel_at_period_end = excluded.cancel_at_period_end,
         updated_at = excluded.updated_at`,
    )
    .bind(
      uid,
      sub.customerId,
      sub.id,
      sub.status,
      sub.interval,
      sub.currentPeriodEnd,
      sub.cancelAtPeriodEnd ? 1 : 0,
      now.toISOString(),
    )
    .run();

  const key = `ent:${uid}`;
  if (sub.currentPeriodEnd && isEntitled(sub, now)) {
    const periodEndSec = Math.floor(Date.parse(sub.currentPeriodEnd) / 1000);
    const value = { plan: 'pro', status: sub.status, currentPeriodEnd: sub.currentPeriodEnd };
    await env.PAGES_KV.put(key, JSON.stringify(value), {
      expiration: periodEndSec + GRACE_MS / 1000 + DAY_SEC,
    });
  } else {
    await env.PAGES_KV.delete(key);
  }
}

function fromRow(r: SubscriptionRow): StoredSubscription {
  return {
    userId: r.user_id,
    provider: r.provider,
    customerId: r.customer_id,
    subscriptionId: r.subscription_id,
    plan: r.plan,
    status: r.status,
    interval: r.interval === 'month' || r.interval === 'year' ? r.interval : null,
    currentPeriodEnd: r.current_period_end,
    cancelAtPeriodEnd: r.cancel_at_period_end === 1,
    updatedAt: r.updated_at,
  };
}
