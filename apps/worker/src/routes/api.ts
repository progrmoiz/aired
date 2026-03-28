import { Hono } from "hono";
import type { AppBindings } from "../types.js";
import { rateLimitMiddleware } from "../middleware/rate-limit.js";
import {
  generateId,
  generateToken,
  hashToken,
  verifyToken,
  validateHtml,
  extractTitle,
  parseMetadata,
  serializeMetadata,
  DEFAULT_TTL,
} from "@aired/core";
import type { PageMetadata } from "@aired/core";

const api = new Hono<AppBindings>();

// POST /api/publish — create a new page or update an existing one via update_token
api.post("/publish", rateLimitMiddleware, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return c.json({ error: "Request body must be a JSON object" }, 400);
  }

  const req = body as Record<string, unknown>;
  const { html, title, pin, ttl, reads, permanent, update_token, id: existingId } = req;

  if (typeof html !== "string") {
    return c.json({ error: "html is required and must be a string" }, 400);
  }

  const validation = validateHtml(html);
  if (!validation.ok) {
    return c.json({ error: validation.error }, 400);
  }

  const resolvedTitle =
    (typeof title === "string" && title.trim() ? title.trim() : null) ??
    extractTitle(html);

  const origin = new URL(c.req.url).origin;

  // Update path: update_token + id provided
  if (typeof update_token === "string" && typeof existingId === "string") {
    const raw = await c.env.PAGES_KV.get(`page:${existingId}`);
    if (raw === null) {
      return c.json({ error: "Page not found" }, 404);
    }

    const metadata = parseMetadata(raw);
    if (metadata === null) {
      return c.json({ error: "Page metadata is corrupted" }, 500);
    }

    const valid = await verifyToken(update_token, metadata.tokenHash);
    if (!valid) {
      return c.json({ error: "Invalid update token" }, 403);
    }

    await c.env.PAGES_BUCKET.put(`pages/${existingId}/index.html`, html, {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
    });

    const now = new Date();
    const ttlSeconds = metadata.permanent ? null : DEFAULT_TTL;
    const expiresAt = ttlSeconds !== null
      ? new Date(now.getTime() + ttlSeconds * 1000).toISOString()
      : null;

    const updated: PageMetadata = {
      ...metadata,
      title: resolvedTitle ?? metadata.title,
      size: new TextEncoder().encode(html).byteLength,
      expiresAt,
    };

    const kvOptions: KVNamespacePutOptions = {};
    if (ttlSeconds !== null) {
      kvOptions.expirationTtl = ttlSeconds;
    }
    await c.env.PAGES_KV.put(`page:${existingId}`, serializeMetadata(updated), kvOptions);

    return c.json({
      id: existingId,
      url: `${origin}/p/${existingId}`,
      update_token,
      expiresAt,
    });
  }

  // Create path: new page
  const id = generateId();
  const token = generateToken();
  const tokenHash = await hashToken(token);

  const isPermanent = permanent === true;
  const ttlSeconds =
    isPermanent ? null
    : typeof ttl === "number" && ttl > 0 ? Math.floor(ttl)
    : DEFAULT_TTL;

  const now = new Date();
  const expiresAt = ttlSeconds !== null
    ? new Date(now.getTime() + ttlSeconds * 1000).toISOString()
    : null;

  const metadata: PageMetadata = {
    id,
    title: resolvedTitle,
    size: new TextEncoder().encode(html).byteLength,
    tokenHash,
    pin: typeof pin === "string" && pin.length > 0 ? pin : null,
    reads: typeof reads === "number" && reads > 0 ? Math.floor(reads) : null,
    readCount: 0,
    permanent: isPermanent,
    createdAt: now.toISOString(),
    expiresAt,
  };

  await c.env.PAGES_BUCKET.put(`pages/${id}/index.html`, html, {
    httpMetadata: { contentType: "text/html; charset=utf-8" },
  });

  const kvOptions: KVNamespacePutOptions = {};
  if (ttlSeconds !== null) {
    kvOptions.expirationTtl = ttlSeconds;
  }
  await c.env.PAGES_KV.put(`page:${id}`, serializeMetadata(metadata), kvOptions);

  // Increment publish counter (fire-and-forget)
  c.executionCtx.waitUntil(
    (async () => {
      const count = parseInt(await c.env.PAGES_KV.get("stats:publishes") ?? "0", 10);
      await c.env.PAGES_KV.put("stats:publishes", String(count + 1));
    })().catch(() => {}),
  );

  return c.json({
    id,
    url: `${origin}/p/${id}`,
    update_token: token,
    expiresAt,
  });
});

// PUT /api/pages/:id — update by token
api.put("/pages/:id", async (c) => {
  const id = c.req.param("id");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return c.json({ error: "Request body must be a JSON object" }, 400);
  }

  const { html, title, update_token } = body as Record<string, unknown>;

  if (typeof html !== "string") {
    return c.json({ error: "html is required and must be a string" }, 400);
  }
  if (typeof update_token !== "string") {
    return c.json({ error: "update_token is required" }, 400);
  }

  const validation = validateHtml(html);
  if (!validation.ok) {
    return c.json({ error: validation.error }, 400);
  }

  const resolvedTitle =
    (typeof title === "string" && title.trim() ? title.trim() : null) ??
    extractTitle(html);

  const raw = await c.env.PAGES_KV.get(`page:${id}`);
  if (raw === null) {
    return c.json({ error: "Page not found" }, 404);
  }

  const metadata = parseMetadata(raw);
  if (metadata === null) {
    return c.json({ error: "Page metadata is corrupted" }, 500);
  }

  const valid = await verifyToken(update_token, metadata.tokenHash);
  if (!valid) {
    return c.json({ error: "Invalid update token" }, 403);
  }

  await c.env.PAGES_BUCKET.put(`pages/${id}/index.html`, html, {
    httpMetadata: { contentType: "text/html; charset=utf-8" },
  });

  const now = new Date();
  const ttlSeconds = metadata.permanent ? null : DEFAULT_TTL;
  const expiresAt = ttlSeconds !== null
    ? new Date(now.getTime() + ttlSeconds * 1000).toISOString()
    : null;

  const updated: PageMetadata = {
    ...metadata,
    title: resolvedTitle ?? metadata.title,
    size: new TextEncoder().encode(html).byteLength,
    expiresAt,
  };

  const kvOptions: KVNamespacePutOptions = {};
  if (ttlSeconds !== null) {
    kvOptions.expirationTtl = ttlSeconds;
  }
  await c.env.PAGES_KV.put(`page:${id}`, serializeMetadata(updated), kvOptions);

  const origin = new URL(c.req.url).origin;

  return c.json({
    id,
    url: `${origin}/p/${id}`,
    update_token,
    expiresAt,
  });
});

// DELETE /api/pages/:id — delete by token in Authorization header
api.delete("/pages/:id", async (c) => {
  const id = c.req.param("id");
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Authorization: Bearer <token> is required" }, 401);
  }

  const token = authHeader.slice("Bearer ".length).trim();

  const raw = await c.env.PAGES_KV.get(`page:${id}`);
  if (raw === null) {
    return c.json({ error: "Page not found" }, 404);
  }

  const metadata = parseMetadata(raw);
  if (metadata === null) {
    return c.json({ error: "Page metadata is corrupted" }, 500);
  }

  const valid = await verifyToken(token, metadata.tokenHash);
  if (!valid) {
    return c.json({ error: "Invalid token" }, 403);
  }

  await Promise.all([
    c.env.PAGES_BUCKET.delete(`pages/${id}/index.html`),
    c.env.PAGES_KV.delete(`page:${id}`),
  ]);

  return c.json({ ok: true });
});

// GET /api/pages/:id — public metadata (no token required)
api.get("/pages/:id", async (c) => {
  const id = c.req.param("id");

  const raw = await c.env.PAGES_KV.get(`page:${id}`);
  if (raw === null) {
    return c.json({ error: "Page not found" }, 404);
  }

  const metadata = parseMetadata(raw);
  if (metadata === null) {
    return c.json({ error: "Page metadata is corrupted" }, 500);
  }

  return c.json({
    id: metadata.id,
    title: metadata.title,
    size: metadata.size,
    readCount: metadata.readCount,
    expiresAt: metadata.expiresAt,
  });
});

// GET /api/stats — public stats
api.get("/stats", async (c) => {
  const publishes = parseInt(await c.env.PAGES_KV.get("stats:publishes") ?? "0", 10);
  return c.json({ publishes });
});

export { api };
