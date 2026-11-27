import type { Context, Next } from "hono";
import { withCode } from "../lib/errors.ts";

/**
 * Every JSON error under /api and /auth carries a `code` (lib/errors.ts).
 * Routes that answer with apiError() already have one; this adds it to the
 * rest, from the status, after the route has run. Only JSON 4xx/5xx bodies
 * with a string `error` and no `code` are rewritten; everything else passes
 * through untouched.
 */
export async function withErrorCodes(c: Context, next: Next): Promise<void> {
  await next();
  const res = c.res;
  if (res.status < 400 || !(res.headers.get("Content-Type") ?? "").includes("application/json")) return;
  let body: unknown;
  try {
    body = await res.clone().json();
  } catch {
    return;
  }
  const coded = withCode(body, res.status);
  if (coded === null) return;
  const headers = new Headers(res.headers);
  headers.delete("Content-Length");
  // Cleared first so Hono doesn't copy the old headers (Content-Length) back on.
  c.res = undefined;
  c.res = new Response(JSON.stringify(coded), { status: res.status, statusText: res.statusText, headers });
}
