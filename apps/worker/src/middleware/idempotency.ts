import type { Context, Next } from "hono";
import type { AppBindings } from "../types.js";
import { hashToHex } from "@aired/core";
import { apiError } from "../lib/errors.ts";
import { visitorNetwork } from "../lib/pin-guess.ts";
import { logError } from "../lib/log.js";
import { keyRef, releaseKey, reserveKey, saveAnswer, sha256Hex, validIdempotencyKey, type KeyRef } from "../lib/idempotency.ts";

/**
 * Idempotency-Key for POST /api/publish (lib/idempotency.ts). Runs before
 * the publish rate limit, so a replayed answer doesn't use up a publish.
 * Without the header the request goes through as always.
 */
export async function idempotentPublish(c: Context<AppBindings>, next: Next): Promise<Response | void> {
  const sent = c.req.header("Idempotency-Key");
  if (sent === undefined) return next();
  const key = sent.trim();
  if (!validIdempotencyKey(key)) {
    return apiError(c, 400, "invalid_idempotency_key", "Idempotency-Key must be 1 to 255 printable characters.");
  }

  let body: string;
  try {
    body = await c.req.text();
  } catch (err) {
    // Past the size cap: bodyLimit (middleware/api-contract.ts) answers its 413.
    if (err instanceof Error && err.name === "BodyLimitError") throw err;
    return apiError(c, 400, "invalid_json", "The request body isn't valid JSON.");
  }

  const user = c.get("user");
  const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For") ?? "unknown";
  const scope = user !== null ? `user:${user.id}` : `net:${await hashToHex(visitorNetwork(ip), 16)}`;
  let ref: KeyRef;
  let state: Awaited<ReturnType<typeof reserveKey>>;
  try {
    ref = await keyRef(scope, key);
    state = await reserveKey(c.env.DB, ref, await sha256Hex(body), Date.now());
  } catch (err) {
    logError("idempotency_check_failed", err, {}, c.get("requestId"));
    return apiError(c, 503, "unavailable", "Could not check the Idempotency-Key. Please try again.");
  }

  if (state.state === "mismatch") {
    return apiError(c, 422, "idempotency_key_reused", "This Idempotency-Key was already used with a different request body. Use a new key for a new publish.");
  }
  if (state.state === "pending") {
    c.header("Retry-After", "2");
    return apiError(c, 409, "idempotency_in_progress", "A request with this Idempotency-Key is still running. Retry in a few seconds.");
  }
  if (state.state === "done") {
    return new Response(state.answer.body, {
      status: state.answer.status,
      headers: { "Content-Type": "application/json; charset=UTF-8", "Idempotent-Replayed": "true" },
    });
  }

  try {
    await next();
  } catch (err) {
    await releaseKey(c.env.DB, ref).catch(() => {});
    throw err;
  }
  const res = c.res;
  try {
    if (res.status >= 200 && res.status < 300) {
      await saveAnswer(c.env.DB, ref, { status: res.status, body: await res.clone().text() });
    } else {
      await releaseKey(c.env.DB, ref);
    }
  } catch (err) {
    // The publish went through; only its replay is lost. The reservation
    // is taken over after a minute (lib/idempotency.ts).
    logError("idempotency_save_failed", err, { status: res.status }, c.get("requestId"));
  }
}
