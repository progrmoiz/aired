import type { Context, Next } from "hono";
import type { AppBindings } from "../types.js";
import { requestIdFrom } from "../lib/log.js";

/**
 * Gives every request an id (lib/log.ts requestIdFrom), stores it as
 * c.get("requestId") for log lines, and returns it in X-Request-Id so a
 * user reporting a problem can quote it. Runs first, before CORS and auth.
 */
export async function requestIdMiddleware(c: Context<AppBindings>, next: Next): Promise<void> {
  const id = requestIdFrom(c.req.raw.headers);
  c.set("requestId", id);
  await next();
  // A 101 (WebSocket) response can't carry new headers, and a response
  // passed through from fetch() has immutable ones; skip rather than fail.
  if (c.res.status === 101) return;
  try {
    c.res.headers.set("X-Request-Id", id);
  } catch {
    // Immutable headers: leave the response as it is.
  }
}
