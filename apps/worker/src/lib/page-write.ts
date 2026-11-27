import { DEFAULT_TTL, kvKeys, parseMetadata, serializeMetadata } from "@aired/core";
import type { PageMetadata } from "@aired/core";
import {
  getPageRow,
  insertPageRow,
  isLive,
  markPageDeleted,
  metadataFromRow,
  removePageRow,
  resolvePage,
  rowFromMetadata,
  updatePageContent,
  updatePageOptions,
  type PageOptionsColumns,
  type PageRow,
} from "./pages-store.ts";
import { forgetShots } from "./og-render.js";
import { isPinHash } from "./pin-hash.js";
import { sidecarKey, writeSidecar, type DocSidecar } from "./page-content.ts";
import { deletePageCollectData } from "./collect-store.ts";
import { deletePageAccessData } from "./access-store.ts";

/**
 * The one way every route creates, updates, deletes or looks up a page
 * (routes/api.ts publish, PUT, PATCH and DELETE, and the anonymous MCP tool in
 * routes/mcp.ts). D1 `pages` is written first and decides; then R2 holds
 * the HTML and KV `page:<id>` the viewer's cached copy.
 *
 * The KV owner and project indexes (`pages_by_owner:`,
 * `pages_by_owner_project:`, `projects_by_owner:`) and D1 `page_claims` are
 * no longer written: D1 `pages` replaced them, and nothing reads them for
 * decisions. Rolling back past this needs the old keys rebuilt
 * (docs/pages-in-d1.md, "Retiring the old copies").
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
 * Create a page: its D1 row, then R2, then the KV cache record. A failure undoes what was written and throws, so
 * no half-made page is left behind; a storage failure or "limit exceeded"
 * becomes StorageUnavailable (503). The row goes first so an id that is
 * somehow taken fails before anything of the other page is overwritten.
 */
export async function createPage(
  env: PageEnv,
  page: PageMetadata,
  html: string,
  now = Date.now(),
  /** Markdown source or deck notes, kept beside the HTML (lib/page-content.ts). */
  sidecar: DocSidecar | null = null,
): Promise<R2Object | null> {
  const row = rowFromMetadata(page, null, now);
  let inserted: boolean;
  try {
    inserted = await insertPageRow(env.DB, row);
  } catch (err) {
    throw new StorageUnavailable(`pages insert failed: ${String(err)}`);
  }
  if (!inserted) throw new Error(`page id ${page.id} is already taken`);
  let htmlObj: R2Object | null;
  try {
    htmlObj = await env.PAGES_BUCKET.put(`pages/${page.id}/index.html`, html, HTML_TYPE);
    if (sidecar !== null) await writeSidecar(env.PAGES_BUCKET, page.id, sidecar);
  } catch (err) {
    await Promise.all([
      env.PAGES_BUCKET.delete([`pages/${page.id}/index.html`, sidecarKey(page.id)]).catch(() => {}),
      removePageRow(env.DB, page.id).catch(() => {}),
    ]);
    if (limitHit(err)) throw new StorageUnavailable(String(err));
    throw err;
  }
  try {
    await env.PAGES_KV.put(kvKeys.page(page.id), serializeMetadata(page), kvOptions(row.expiresAt, now));
  } catch (err) {
    await Promise.all([
      env.PAGES_BUCKET.delete([`pages/${page.id}/index.html`, sidecarKey(page.id)]).catch(() => {}),
      removePageRow(env.DB, page.id).catch(() => {}),
    ]);
    if (limitHit(err)) throw new StorageUnavailable(String(err));
    throw err;
  }
  return htmlObj;
}

/**
 * New HTML for a live page: D1 first (title, size, a fresh expiry unless
 * permanent), then R2, then the KV record rebuilt from the row (so even a
 * missing or stale cache entry comes back right). Returns the new record
 * and the HTML's etag, for the screenshot.
 *
 * The row is read again after the writes. If a delete marked it in the
 * meantime, what this update wrote is removed again, so a deleted page
 * can't come back. If a claim changed its owner or token, the KV record is
 * rebuilt from the row as it is now.
 */
export async function updatePage(
  env: PageEnv,
  page: LoadedPage,
  html: string,
  title: string | null,
  now = Date.now(),
  /** The new content's sidecar; null removes an old one (lib/page-content.ts). */
  sidecar: DocSidecar | null = null,
): Promise<{ metadata: PageMetadata; expiresAt: string | null; htmlEtag: string | null }> {
  const { row, kv } = page;
  const expiresAt = row.permanent ? null : now + DEFAULT_TTL * 1000;
  const updated: PageRow = { ...row, title: title ?? row.title, size: new TextEncoder().encode(html).byteLength, expiresAt, updatedAt: now };
  if (!(await updatePageContent(env.DB, row.id, { title: updated.title, size: updated.size, expiresAt }, now))) {
    throw new Error("page was deleted during the update");
  }
  const htmlObj = await env.PAGES_BUCKET.put(`pages/${row.id}/index.html`, html, HTML_TYPE);
  await writeSidecar(env.PAGES_BUCKET, row.id, sidecar);
  const metadata = cacheRecord(updated, kv);
  await env.PAGES_KV.put(kvKeys.page(row.id), serializeMetadata(metadata), kvOptions(expiresAt, now));

  const after = await getPageRow(env.DB, row.id);
  if (after === null || after.deletedAt !== null) {
    await removeContent(env, row.id);
    throw new Error("page was deleted during the update");
  }
  if (after.ownerId !== updated.ownerId || after.tokenHash !== updated.tokenHash) await refreshCache(env.PAGES_KV, after, now);
  return { metadata, expiresAt: metadata.expiresAt, htmlEtag: htmlObj?.etag ?? null };
}

/**
 * New settings for a live page (set_options, PATCH /api/pages/:id). D1
 * first, writing only the columns that change; then the row is read back
 * and the KV record rebuilt from it, so the viewer sees the new PIN, view
 * limit, title and expiry, and a concurrent change to another setting
 * isn't undone. The PIN comes from the row too, never from a possibly
 * stale KV copy, except a PIN still stored as typed in KV that the viewer
 * hasn't rehashed yet. The HTML in R2 is left alone.
 *
 * As in updatePage, the row is read again after the KV write: if a delete
 * marked it in between, the record is removed again. Throws PageGone when
 * the page was deleted or expired before the write.
 */
export class PageGone extends Error {}

export async function setPageOptions(
  env: PageEnv,
  page: LoadedPage,
  change: PageOptionsColumns,
  now = Date.now(),
): Promise<{ row: PageRow; metadata: PageMetadata }> {
  const { row, kv } = page;
  if (!(await updatePageOptions(env.DB, row.id, change, now))) throw new PageGone("page was deleted or expired");
  const written = await getPageRow(env.DB, row.id);
  if (written === null || !isLive(written, now)) throw new PageGone("page was deleted during the change");
  const legacyPin = change.pin === undefined && kv !== null && kv.pin !== null && !isPinHash(kv.pin) ? kv.pin : null;
  const record = (r: PageRow): PageMetadata => ({ ...metadataFromRow(r, kv?.readCount ?? 0), ...(legacyPin !== null ? { pin: legacyPin } : {}) });
  const metadata = record(written);
  await env.PAGES_KV.put(kvKeys.page(row.id), serializeMetadata(metadata), kvOptions(written.expiresAt, now));

  const after = await getPageRow(env.DB, row.id);
  if (after === null || after.deletedAt !== null) {
    await env.PAGES_KV.delete(kvKeys.page(row.id)).catch(() => {});
    throw new PageGone("page was deleted during the change");
  }
  // Something else changed the row meanwhile (another set_options, a claim):
  // the record follows the row as it is now.
  if (after.updatedAt !== written.updatedAt && isLive(after, now)) {
    await env.PAGES_KV.put(kvKeys.page(row.id), serializeMetadata(record(after)), kvOptions(after.expiresAt, now));
  }
  return { row: after, metadata };
}

/** A page's HTML, its sidecar and KV record, a few tries before giving up. */
async function removeContent(env: PageEnv, id: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await Promise.all([env.PAGES_BUCKET.delete([`pages/${id}/index.html`, sidecarKey(id)]), env.PAGES_KV.delete(kvKeys.page(id))]);
      return;
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
}

/**
 * Delete a page. The row is marked deleted first, so from then on no token
 * works and no update can bring it back (updatePage re-checks). Then its
 * HTML and KV record go; if that keeps failing, it's handed to `later`
 * (waitUntil) and logged, since the page is already deleted for every API.
 * Screenshots follow, best-effort. Throws only if the row can't be marked:
 * nothing has changed then, and a retry works.
 */
export async function deletePage(env: PageEnv, page: LoadedPage, later: (work: Promise<unknown>) => void, now = Date.now()): Promise<void> {
  const { row } = page;
  await markPageDeleted(env.DB, row.id, now);
  try {
    await removeContent(env, row.id);
  } catch (err) {
    console.error({ event: "page_delete_cleanup_retry", id: row.id, error: String(err) });
    later(
      new Promise((r) => setTimeout(r, 5_000))
        .then(() => removeContent(env, row.id))
        .catch((e) => console.error({ event: "page_delete_cleanup_failed", id: row.id, error: String(e) })),
    );
  }
  try {
    await forgetShots(env, row.id);
  } catch (err) {
    console.error("screenshot cleanup failed on delete", { id: row.id, err });
  }
  // What viewers saved and the live data go too. If this fails, hourly
  // housekeeping deletes them (lib/collect-store.ts pruneCollectData).
  try {
    await deletePageCollectData(env.DB, row.id);
  } catch (err) {
    console.error("collect data cleanup failed on delete", { id: row.id, err });
  }
  // Its "only these people" list, codes and visit log. Housekeeping catches a failure here too.
  try {
    await deletePageAccessData(env.DB, row.id);
  } catch (err) {
    console.error("access data cleanup failed on delete", { id: row.id, err });
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
