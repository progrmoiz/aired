import type { Context, Next } from "hono";
import type { AppBindings } from "../types.js";
import { hashToHex } from "@aired/core";
import { TIERS, publishTier, type RateLimitTier } from "../lib/rate-limit-tiers.js";
import { underBurstLimit } from "../lib/burst-limit.js";
import { billingEnabled, getEntitlements, planLimitError } from "../lib/entitlements.js";
import { siteOrigin } from "../lib/origin.ts";

type RateLimitOptions = {
  /**
   * Called when the window limit is hit. Return a Response to send instead of
   * the default 429, or undefined to keep the 429.
   */
  onLimited?: (c: Context<AppBindings>) => Response | undefined;
};

/**
 * In-memory rate limit store.
 * Resets on worker cold start — that's fine for a low-traffic service.
 * Keys are `${tier.bucketPrefix}:${bucketSubKey}`.
 */
const store = new Map<string, { count: number; resetAt: number }>();

/**
 * Periodically prune expired entries to prevent memory growth.
 * Runs at most once per minute.
 */
let lastPrune = 0;
function maybePrune() {
  const now = Date.now();
  if (now - lastPrune < 60_000) return;
  lastPrune = now;
  for (const [key, entry] of store) {
    if (now >= entry.resetAt) store.delete(key);
  }
}

/**
 * Check and update the rate limit for a bucket key.
 */
function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: limit - 1 };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: limit - entry.count };
}

/**
 * Factory: create a Hono middleware that applies the given rate-limit tier.
 *
 * Bucket key strategy:
 *   - rl:ip  → hashed IP (anonymous)
 *   - rl:user, rl:pro, rl:claim, rl:delete → user.id (requires authMiddleware to run first)
 *
 * Fallback: when a user tier is requested but user is null (unauthenticated),
 * fall back to anonymous IP-based limiting using the tier's own limit/window.
 * This keeps the fallback simple — the anonymous bucket may already be tighter.
 */
export function rateLimit(
  tier: RateLimitTier,
  options: RateLimitOptions = {},
): (c: Context<AppBindings>, next: Next) => Promise<Response | void> {
  return async (c: Context<AppBindings>, next: Next): Promise<Response | void> => {
    const ip =
      c.req.header("CF-Connecting-IP") ??
      c.req.header("X-Forwarded-For") ??
      "unknown";

    let bucketSubKey: string;

    if (tier.bucketPrefix === "rl:ip") {
      bucketSubKey = await hashToHex(ip, 16);
    } else {
      // User-keyed tiers (rl:user, rl:pro, rl:claim, rl:delete)
      const user = c.get("user");
      if (user !== null && user !== undefined) {
        bucketSubKey = String(user.id);
      } else {
        // Fall back to anonymous IP bucket with same tier limits
        bucketSubKey = await hashToHex(ip, 16);
      }
    }

    const key = `${tier.bucketPrefix}:${bucketSubKey}`;

    // Per-minute flood guard for anonymous traffic, counted by Cloudflare
    // rather than per isolate.
    if (tier.burst !== undefined && !c.get("user")) {
      if (!(await underBurstLimit(c.env[tier.burst], key))) {
        return c.json(
          { error: "Too many requests. Please wait a minute and try again." },
          429,
        );
      }
    }

    const { allowed } = checkRateLimit(key, tier.limit, tier.windowSeconds);

    maybePrune();

    if (!allowed) {
      const custom = options.onLimited?.(c);
      if (custom !== undefined) return custom;
      return c.json(
        { error: "Rate limit exceeded. Please try again later." },
        429,
      );
    }

    await next();
  };
}

const publishLimits = {
  anonymous: rateLimit(TIERS.anonymous),
  // Only signed-in free users land here (publishTier). With billing on, their
  // limit is a plan limit, so they get the 402 upgrade prompt instead of a 429.
  authenticated: rateLimit(TIERS.authenticated, {
    onLimited: (c) =>
      c.get("user") && billingEnabled(c.env)
        ? c.json(planLimitError("publish_rate", siteOrigin(c.env)), 402)
        : undefined,
  }),
  pro: rateLimit(TIERS.pro),
};

/** Publish limit: per account when signed in (by plan), per IP otherwise. */
export async function publishRateLimit(
  c: Context<AppBindings>,
  next: Next,
): Promise<Response | void> {
  const user = c.get("user");
  const ent = user ? await getEntitlements(c.env, user.id) : null;
  const tier = publishTier(user, ent);
  const limiter =
    tier === TIERS.pro ? publishLimits.pro
    : tier === TIERS.authenticated ? publishLimits.authenticated
    : publishLimits.anonymous;
  return limiter(c, next);
}

/**
 * @deprecated Use rateLimit(tier) factory instead.
 * Kept for backward-compatibility during migration.
 */
export async function rateLimitMiddleware(
  c: Context<AppBindings>,
  next: Next,
): Promise<Response | void> {
  const ip =
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For") ??
    "unknown";

  const ipHash = await hashToHex(ip, 16);
  const { allowed } = checkRateLimit(`rl:ip:${ipHash}`, 5, 3600);

  maybePrune();

  if (!allowed) {
    return c.json(
      { error: "Rate limit exceeded. Maximum 5 uploads per hour." },
      429,
    );
  }

  await next();
}
