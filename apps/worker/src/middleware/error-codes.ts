import type { Context, Next } from "hono";
import { legacyErrorClient, toFlat, toNested, withCode } from "../lib/errors.ts";

/** A JSON error response's body, or undefined for anything else. */
async function errorJson(c: Context): Promise<unknown> {
  const res = c.res;
  if (res.status < 400 || !(res.headers.get("Content-Type") ?? "").includes("application/json")) return undefined;
  try {
    return await res.clone().json();
  } catch {
    return undefined;
  }
}

function replaceBody(c: Context, body: unknown): void {
  const res = c.res;
  const headers = new Headers(res.headers);
  headers.delete("Content-Length");
  // Cleared first so Hono doesn't copy the old headers (Content-Length) back on.
  c.res = undefined;
  c.res = new Response(JSON.stringify(body), { status: res.status, statusText: res.statusText, headers });
}

/**
 * Every JSON error under /api in one shape (lib/errors.ts), after the route
 * has run: `{ error: { code, message, ...extra } }`, or the flat
 * `{ error, code, ...extra }` for CLI and stdio MCP builds up to 1.10.0.
 * Routes that answer with apiError() are already nested; older call sites
 * that send `{ error: "..." }` get their code from the status. Everything
 * else passes through untouched.
 */
export async function apiErrorShape(c: Context, next: Next): Promise<void> {
  await next();
  const body = await errorJson(c);
  if (body === undefined) return;
  const nested = toNested(body, c.res.status);
  if (nested === null) return;
  const out = legacyErrorClient(c.req.header("User-Agent")) ? toFlat(nested) : nested;
  if (out !== body) replaceBody(c, out);
}

/**
 * /auth's errors stay flat, `{ error, code }`, since the device flow and the
 * CLI's sign-in read `error` as a code (RFC 8628). This adds the `code` to
 * those that lack one, from the status.
 */
export async function withErrorCodes(c: Context, next: Next): Promise<void> {
  await next();
  const body = await errorJson(c);
  if (body === undefined) return;
  const coded = withCode(body, c.res.status);
  if (coded !== null) replaceBody(c, coded);
}
