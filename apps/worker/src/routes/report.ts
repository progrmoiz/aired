import { Hono } from "hono";
import type { AppBindings } from "../types.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { TIERS } from "../lib/rate-limit-tiers.js";
import { parseReport } from "../lib/report.js";

const report = new Hono<AppBindings>();

// POST /api/report — store an abuse report in KV for review.
// Reviewed with `node scripts/abuse.mjs list`.
report.post("/report", rateLimit(TIERS.report), async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = parseReport(body);
  if (!parsed.ok) {
    return c.json({ error: parsed.error }, 400);
  }
  const { pageId, category, reason, contact } = parsed.report;

  // Only accept reports for pages that exist, so the queue holds no junk.
  const exists = await c.env.PAGES_KV.get(`page:${pageId}`);
  if (exists === null) {
    return c.json({ error: "Page not found. It may already be removed." }, 404);
  }

  const reportedAt = new Date().toISOString();
  await c.env.PAGES_KV.put(
    `report:${pageId}:${reportedAt}`,
    JSON.stringify({ pageId, category, reason, contact, reportedAt }),
    // Keep for 30 days for review
    { expirationTtl: 60 * 60 * 24 * 30 },
  );

  console.log({ event: "page_reported", pageId, category });
  return c.json({ ok: true });
});

export { report };
