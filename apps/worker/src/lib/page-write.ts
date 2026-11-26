import { DEFAULT_TTL, kvKeys, parseMetadata, serializeMetadata } from "@aired/core";
import type { PageMetadata } from "@aired/core";
import {
  addPageToOwner,
  addPageToOwnerProject,
  bumpProjectCount,
  removePageFromOwner,
  removePageFromOwnerProject,
} from "./owner-index.js";
import {
  insertPageRow,
  isLive,
  markPageDeleted,
  metadataFromRow,
  removePageRow,
  resolvePage,
  rowFromMetadata,
  updatePageContent,
  type PageRow,
} from "./pages-store.ts";
import { tombstoneClaim } from "./page-claims.ts";
import { forgetShots } from "./og-render.js";

/**
 * The one way every route creates, updates, deletes or looks up a page
 * (routes/api.ts publish, PUT and DELETE, and the anonymous MCP tool in
 * routes/mcp.ts). D1 `pages` is written first and decides; then R2 holds
 * the HTML and KV `page:<id>` the viewer's cached copy.
 *
 * The KV owner and project indexes (lib/owner-index.ts) and `page_claims`
 * are still written, best-effort, so rolling back to the code before
 * `pages` loses nothing. Nothing reads them for decisions. Drop those writes
 * once this has run a release without a rollback.
 */

type PageEnv = { PAGES_KV: KVNamespace; PAGES_BUCKET: R2Bucket; DB: D1Database };

export const HTML_TYPE = { httpMetadata: { contentType: "text/html; charset=utf-8" } };

export type LoadedPage = {
  row: PageRow;
  /** The KV cache record, or null if it's missing or unreadable. */
  kv: PageMetadata | null;
};

/**
 * A live page: its D1 row (made from the KV record if it has none yet) and
 * its KV record. Null if it doesn't exist, was deleted or has expired.
 * Throws on a D1 error, so callers fail closed.
 */
export async function loadPage(env: PageEnv, id: string, now = Date.now()): Promise<LoadedPage | null> {
  const raw = await env.PAGES_KV.get(kvKeys.page(id));
  const kv = raw === null ? null : parseMetadata(raw);
  const row = await resolvePage(env.DB, id, kv, now);
  if (row === null || !isLive(row, now)) return null;
  return { row, kv };
}

/** The KV cache record for a row, keeping the view count it has now. */
function cacheRecord(row: PageRow, kv: PageMetadata | null): PageMetadata {
  return { ...metadataFromRow(row, kv?.readCount ?? 0), ...(kv !== null ? { pin: kv.pin } : {}) };
}

function kvOptions(expiresAt: number | null, now: number): KVNamespacePutOptions {
  // KV refuses a TTL under 60 seconds; such a page is about to go anyway.
  return expiresAt === null ? {} : { expiration: Math.max(Math.floor(expiresAt / 1000), Math.floor(now / 1000) + 60) };
}

export class StorageUnavailable extends Error {}

const limitHit = (err: unknown) => (err instanceof Error ? err.message : String(err)).includes("limit exceeded");

/**
 * Create a page: R2, then its D1 row, then the KV cache record, then the
 * old KV indexes (best-effort). A failure after the HTML is stored undoes
 * what was written and throws, so no half-made page is left behind; a
 * storage "limit exceeded" becomes StorageUnavailable (503).
 */
export async function createPage(env: PageEnv, page: PageMetadata, html: string, now = Date.now()): Promise<R2Object | null> {
  let htmlObj: R2Object | null;
  try {
    htmlObj = await env.PAGES_BUCKET.put(`pages/${page.id}/index.html`, html, HTML_TYPE);
  } catch (err) {
    if (limitHit(err)) throw new StorageUnavailable(String(err));
    throw err;
  }
  const row = rowFromMetadata(page, null, now);
  try {
    await insertPageRow(env.DB, row);
  } catch (err) {
    await env.PAGES_BUCKET.delete(`pages/${page.id}/index.html`).catch(() => {});
    throw new StorageUnavailable(`pages insert failed: ${String(err)}`);
  }
  try {
    await env.PAGES_KV.put(kvKeys.page(page.id), serializeMetadata(page), kvOptions(row.expiresAt, now));
  } catch (err) {
    await Promise.all([
      env.PAGES_BUCKET.delete(`pages/${page.id}/index.html`).catch(() => {}),
      removePageRow(env.DB, page.id).catch(() => {}),
    ]);
    if (limitHit(err)) throw new StorageUnavailable(String(err));
    throw err;
  }
  if (page.ownerId !== null) await indexForOwner(env.PAGES_KV, page.ownerId, page);
  return htmlObj;
}

/** The old KV owner and project indexes, for a rollback (see the top). Never throws. */
export async function indexForOwner(kv: KVNamespace, ownerId: number, page: PageMetadata): Promise<void> {
  try {
    await addPageToOwner(kv, ownerId, page.id, page.createdAt, page.expiresAt);
    if (page.project !== null) {
      await addPageToOwnerProject(kv, ownerId, page.project, page.id, page.createdAt, page.expiresAt);
      await bumpProjectCount(kv, ownerId, page.project, 1);
    }
  } catch (err) {
    console.error("owner-index write failed", { id: page.id, ownerId, err });
  }
}

/**
 * New HTML for a live page: D1 first (title, size, a fresh expiry unless
 * permanent), then R2, then the KV record rebuilt from the row (so even a
 * missing or stale cache entry comes back right). Returns the new record
 * and the HTML's etag, for the screenshot.
 */
export async function updatePage(
  env: PageEnv,
  page: LoadedPage,
  html: string,
  title: string | null,
  now = Date.now(),
): Promise<{ metadata: PageMetadata; expiresAt: string | null; htmlEtag: string | null }> {
  const { row, kv } = page;
  const expiresAt = row.permanent ? null : now + DEFAULT_TTL * 1000;
  const updated: PageRow = { ...row, title: title ?? row.title, size: new TextEncoder().encode(html).byteLength, expiresAt, updatedAt: now };
  if (!(await updatePageContent(env.DB, row.id, { title: updated.title, size: updated.size, expiresAt }, now))) {
    throw new Error("page was deleted during the update");
  }
  const htmlObj = await env.PAGES_BUCKET.put(`pages/${row.id}/index.html`, html, HTML_TYPE);
  const metadata = cacheRecord(updated, kv);
  await env.PAGES_KV.put(kvKeys.page(row.id), serializeMetadata(metadata), kvOptions(expiresAt, now));
  return { metadata, expiresAt: metadata.expiresAt, htmlEtag: htmlObj?.etag ?? null };
}

/**
 * Delete a page: its HTML and KV record first, then the row is marked
 * deleted. If marking fails this throws, and a retry (the row is still
 * live, so the same token works) finishes the job. Screenshots, the
 * `page_claims` tombstone and the old indexes follow, best-effort.
 */
export async function deletePage(env: PageEnv, page: LoadedPage, now = Date.now()): Promise<void> {
  const { row } = page;
  await Promise.all([env.PAGES_BUCKET.delete(`pages/${row.id}/index.html`), env.PAGES_KV.delete(kvKeys.page(row.id))]);
  await markPageDeleted(env.DB, row.id, now);
  try {
    await forgetShots(env, row.id);
  } catch (err) {
    console.error("screenshot cleanup failed on delete", { id: row.id, err });
  }
  // For a rollback: the old code reads page_claims, and a stale KV copy must
  // not let the page's old token bring it back there either.
  try {
    await tombstoneClaim(env.DB, row.id, now);
  } catch (err) {
    console.error("page_claims tombstone failed", { id: row.id, err });
  }
  if (row.ownerId !== null) {
    const createdAt = new Date(row.createdAt).toISOString();
    try {
      await removePageFromOwner(env.PAGES_KV, row.ownerId, row.id, createdAt);
      if (row.project !== null) {
        await removePageFromOwnerProject(env.PAGES_KV, row.ownerId, row.project, row.id, createdAt);
        await bumpProjectCount(env.PAGES_KV, row.ownerId, row.project, -1);
      }
    } catch (err) {
      console.error("owner-index delete failed", { id: row.id, ownerId: row.ownerId, err });
    }
  }
}

/**
 * Rebuild a live page's KV record from its row (after a claim or a
 * release), keeping the view count and PIN the record has now. Built from
 * the row, not from a KV read, so a stale read can't put an old title or
 * token back. Never throws.
 */
export async function refreshCache(kv: KVNamespace, row: PageRow, now = Date.now()): Promise<void> {
  try {
    if (!isLive(row, now) || (row.expiresAt !== null && row.expiresAt - now < 60_000)) return;
    const raw = await kv.get(kvKeys.page(row.id));
    const current = raw === null ? null : parseMetadata(raw);
    await kv.put(kvKeys.page(row.id), serializeMetadata(cacheRecord(row, current)), kvOptions(row.expiresAt, now));
  } catch (err) {
    console.error("page record refresh failed", { id: row.id, err });
  }
}
