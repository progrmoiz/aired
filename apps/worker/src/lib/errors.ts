/**
 * The API's error shape. Every JSON error under /api is
 *
 *   { "error": { "code": "<snake_case>", "message": "<a sentence>", ...extra } }
 *
 * with the right HTTP status. `code` is stable, for programs to branch on;
 * `message` is for people. Extra fields sit inside the error object
 * (`field` on invalid_input, `limit` and `upgrade_url` on plan_limit).
 *
 * The older flat shape, `{ error: "<message>", code, ...extra }`, is what
 * /auth and /oauth still answer (OAuth and the device flow put a code in
 * `error`, RFC 6749 and RFC 8628), and what aired CLI and stdio MCP builds up
 * to 1.10.0 get from /api too: they read `error` as a string
 * (legacyErrorClient). middleware/api-contract.ts turns every /api error
 * into the right one of the two, whichever way the route wrote it.
 *
 * The codes are listed in apps/web/docs.html and lib/openapi.ts.
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

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export type ErrorObject = { code: string; message: string } & Obj;
export type ErrorBody = { error: ErrorObject };

/** The /api error body: `{ error: { code, message, ...extra } }`. */
export function errorBody(code: string, message: string, extra: Obj = {}): ErrorBody {
  return { error: { code, message, ...extra } };
}

/** The flat error body /auth answers and older clients read: `{ error: message, code, ...extra }`. */
export function flatErrorBody(code: string, message: string, extra: Obj = {}): Obj {
  return { error: message, code, ...extra };
}

/**
 * Any error body as `{ error: { code, message, ...extra } }`: a flat one's
 * other fields move inside the error object, and one with no `code` gets
 * its `error` when that's already a code (`authorization_pending`), else the
 * status's code. Bodies that aren't errors come back as null.
 */
export function toNested(body: unknown, status: number): ErrorBody | null {
  if (!isObj(body)) return null;
  const { error, ...rest } = body;
  if (isObj(error) && typeof error.code === "string" && typeof error.message === "string") return body as ErrorBody;
  if (typeof error !== "string") return null;
  const { code, ...extra } = rest;
  const resolved = typeof code === "string" ? code : CODE_LIKE.test(error) ? error : codeForStatus(status);
  return errorBody(resolved, error, extra);
}

/** A nested error body as the flat one. */
export function toFlat(body: ErrorBody): Obj {
  const { code, message, ...extra } = body.error;
  return flatErrorBody(code, message, extra);
}

/**
 * `body` with a `code` if it's a flat error body that lacks one (the /auth
 * routes): the `error` itself when it's already a code, else the status's
 * code. Anything else comes back as null, unchanged.
 */
export function withCode(body: unknown, status: number): Obj | null {
  if (!isObj(body) || typeof body.error !== "string" || "code" in body) return null;
  return { ...body, code: CODE_LIKE.test(body.error) ? body.error : codeForStatus(status) };
}

/** The last CLI and stdio MCP release that reads only a string `error`. */
const LAST_FLAT_READER = [1, 10, 0] as const;
const AIRED_CLIENT = /^aired(?:-mcp)?\/(\d+)\.(\d+)\.(\d+)/;

/**
 * True for the aired CLI (`aired/1.4.0`) and stdio MCP (`aired-mcp/1.4.0`)
 * up to 1.10.0, which show `error` only when it's a string and otherwise fall
 * back to "Publish failed (400)". They keep getting the flat shape. Builds
 * after 1.10.0 read both; the in-process MCP (`aired-mcp`, no version),
 * browsers and everyone else get the nested shape.
 */
export function legacyErrorClient(userAgent: string | undefined): boolean {
  const m = AIRED_CLIENT.exec(userAgent ?? "");
  if (m === null) return false;
  const v = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (let i = 0; i < 3; i++) {
    if (v[i]! !== LAST_FLAT_READER[i]) return v[i]! < LAST_FLAT_READER[i]!;
  }
  return true;
}

const underApi = (c: Context): boolean => {
  const path = new URL(c.req.url).pathname;
  return path === "/api" || path.startsWith("/api/");
};

/**
 * A JSON error response: nested under /api, flat elsewhere (/auth, /oauth,
 * the viewer's and data layer's routes). The /api middleware flattens it
 * again for older clients.
 */
export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  extra: Obj = {},
): Response {
  return c.json(underApi(c) ? errorBody(code, message, extra) : flatErrorBody(code, message, extra), status);
}
