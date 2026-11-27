import { Hono } from "hono";
import type { AppBindings } from "../types.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { TIERS } from "../lib/rate-limit-tiers.js";
import { apiError } from "../lib/errors.ts";
import { parseSiteEvent, siteEventPoint } from "../lib/site-event.ts";

const siteEvent = new Hono<AppBindings>();

// POST /api/site-event — count one click on a guide's agent menu
// (lib/site-event.ts). Body: { page, item }. Answers 204 with no body.
siteEvent.post("/site-event", rateLimit(TIERS.site_event), async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 400, "bad_request", "Invalid JSON body");
  }
  const parsed = parseSiteEvent(body);
  if (!parsed.ok) return apiError(c, 400, "bad_request", parsed.error);
  try {
    c.env.SITE_EVENTS?.writeDataPoint(siteEventPoint(parsed.page, parsed.item, Date.now()));
  } catch (err) {
    console.error("site event write failed", { err: String(err) });
  }
  return c.body(null, 204);
});

export { siteEvent };
