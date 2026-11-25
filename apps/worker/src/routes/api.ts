import { Hono, type Context } from "hono";
import type { AppBindings } from "../types.js";
import { loadStats, publicStats, saveStats } from "../lib/stats.js";
import { rateLimit, publishRateLimit } from "../middleware/rate-limit.js";
import { requireCsrfHeader } from "../middleware/csrf.js";
import { readUpdateToken } from "../lib/page-token.js";
import { TIERS } from "../lib/rate-limit-tiers.js";
import { detectSpam, SPAM_REJECTION } from "../lib/spam.js";
import { claimUrl } from "../lib/claim-url.js";
import { hashPin } from "../lib/pin-hash.js";
import { authoritativeCredentials, authorizePageWrite } from "../lib/claim-decision.js";
import { getClaim, tombstoneClaim } from "../lib/page-claims.js";
import { billingEnabled, getEntitlements, planLimitError, UPGRADE_URL } from "../lib/entitlements.js";
import type { Entitlements } from "../lib/entitlements.js";
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
  MAX_SIZE,
  PRO_MAX_SIZE,
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

/**
 * The owner and token hash that count for a page. A claimed page's D1 row
 * wins over its KV record, which can be written back stale. Throws if D1
 * can't be read: callers fail closed rather than trust a possibly stale hash.
 */
async function credentialsFor(db: D1Database, id: string, metadata: PageMetadata) {
  return authoritativeCredentials(() => getClaim(db, id), metadata.ownerId, metadata.tokenHash);
}

const CREDENTIALS_UNAVAILABLE = "Could not check this page's credentials. Please try again.";

/**
 * Validate HTML against the caller's plan size limit. `response` is the error
 * response, or null when the HTML is fine. A signed-in free user whose page
 * would fit on Pro gets a 402 upgrade prompt when billing is on; everyone else
 * gets the validateHtml 400 as before. `ent` is the caller's entitlements
 * (null when anonymous), returned so the success path doesn't read KV again.
 */
async function rejectInvalidHtml(
  c: Context<AppBindings>,
  html: string,
): Promise<{ response: Response | null; ent: Entitlements | null }> {
  const user = c.get("user");
  const ent = user !== null ? await getEntitlements(c.env, user.id) : null;
  const maxBytes = ent !== null ? ent.maxBytes : MAX_SIZE;
  const validation = validateHtml(html, maxBytes);
  if (validation.ok) return { response: null, ent };
  if (ent !== null && ent.plan === "free" && billingEnabled(c.env)) {
    const size = new TextEncoder().encode(html).byteLength;
    if (size > maxBytes && size <= PRO_MAX_SIZE) {
      return { response: c.json(planLimitError("page_size"), 402), ent };
    }
  }
  return { response: c.json({ error: validation.error }, 400), ent };
}

/**
 * The `upgrade` key for a successful publish/update response: only a signed-in
 * free-plan caller with billing on sees the offer to remove the badge.
 */
function upgradeHint(
  c: Context<AppBindings>,
  ent: Entitlements | null,
): { upgrade: { reason: "badge"; url: string } } | Record<string, never> {
  if (ent === null || ent.plan !== "free" || !billingEnabled(c.env)) return {};
  return { upgrade: { reason: "badge", url: `${UPGRADE_URL}?ref=publish` } };
}

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

  const { response: invalid, ent } = await rejectInvalidHtml(c, html);
  if (invalid !== null) return invalid;

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

    let creds: { ownerId: number | null; tokenHash: string };
    try {
      creds = await credentialsFor(c.env.DB, existingId, metadata);
    } catch (err) {
      console.error("page_claims lookup failed on publish update", { id: existingId, err });
      return c.json({ error: CREDENTIALS_UNAVAILABLE }, 503);
    }
    const valid = await verifyToken(update_token, creds.tokenHash);
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
      // Write the authoritative owner and hash, so a stale read can't undo a claim.
      ownerId: creds.ownerId,
      tokenHash: creds.tokenHash,
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
      ...upgradeHint(c, ent),
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
    // Stored as a salted PBKDF2 hash (lib/pin-hash.ts), never as typed.
    pin: typeof pin === "string" && pin.length > 0 ? await hashPin(pin) : null,
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
    // Anonymous creates get a link to attach the page to an account later.
    ...(user === null ? { claim_url: claimUrl(c.env.SITE_ORIGIN, id, token) } : {}),
    ...upgradeHint(c, ent),
  });
});

// PUT /api/pages/:id — update by token (body or Bearer header) or owner JWT
api.put("/pages/:id", requireCsrfHeader, async (c) => {
  const id = c.req.param("id") ?? "";

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

  const { response: invalid, ent } = await rejectInvalidHtml(c, html);
  if (invalid !== null) return invalid;

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
  let creds: { ownerId: number | null; tokenHash: string };
  try {
    creds = await credentialsFor(c.env.DB, id, metadata);
  } catch (err) {
    console.error("page_claims lookup failed on update", { id, err });
    return c.json({ error: CREDENTIALS_UNAVAILABLE }, 503);
  }
  const auth = await authorizePageWrite({
    ownerId: creds.ownerId,
    tokenHash: creds.tokenHash,
    token: update_token,
    userId: putUser?.id ?? null,
    allowSession: true,
    matches: (hash) => verifyToken(update_token as string, hash),
  });

  if (!auth.ok) {
    if (auth.reason === "bad_token") {
      return c.json({ error: "Invalid update token" }, 403);
    }
    return c.json({ error: "update_token required" }, 400);
  }

  // Anonymous pages are screened on update too, so a clean page can't be
  // swapped for spam after publishing.
  if (creds.ownerId === null) {
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
    // Write the authoritative owner and hash, so a stale read can't undo a claim.
    ownerId: creds.ownerId,
    tokenHash: creds.tokenHash,
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
  const returnToken = auth.viaToken ? (update_token as string) : undefined;

  return c.json({
    id,
    url: `${origin}/p/${id}`,
    ...(returnToken !== undefined ? { update_token: returnToken } : {}),
    expiresAt,
    ...upgradeHint(c, ent),
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
  let creds: { ownerId: number | null; tokenHash: string };
  try {
    creds = await credentialsFor(c.env.DB, id, metadata);
  } catch (err) {
    console.error("page_claims lookup failed on delete", { id, err });
    return c.json({ error: CREDENTIALS_UNAVAILABLE }, 503);
  }
  if (token !== null) {
    const valid = await verifyToken(token, creds.tokenHash);
    if (valid) {
      authorized = true;
    }
  }

  // Owner-convenience path: JWT owner match (rate-limited)
  if (!authorized && deleteUser !== null && creds.ownerId === deleteUser.id) {
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
  // Keep a tombstone row: a stale KV copy of the page, still readable in
  // other regions for a while, must not let its old token bring it back.
  try {
    await tombstoneClaim(c.env.DB, id, Date.now());
  } catch (err) {
    console.error("page_claims tombstone failed", { id, err });
  }

  // Remove from owner index (best-effort)
  if (creds.ownerId !== null) {
    try {
      await removePageFromOwner(
        c.env.PAGES_KV,
        creds.ownerId,
        id,
        metadata.createdAt,
      );
    } catch (err) {
      console.error('owner-index delete failed', { id, ownerId: creds.ownerId, err });
    }

    // Remove from owner+project index + decrement the manifest (best-effort)
    if (metadata.project !== null) {
      try {
        await removePageFromOwnerProject(
          c.env.PAGES_KV,
          creds.ownerId,
          metadata.project,
          id,
          metadata.createdAt,
        );
        await bumpProjectCount(c.env.PAGES_KV, creds.ownerId, metadata.project, -1);
      } catch (err) {
        console.error('owner-project-index delete failed', { id, ownerId: creds.ownerId, project: metadata.project, err });
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
