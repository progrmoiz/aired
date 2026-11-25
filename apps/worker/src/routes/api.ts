import { Hono } from "hono";
import type { AppBindings } from "../types.js";
import { loadStats, publicStats, saveStats } from "../lib/stats.js";
import { rateLimit, publishRateLimit } from "../middleware/rate-limit.js";
import { requireCsrfHeader } from "../middleware/csrf.js";
import { readUpdateToken } from "../lib/page-token.js";
import { TIERS } from "../lib/rate-limit-tiers.js";
import { detectSpam, SPAM_REJECTION } from "../lib/spam.js";
import {
  generateId,
  generateToken,
  hashToken,
  verifyToken,
  validateHtml,
  extractTitle,
  parseMetadata,
  serializeMetadata,
  normalizeProject,
  DEFAULT_TTL,
} from "@aired/core";
import type { PageMetadata } from "@aired/core";
import {
  addPageToOwner,
  removePageFromOwner,
  addPageToOwnerProject,
  removePageFromOwnerProject,
  bumpProjectCount,
} from "../lib/owner-index.js";

const api = new Hono<AppBindings>();

// POST /api/publish — create a new page or update an existing one via update_token
api.post("/publish", publishRateLimit, async (c) => {
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
  const { html, title, pin, ttl, reads, permanent, project, update_token, id: existingId } = req;

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
  const user = c.get('user');

  // Anonymous publishes (create or update) are screened for spam.
  // Signed-in publishers are accountable and skip the filter.
  if (user === null) {
    const verdict = detectSpam(html, resolvedTitle);
    if (verdict.spam) {
      console.log({ event: "spam_rejected", route: "api_publish", reason: verdict.reason });
      return c.json({ error: SPAM_REJECTION }, 422);
    }
  }

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

  // Authenticated publishers default to permanent (no expiry).
  // Explicit `permanent: false` or an explicit `ttl` opts back into expiration.
  const isPermanent =
    permanent === true ||
    (permanent !== false && (typeof ttl !== "number" || ttl <= 0) && user !== null);
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
    ownerId: user !== null ? user.id : null,
    project: normalizeProject(project),
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

    // Write owner+project index + bump the project manifest (best-effort)
    if (metadata.project !== null) {
      try {
        await addPageToOwnerProject(
          c.env.PAGES_KV,
          metadata.ownerId,
          metadata.project,
          id,
          metadata.createdAt,
          metadata.expiresAt,
        );
        await bumpProjectCount(c.env.PAGES_KV, metadata.ownerId, metadata.project, 1);
      } catch (err) {
        console.error('owner-project-index write failed', { id, ownerId: metadata.ownerId, project: metadata.project, err });
      }
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

// PUT /api/pages/:id — update by token (body or Bearer header) or owner JWT
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

  const { html, title } = body as Record<string, unknown>;
  const update_token = readUpdateToken(
    (body as Record<string, unknown>).update_token,
    c.req.header("Authorization"),
  );

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

  // Authorization: update_token (body, else Bearer header) wins (R6); else owner JWT
  const putUser = c.get('user');
  const hasToken = update_token !== null;
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

  // Anonymous pages are screened on update too, so a clean page can't be
  // swapped for spam after publishing.
  if (metadata.ownerId === null) {
    const verdict = detectSpam(html, resolvedTitle);
    if (verdict.spam) {
      console.log({ event: "spam_rejected", route: "api_put", reason: verdict.reason });
      return c.json({ error: SPAM_REJECTION }, 422);
    }
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

  // Primary path: Authorization: Bearer <update_token>, or update_token in a
  // JSON body for clients that send it the same way as PUT.
  let bodyToken: unknown;
  try {
    bodyToken = ((await c.req.json()) as Record<string, unknown> | null)?.update_token;
  } catch {
    bodyToken = undefined;
  }
  const token = readUpdateToken(bodyToken, authHeader);
  if (token !== null) {
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
    if (token !== null) {
      return c.json({ error: "Invalid token" }, 403);
    }
    return c.json({ error: "Authorization: Bearer <update_token> is required" }, 401);
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

    // Remove from owner+project index + decrement the manifest (best-effort)
    if (metadata.project !== null) {
      try {
        await removePageFromOwnerProject(
          c.env.PAGES_KV,
          metadata.ownerId,
          metadata.project,
          id,
          metadata.createdAt,
        );
        await bumpProjectCount(c.env.PAGES_KV, metadata.ownerId, metadata.project, -1);
      } catch (err) {
        console.error('owner-project-index delete failed', { id, ownerId: metadata.ownerId, project: metadata.project, err });
      }
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

// GET /api/stats — public stats: counters and per-country views only
api.get("/stats", async (c) => {
  const stats = await loadStats(c.env.PAGES_KV);
  return c.json(publicStats(stats));
});

export { api };
