import type { Context } from "hono";
import type { AppBindings } from "../types.js";
import { RATE_LIMIT, RATE_LIMIT_WINDOW } from "@aired/core";

/**
 * In-memory rate limit store.
 * Resets on worker cold start — that's fine for a low-traffic service.
 * Uses zero KV writes (the old approach burned through the free-tier daily limit).
 */
const store = new Map<string, { count: number; resetAt: number }>();

/**
 * Hash an IP address using SHA-256 so we don't store raw IPs.
 */
async function hashIp(ip: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/**
 * Check rate limit for the given IP.
 */
function checkRateLimit(ipHash: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = store.get(ipHash);

  // Expired or no entry — start fresh
  if (!entry || now >= entry.resetAt) {
    store.set(ipHash, { count: 1, resetAt: now + RATE_LIMIT_WINDOW * 1000 });
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }

  if (entry.count >= RATE_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT - entry.count };
}

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
 * Hono middleware: apply rate limiting based on CF-Connecting-IP.
 */
export async function rateLimitMiddleware(
  c: Context<AppBindings>,
  next: () => Promise<void>,
): Promise<Response | void> {
  const ip =
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For") ??
    "unknown";

  const ipHash = await hashIp(ip);
  const { allowed } = checkRateLimit(ipHash);

  maybePrune();

  if (!allowed) {
    return c.json(
      { error: "Rate limit exceeded. Maximum 5 uploads per hour." },
      429,
    );
  }

  await next();
}
