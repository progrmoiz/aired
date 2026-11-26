import { Hono } from "hono";
import { parseMetadata } from "@aired/core";
import type { AppBindings } from "../types.js";
import { BACKFILL_MAX_LIMIT, backfillBatch } from "../lib/pages-backfill.ts";
import { log } from "../lib/log.js";

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

export { admin };
