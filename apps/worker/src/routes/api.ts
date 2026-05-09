import { Hono } from "hono";
import type { AppBindings } from "../types.js";
import { loadStats, saveStats } from "../lib/stats.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { requireCsrfHeader } from "../middleware/csrf.js";
import { TIERS } from "../lib/rate-limit-tiers.js";
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
import { addPageToOwner, removePageFromOwner } from "../lib/owner-index.js";

const api = new Hono<AppBindings>();

// POST /api/publish — create a new page or update an existing one via update_token
api.post("/publish", rateLimit(TIERS.anonymous), async (c) => {
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

  const user = c.get('user');

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
    ownerId: user !== null ? user.id : null,
  };

  try {
    await c.env.PAGES_BUCKET.put(`pages/${id}/index.html`, html, {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("limit exceeded")) {
      return c.json({ error: "Service temporarily unavailable — storage write limit reached. Try again later." }, 503);
    }
    throw err;
  }

  const kvOptions: KVNamespacePutOptions = {};
  if (ttlSeconds !== null) {
    kvOptions.expirationTtl = ttlSeconds;
  }

  try {
    await c.env.PAGES_KV.put(`page:${id}`, serializeMetadata(metadata), kvOptions);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("limit exceeded")) {
      // HTML is in R2 but metadata failed — clean up
      await c.env.PAGES_BUCKET.delete(`pages/${id}/index.html`).catch(() => {});
      return c.json({ error: "Service temporarily unavailable — storage write limit reached. Try again later." }, 503);
    }
    throw err;
  }

  // Write owner index entry (best-effort; failure does not abort publish)
  if (metadata.ownerId !== null) {
    try {
      await addPageToOwner(
        c.env.PAGES_KV,
        metadata.ownerId,
        id,
        metadata.createdAt,
        metadata.expiresAt,
      );
    } catch (err) {
      console.error('owner-index write failed', { id, ownerId: metadata.ownerId, err });
    }
  }

  // Increment publish counter (fire-and-forget)
  c.executionCtx.waitUntil(
    (async () => {
      const stats = await loadStats(c.env.PAGES_KV);
      stats.publishes += 1;
      await saveStats(c.env.PAGES_KV, stats);
    })().catch(() => {}),
  );

  return c.json({
    id,
    url: `${origin}/p/${id}`,
    update_token: token,
    expiresAt,
  });
});

// PUT /api/pages/:id — update by token (from body) or owner JWT
api.put("/pages/:id", requireCsrfHeader, async (c) => {
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

  // Authorization: update_token from body wins (R6); else owner JWT
  const putUser = c.get('user');
  const hasToken = typeof update_token === "string";
  let authorized = false;
  let tokenValid = false;

  if (hasToken) {
    tokenValid = await verifyToken(update_token as string, metadata.tokenHash);
    if (tokenValid) {
      authorized = true;
    }
  }

  if (!authorized && putUser !== null && metadata.ownerId === putUser.id) {
    authorized = true;
  }

  if (!authorized) {
    if (hasToken) {
      return c.json({ error: "Invalid update token" }, 403);
    }
    return c.json({ error: "update_token required" }, 400);
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
  // Return the token string back (prefer the body token; if owner-JWT path used, no token in response)
  const returnToken = hasToken && tokenValid ? (update_token as string) : undefined;

  return c.json({
    id,
    url: `${origin}/p/${id}`,
    ...(returnToken !== undefined ? { update_token: returnToken } : {}),
    expiresAt,
  });
});

// DELETE /api/pages/:id — delete by Bearer token OR owner-JWT convenience path
api.delete("/pages/:id", requireCsrfHeader, async (c) => {
  const id = c.req.param("id") ?? "";
  const authHeader = c.req.header("Authorization");

  const raw = await c.env.PAGES_KV.get(`page:${id}`);
  if (raw === null) {
    return c.json({ error: "Page not found" }, 404);
  }

  const metadata = parseMetadata(raw);
  if (metadata === null) {
    return c.json({ error: "Page metadata is corrupted" }, 500);
  }

  const deleteUser = c.get('user');
  let authorized = false;

  // Primary path: Authorization: Bearer <update_token>
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    const valid = await verifyToken(token, metadata.tokenHash);
    if (valid) {
      authorized = true;
    }
  }

  // Owner-convenience path: JWT owner match (rate-limited)
  if (!authorized && deleteUser !== null && metadata.ownerId === deleteUser.id) {
    // Apply delete rate limit for owner-convenience path
    const deleteRateLimit = rateLimit(TIERS.delete);
    const rlResult = await deleteRateLimit(c, async () => {});
    if (rlResult !== undefined) {
      // Rate limit exceeded — middleware returned a Response
      return rlResult;
    }
    authorized = true;
  }

  if (!authorized) {
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Invalid token" }, 403);
    }
    return c.json({ error: "Authorization: Bearer <token> is required" }, 401);
  }

  await Promise.all([
    c.env.PAGES_BUCKET.delete(`pages/${id}/index.html`),
    c.env.PAGES_KV.delete(`page:${id}`),
  ]);

  // Remove from owner index (best-effort)
  if (metadata.ownerId !== null) {
    try {
      await removePageFromOwner(
        c.env.PAGES_KV,
        metadata.ownerId,
        id,
        metadata.createdAt,
      );
    } catch (err) {
      console.error('owner-index delete failed', { id, ownerId: metadata.ownerId, err });
    }
  }

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
  const stats = await loadStats(c.env.PAGES_KV);
  return c.json({
    publishes: stats.publishes,
    views: stats.views,
    recent: stats.recent,
    geo: stats.geo,
  });
});

export { api };
