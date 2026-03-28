import type { Context } from "hono";
import type { AppBindings } from "../types.js";
import { RATE_LIMIT, RATE_LIMIT_WINDOW } from "@aired/core";

/**
 * Hash an IP address using SHA-256 so we don't store raw IPs in KV.
 */
async function hashIp(ip: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16); // 16 hex chars is enough for a KV key prefix
}

/**
 * Check rate limit for the given IP.
 * Returns true if the request is allowed, false if rate limited.
 * Increments the counter on allowed requests.
 */
export async function checkRateLimit(
  kv: KVNamespace,
  ip: string,
): Promise<{ allowed: boolean; remaining: number }> {
  const ipHash = await hashIp(ip);
  const key = `rate:${ipHash}`;

  const raw = await kv.get(key);
  const count = raw !== null ? parseInt(raw, 10) : 0;

  if (count >= RATE_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  // Increment — use expirationTtl so the window resets after 1 hour
  await kv.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW });

  return { allowed: true, remaining: RATE_LIMIT - (count + 1) };
}

/**
 * Hono middleware: apply rate limiting based on CF-Connecting-IP.
 * Returns 429 if the IP has exceeded the upload limit.
 */
export async function rateLimitMiddleware(
  c: Context<AppBindings>,
  next: () => Promise<void>,
): Promise<Response | void> {
  const ip =
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For") ??
    "unknown";

  const { allowed } = await checkRateLimit(c.env.PAGES_KV, ip);

  if (!allowed) {
    return c.json(
      { error: "Rate limit exceeded. Maximum 5 uploads per hour." },
      429,
    );
  }

  await next();
}
