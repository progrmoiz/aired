import { Hono, type Context } from "hono";
import type { AppBindings } from "../types.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { requireCsrfHeader } from "../middleware/csrf.js";
import { TIERS } from "../lib/rate-limit-tiers.js";
import { apiError } from "../lib/errors.ts";
import { siteOrigin } from "../lib/origin.ts";
import { billingEnabled, getEntitlements, planLimitError } from "../lib/entitlements.js";
import { pageFor } from "../lib/pages-service.ts";
import {
  decodeEntryCursor,
  deleteEntries,
  getLiveData,
  getPageData,
  listEntries,
  putLiveData,
  setCollectSettings,
  utcMonth,
  type Entry,
  type PageDataRow,
} from "../lib/collect-store.ts";
import { fieldColumns, toCsv } from "../lib/collect-csv.ts";
import { validateLiveData } from "../lib/collect-validate.ts";
import { CSV_MAX_ROWS, LIVE_DATA_PUSH_LIMIT, READ_PAGE_MAX } from "../lib/collect-limits.ts";
import { takeDurableSlot } from "../lib/durable-limit.ts";
import type { LoadedPage } from "../lib/page-write.ts";

/**
 * The owner's side of the data layer, beside the page routes in api.ts:
 * - GET    /api/pages/:id/responses       entries (newest first, with viewer ids), settings, usage
 * - GET    /api/pages/:id/responses.csv   every entry as CSV
 * - DELETE /api/pages/:id/responses       delete { ids } or, with { all: true }, every entry
 * - PATCH  /api/pages/:id/responses       { public_results?, closed? }
 * - GET    /api/pages/:id/data            the live data
 * - PUT    /api/pages/:id/data            { data }: replace it; open pages pick it up (update_data)
 *
 * Signed-in owner only (session, CLI sign-in, API key or OAuth). Unlike
 * get_page, the update token is not enough: entries are what viewers
 * typed, and update tokens travel in more places than an account does.
 */
const responses = new Hono<AppBindings>();

const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ENTRY_ID = /^r_[A-Za-z0-9_-]{12}$/;

/** The page, if the signed-in caller owns it; else the error to answer. */
async function ownPage(c: Context<AppBindings>, route: string): Promise<LoadedPage | Response> {
  const id = c.req.param("id") ?? "";
  if (!PAGE_ID.test(id)) return apiError(c, 404, "not_found", "Page not found");
  const user = c.get("user");
  if (user === null) return apiError(c, 401, "unauthorized", "Sign in (aired login, an API key or the dashboard) to read a page's responses.");
  const page = await pageFor(c, id, route);
  if (page instanceof Response) return page;
  // Someone else's page answers like a missing one: ids aren't secret, but who collects is.
  if (page.row.ownerId !== user.id) return apiError(c, 404, "not_found", "Page not found");
  return page;
}

export function ownerEntry(e: Entry) {
  return { id: e.id, viewer: e.viewer, key: e.key, data: e.data, created_at: new Date(e.createdAt).toISOString(), updated_at: new Date(e.updatedAt).toISOString() };
}

function settingsOf(row: PageDataRow | null) {
  return { public_results: row?.publicResults ?? false, closed: row?.closed ?? false };
}

function usageOf(row: PageDataRow | null, limits: Awaited<ReturnType<typeof getEntitlements>>["collect"], now: number) {
  const month = utcMonth(now);
  return {
    entries: row?.entries ?? 0,
    bytes: row?.bytes ?? 0,
    this_month: row && row.month === month ? row.monthCount : 0,
    limits: {
      responses_per_month: limits.responsesPerMonth,
      stored_responses: limits.storedResponses,
      stored_bytes: limits.storedBytes,
      retention_days: limits.retentionDays,
      live_data_bytes: limits.liveDataBytes,
    },
  };
}

async function readObject(c: Context<AppBindings>): Promise<Record<string, unknown> | Response> {
  try {
    const v: unknown = await c.req.json();
    if (typeof v === "object" && v !== null && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    return apiError(c, 400, "invalid_json", "Invalid JSON body");
  }
  return apiError(c, 400, "invalid_input", "Request body must be a JSON object");
}

responses.get("/pages/:id/responses", rateLimit(TIERS.responses), async (c) => {
  const page = await ownPage(c, "responses");
  if (page instanceof Response) return page;
  const limitRaw = Number(c.req.query("limit") ?? "50");
  const limit = Number.isInteger(limitRaw) && limitRaw >= 1 ? Math.min(limitRaw, READ_PAGE_MAX) : 50;
  const cursorRaw = c.req.query("cursor");
  const cursor = decodeEntryCursor(cursorRaw);
  if (cursorRaw !== undefined && cursor === null) return apiError(c, 400, "invalid_input", "Invalid cursor", { field: "cursor" });
  const user = c.get("user")!;
  const [list, row, ent] = await Promise.all([
    listEntries(c.env.DB, page.row.id, { viewer: null, limit, cursor }),
    getPageData(c.env.DB, page.row.id),
    getEntitlements(c.env, user.id),
  ]);
  return c.json({
    id: page.row.id,
    url: `${siteOrigin(c.env)}/p/${page.row.id}`,
    title: page.row.title,
    settings: settingsOf(row),
    usage: usageOf(row, ent.collect, Date.now()),
    responses: list.entries.map(ownerEntry),
    cursor: list.cursor,
  });
});

// Streams the CSV a chunk at a time, so a page with many entries never sits
// in memory whole. Columns come from the first chunk's fields, plus any new
// ones later chunks bring (written as JSON in a trailing "more" column).
responses.get("/pages/:id/responses.csv", rateLimit(TIERS.responses), async (c) => {
  const page = await ownPage(c, "responses_csv");
  if (page instanceof Response) return page;
  const id = page.row.id;
  const db = c.env.DB;
  const first = await listEntries(db, id, { viewer: null, limit: 1000, cursor: null });
  // One chunk holds everything: its fields are all the columns. Otherwise
  // later chunks may bring fields the header doesn't name: they go in "more".
  const fields = first.cursor === null ? fieldColumns(first.entries) : [...fieldColumns(first.entries), "more"];
  const known = new Set(fields);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let chunk = first;
        let rows = 0;
        let header = true;
        for (;;) {
          const entries = chunk.entries.slice(0, Math.max(0, CSV_MAX_ROWS - rows));
          const withExtras = entries.map((e) => {
            const d = e.data && typeof e.data === "object" && !Array.isArray(e.data) ? (e.data as Record<string, unknown>) : {};
            const extra = Object.keys(d).filter((k) => !known.has(k));
            return extra.length === 0 ? e : { ...e, data: { ...d, more: Object.fromEntries(extra.map((k) => [k, d[k]])) } };
          });
          const csv = toCsv(withExtras, fields);
          controller.enqueue(encoder.encode(header ? csv : csv.slice(csv.indexOf("\r\n") + 2)));
          header = false;
          rows += entries.length;
          if (chunk.cursor === null || rows >= CSV_MAX_ROWS) break;
          chunk = await listEntries(db, id, { viewer: null, limit: 1000, cursor: decodeEntryCursor(chunk.cursor) });
        }
        controller.close();
      } catch (err) {
        console.error("responses csv failed", { id, err: String(err) });
        controller.error(err);
      }
    },
  });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="aired-${id}-responses-${day}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

responses.delete("/pages/:id/responses", requireCsrfHeader, rateLimit(TIERS.responses), async (c) => {
  const page = await ownPage(c, "responses_delete");
  if (page instanceof Response) return page;
  const body = await readObject(c);
  if (body instanceof Response) return body;
  let ids: string[] | null;
  if (body.all === true) {
    ids = null;
  } else if (Array.isArray(body.ids) && body.ids.length > 0 && body.ids.length <= 500 && body.ids.every((x) => typeof x === "string" && ENTRY_ID.test(x))) {
    ids = body.ids as string[];
  } else {
    return apiError(c, 400, "invalid_input", 'Send { "ids": [entry ids, up to 500] } or { "all": true }', { field: "ids" });
  }
  const deleted = await deleteEntries(c.env.DB, page.row.id, ids, Date.now());
  return c.json({ deleted });
});

responses.patch("/pages/:id/responses", requireCsrfHeader, rateLimit(TIERS.responses), async (c) => {
  const page = await ownPage(c, "responses_settings");
  if (page instanceof Response) return page;
  const body = await readObject(c);
  if (body instanceof Response) return body;
  const change: { publicResults?: boolean; closed?: boolean } = {};
  for (const [field, key] of [["public_results", "publicResults"], ["closed", "closed"]] as const) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== "boolean") return apiError(c, 400, "invalid_input", `${field} must be true or false`, { field });
    change[key] = body[field] as boolean;
  }
  if (Object.keys(change).length === 0) return apiError(c, 400, "invalid_input", "Send public_results or closed");
  const row = await setCollectSettings(c.env.DB, page.row.id, page.row.ownerId!, change, Date.now());
  return c.json({ id: page.row.id, settings: settingsOf(row) });
});

responses.get("/pages/:id/data", rateLimit(TIERS.responses), async (c) => {
  const page = await ownPage(c, "data_get");
  if (page instanceof Response) return page;
  const live = await getLiveData(c.env.DB, page.row.id);
  return c.json({ id: page.row.id, version: live.version, data: live.data, updated_at: live.updatedAt === null ? null : new Date(live.updatedAt).toISOString() });
});

responses.put("/pages/:id/data", requireCsrfHeader, rateLimit(TIERS.responses), async (c) => {
  const page = await ownPage(c, "data_put");
  if (page instanceof Response) return page;
  const body = await readObject(c);
  if (body instanceof Response) return body;
  const user = c.get("user")!;
  const ent = await getEntitlements(c.env, user.id);
  const valid = validateLiveData(body.data, ent.collect.liveDataBytes);
  if (!valid.ok) {
    if (valid.code === "too_large" && ent.plan === "free" && billingEnabled(c.env)) {
      return c.json({ ...planLimitError("live_data", siteOrigin(c.env)), error: valid.error }, 402);
    }
    return apiError(c, valid.code === "too_large" ? 413 : 400, valid.code === "too_large" ? "payload_too_large" : "invalid_input", valid.error, { field: "data" });
  }
  const now = Date.now();
  if (!(await takeDurableSlot(c.env.DB, `data:push:${page.row.id}`, LIVE_DATA_PUSH_LIMIT, now))) {
    c.header("Retry-After", "60");
    return apiError(c, 429, "rate_limited", `A page's data can change ${LIVE_DATA_PUSH_LIMIT.limit} times an hour.`);
  }
  const version = await putLiveData(c.env.DB, page.row.id, page.row.ownerId!, valid.json, valid.size, now);
  return c.json({ id: page.row.id, url: `${siteOrigin(c.env)}/p/${page.row.id}`, version, size: valid.size, updated_at: new Date(now).toISOString() });
});

export { responses };
