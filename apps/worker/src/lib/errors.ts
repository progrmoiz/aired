/**
 * The API's error shape: `{ error, code }` and sometimes more fields
 * (`limit` and `upgrade_url` on a plan limit). `error` is a sentence for
 * people and stays as it was; `code` is a stable snake_case string for
 * programs to branch on. Clients from before `code` keep reading `error`.
 *
 * Routes answer with apiError(). Older call sites that still send only
 * `{ error }` get a code from their status (withErrorCodes in
 * middleware/error-codes.ts), so every JSON error under /api and /auth has
 * one. The codes are listed in apps/web/docs.html.
 *
 * Only type imports, so tests load it directly.
 */
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** The code an error gets from its status alone. */
const STATUS_CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  402: "plan_limit",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  410: "gone",
  413: "payload_too_large",
  415: "unsupported_media_type",
  422: "unprocessable",
  429: "rate_limited",
  500: "internal_error",
  502: "bad_gateway",
  503: "unavailable",
};

export function codeForStatus(status: number): string {
  return STATUS_CODES[status] ?? (status >= 500 ? "internal_error" : "bad_request");
}

/** OAuth and device-flow answers already put a code in `error` (RFC 6749, RFC 8628). */
const CODE_LIKE = /^[a-z][a-z0-9_]*$/;

/**
 * `body` with a `code` if it's an error body that lacks one: the `error`
 * itself when it's already a code (`authorization_pending`), else the
 * status's code. Anything else comes back as it was, unchanged (null).
 */
export function withCode(body: unknown, status: number): Record<string, unknown> | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.error !== "string" || "code" in b) return null;
  return { ...b, code: CODE_LIKE.test(b.error) ? b.error : codeForStatus(status) };
}

export function errorBody(code: string, message: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { error: message, code, ...extra };
}

/** A JSON error response: `{ error: message, code, ...extra }`. */
export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return c.json(errorBody(code, message, extra), status);
}
