/**
 * Structured logs. Each call writes one object with `level`, `event` and,
 * when known, `requestId`; Workers Logs (wrangler.toml [observability])
 * stores objects as JSON with every field queryable, so filter by `event`
 * or `requestId` in the dashboard instead of grepping prose.
 *
 * Event names are snake_case, `<area>_<what happened>`. An event that should
 * page someone ends in `_failed` and is listed in ALERT_EVENTS below, which
 * docs/observability.md mirrors.
 *
 * No imports, so tests load it directly under node --experimental-strip-types.
 */

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;
export type LogEntry = LogFields & { level: LogLevel; event: string; requestId?: string };

/**
 * Events that mean money, data or the service is at risk. Set a Workers
 * Logs alert (or a Cloudflare notification) on each; see docs/observability.md.
 */
export const ALERT_EVENTS = [
  // Stripe webhook threw: Stripe retries, but a plan change may be stuck.
  "billing_webhook_failed",
  // An error reached the global error handler (the caller got a 500).
  "unhandled_error",
  // The cron run threw before finishing the expired-page sweep.
  "scheduled_failed",
  // GET /health found KV, D1 or R2 failing.
  "health_check_failed",
] as const;

type Sink = Pick<Console, "log" | "warn" | "error">;
let sink: Sink = console;

/** Tests swap the console for a recorder. Returns the previous sink. */
export function setLogSink(next: Sink): Sink {
  const prev = sink;
  sink = next;
  return prev;
}

export function log(level: LogLevel, event: string, fields: LogFields = {}, requestId?: string | null): LogEntry {
  // level and event go last so a stray field can't relabel the entry.
  const entry: LogEntry = { ...fields, ...(requestId ? { requestId } : {}), level, event };
  if (level === "error") sink.error(entry);
  else if (level === "warn") sink.warn(entry);
  else sink.log(entry);
  return entry;
}

/** The parts of a thrown value worth keeping in a log line. */
export function errorFields(err: unknown): { error: string; errorName?: string; stack?: string } {
  if (err instanceof Error) {
    return { error: err.message, errorName: err.name, ...(err.stack ? { stack: err.stack } : {}) };
  }
  return { error: String(err) };
}

/** Log a caught error with its message, name and stack. */
export function logError(event: string, err: unknown, fields: LogFields = {}, requestId?: string | null): LogEntry {
  return log("error", event, { ...fields, ...errorFields(err) }, requestId);
}

const RAY = /^[0-9a-f]{16}(-[A-Z]{3})?$/i;

/**
 * The request id: Cloudflare's Ray ID when present (Cloudflare sets cf-ray
 * on every request it proxies and replaces any value the client sent), so
 * the id in our logs matches the one in Cloudflare's own tools. Local dev
 * and tests have no cf-ray and get a random UUID.
 */
export function requestIdFrom(headers: Headers, random: () => string = () => crypto.randomUUID()): string {
  const ray = headers.get("cf-ray");
  return ray !== null && RAY.test(ray) ? ray : random();
}
