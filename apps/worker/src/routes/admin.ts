import { Hono } from "hono";
import { parseMetadata } from "@aired/core";
import type { AppBindings } from "../types.js";
import { BACKFILL_MAX_LIMIT, backfillBatch } from "../lib/pages-backfill.ts";
import { log } from "../lib/log.js";
import { FEEDBACK_KINDS, listFeedback } from "../lib/feedback.ts";
import { analyticsConfig, runQuery } from "../lib/analytics.ts";
import { siteEventQuery } from "../lib/site-event.ts";

/**
 * Operator-only endpoints. Off unless the ADMIN_TOKEN secret is set
 * (`wrangler secret put ADMIN_TOKEN`), and every request must carry it in
 * X-Admin-Token. Anything else gets the same 404 as an unknown path. Delete
 * the secret when the job is done.
 */
const admin = new Hono<AppBindings>();

async function sameSecret(given: string, secret: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(secret)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

admin.use("*", async (c, next): Promise<Response | void> => {
  const secret = c.env.ADMIN_TOKEN;
  const given = c.req.header("X-Admin-Token");
  if (!secret || secret.length < 32 || given === undefined || !(await sameSecret(given, secret))) {
    return c.json({ error: "Not found" }, 404);
  }
  await next();
});

// POST /api/admin/pages-backfill — one batch of the KV → D1 pages backfill
// (lib/pages-backfill.ts). Body: { cursor?, limit?, apply? }. A dry run
// unless apply is true. Driven by scripts/pages-backfill.ts.
admin.post("/pages-backfill", async (c) => {
  let body: { cursor?: unknown; limit?: unknown; apply?: unknown } = {};
  try {
    body = (await c.req.json()) ?? {};
  } catch {
    // empty body: first batch, default size, dry run
  }
  const cursor = typeof body.cursor === "string" && body.cursor.length > 0 ? body.cursor : null;
  const limit = typeof body.limit === "number" && body.limit > 0 ? Math.min(body.limit, BACKFILL_MAX_LIMIT) : 200;
  const dryRun = body.apply !== true;
  const report = await backfillBatch(
    {
      db: c.env.DB,
      kvList: async (from, n) => {
        const res = await c.env.PAGES_KV.list({ prefix: "page:", limit: n, ...(from ? { cursor: from } : {}) });
        return { keys: res.keys.map((k) => k.name), cursor: res.list_complete ? null : res.cursor };
      },
      kvGetMany: (keys) => c.env.PAGES_KV.get(keys),
      parse: parseMetadata,
    },
    { cursor, limit, dryRun, now: Date.now() },
  );
  log("info", "pages_backfill_batch", { dryRun, ...report.counts, done: report.cursor === null }, c.get("requestId"));
  return c.json(report);
});

// GET /api/admin/feedback — agent feedback, newest first (lib/feedback.ts).
// ?limit= (default 50, at most 200), ?before=<created_at ms> for the next
// page, ?kind=bug|friction|idea. scripts/feedback.mjs reads the same table
// without the token, through wrangler.
admin.get("/feedback", async (c) => {
  const rawLimit = Number(c.req.query("limit") ?? 50);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
  const before = Number(c.req.query("before"));
  const kind = c.req.query("kind");
  if (kind !== undefined && !(FEEDBACK_KINDS as readonly string[]).includes(kind)) return c.json({ error: "Unknown kind" }, 400);
  const rows = await listFeedback(c.env.DB, {
    limit,
    ...(Number.isFinite(before) && before > 0 ? { before } : {}),
    ...(kind !== undefined ? { kind } : {}),
  });
  return c.json({
    feedback: rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() })),
    next_before: rows.length === limit ? rows[rows.length - 1]!.created_at : null,
  });
});

// GET /api/admin/site-events — agent menu clicks per page and item
// (lib/site-event.ts) over ?days= (1 to 90, default 30).
admin.get("/site-events", async (c) => {
  const raw = Number(c.req.query("days") ?? 30);
  const days = Number.isInteger(raw) && raw >= 1 && raw <= 90 ? raw : 30;
  const config = analyticsConfig(c.env);
  if (config === null) return c.json({ error: "Analytics isn't set up: CF_ACCOUNT_ID and CF_ANALYTICS_TOKEN" }, 503);
  const rows = await runQuery((url, init) => fetch(url, init), config, siteEventQuery(days));
  return c.json({ days, clicks: rows.map((r) => ({ page: String(r.page ?? ""), item: String(r.item ?? ""), clicks: Number(r.clicks ?? 0) })) });
});

export { admin };
