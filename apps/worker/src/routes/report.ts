import { Hono } from "hono";
import type { AppBindings } from "../types.js";

const report = new Hono<AppBindings>();

// POST /api/report — store a content report in KV
report.post("/report", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return c.json({ error: "Request body must be a JSON object" }, 400);
  }

  const { id, reason } = body as Record<string, unknown>;

  if (typeof id !== "string" || id.trim().length === 0) {
    return c.json({ error: "id is required" }, 400);
  }

  if (typeof reason !== "string" || reason.trim().length === 0) {
    return c.json({ error: "reason is required" }, 400);
  }

  const timestamp = new Date().toISOString();
  const reportKey = `report:${id.trim()}:${timestamp}`;

  // Store report — keep for 30 days for review
  await c.env.PAGES_KV.put(
    reportKey,
    JSON.stringify({
      pageId: id.trim(),
      reason: reason.trim().slice(0, 500),
      reportedAt: timestamp,
    }),
    { expirationTtl: 60 * 60 * 24 * 30 },
  );

  return c.json({ ok: true });
});

export { report };
