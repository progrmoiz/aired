import { kvKeys, revTs } from '@aired/core';

/**
 * Write an owner→page index entry.
 * If expiresAt is non-null, set an absolute KV expiration matching the page's own expiry.
 * createdAt is used to compute a stable revTs so the key is consistent with the page record.
 */
export async function addPageToOwner(
  kv: KVNamespace,
  ownerId: number,
  pageId: string,
  createdAt: string,
  expiresAt: string | null,
): Promise<void> {
  const ts = revTs(Date.parse(createdAt));
  const key = kvKeys.pagesByOwner(ownerId, ts, pageId);
  const value = JSON.stringify({ expiresAt });

  const options: KVNamespacePutOptions = {};
  if (expiresAt !== null) {
    options.expiration = Math.floor(Date.parse(expiresAt) / 1000);
  }

  await kv.put(key, value, options);
}

/**
 * Delete the owner→page index entry for a given page.
 * createdAt must be the page's original createdAt to reconstruct the correct key.
 */
export async function removePageFromOwner(
  kv: KVNamespace,
  ownerId: number,
  pageId: string,
  createdAt: string,
): Promise<void> {
  const ts = revTs(Date.parse(createdAt));
  const key = kvKeys.pagesByOwner(ownerId, ts, pageId);
  await kv.delete(key);
}

/**
 * List page IDs owned by a given owner, in reverse-chronological order.
 * Returns { ids, cursor } where cursor is null when the list is exhausted.
 */
export async function listPagesForOwner(
  kv: KVNamespace,
  ownerId: number,
  cursor?: string,
  limit?: number,
): Promise<{ ids: string[]; cursor: string | null }> {
  const resolvedLimit = Math.min(limit ?? 20, 50);

  const listOptions: KVNamespaceListOptions = {
    prefix: kvKeys.pagesByOwnerPrefix(ownerId),
    limit: resolvedLimit,
  };
  if (cursor) {
    listOptions.cursor = cursor;
  }

  const list = await kv.list(listOptions);

  const ids: string[] = [];
  for (const entry of list.keys) {
    // Key format: pages_by_owner:<uid>:<rev_ts>:<pageId>
    // Split on ':' and take the last segment
    const segments = entry.name.split(':');
    const pageId = segments[segments.length - 1];
    if (pageId !== undefined) {
      ids.push(pageId);
    }
  }

  return {
    ids,
    cursor: list.list_complete ? null : (list.cursor ?? null),
  };
}
