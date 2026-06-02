import { kvKeys, revTs } from '@aired/core';

/** One owner's project manifest: a map of project name → page count. */
type ProjectManifest = Record<string, number>;

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

/**
 * Write an owner+project→page index entry. Mirrors addPageToOwner: stable revTs
 * from createdAt, absolute KV expiration matching the page's own expiry.
 */
export async function addPageToOwnerProject(
  kv: KVNamespace,
  ownerId: number,
  project: string,
  pageId: string,
  createdAt: string,
  expiresAt: string | null,
): Promise<void> {
  const ts = revTs(Date.parse(createdAt));
  const key = kvKeys.pagesByOwnerProject(ownerId, project, ts, pageId);
  const value = JSON.stringify({ expiresAt });

  const options: KVNamespacePutOptions = {};
  if (expiresAt !== null) {
    options.expiration = Math.floor(Date.parse(expiresAt) / 1000);
  }

  await kv.put(key, value, options);
}

/**
 * Delete the owner+project→page index entry for a given page.
 * createdAt and project must match the originals to reconstruct the key.
 */
export async function removePageFromOwnerProject(
  kv: KVNamespace,
  ownerId: number,
  project: string,
  pageId: string,
  createdAt: string,
): Promise<void> {
  const ts = revTs(Date.parse(createdAt));
  const key = kvKeys.pagesByOwnerProject(ownerId, project, ts, pageId);
  await kv.delete(key);
}

/**
 * List page IDs owned by a given owner within a single project, reverse-chronological.
 * Returns { ids, cursor } where cursor is null when the list is exhausted.
 */
export async function listPagesForOwnerProject(
  kv: KVNamespace,
  ownerId: number,
  project: string,
  cursor?: string,
  limit?: number,
): Promise<{ ids: string[]; cursor: string | null }> {
  const resolvedLimit = Math.min(limit ?? 20, 50);

  const listOptions: KVNamespaceListOptions = {
    prefix: kvKeys.pagesByOwnerProjectPrefix(ownerId, project),
    limit: resolvedLimit,
  };
  if (cursor) {
    listOptions.cursor = cursor;
  }

  const list = await kv.list(listOptions);

  const ids: string[] = [];
  for (const entry of list.keys) {
    // Key format: pages_by_owner_project:<uid>:<encProject>:<rev_ts>:<pageId>
    // pageId is the last ':'-segment (encProject is encodeURIComponent-escaped, so colon-free)
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

/**
 * Adjust an owner's per-project page count by delta (read-modify-write).
 * Removes the entry when the count reaches zero; never stores a negative count.
 * Best-effort accounting — the project index is the source of truth for rows.
 */
export async function bumpProjectCount(
  kv: KVNamespace,
  ownerId: number,
  project: string,
  delta: number,
): Promise<void> {
  const key = kvKeys.projectsByOwner(ownerId);
  const raw = await kv.get(key);

  let manifest: ProjectManifest = {};
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        manifest = parsed as ProjectManifest;
      }
    } catch {
      // corrupt manifest — rebuild from this delta
      manifest = {};
    }
  }

  const current = typeof manifest[project] === 'number' ? manifest[project] : 0;
  const next = current + delta;
  if (next > 0) {
    manifest[project] = next;
  } else {
    delete manifest[project];
  }

  if (Object.keys(manifest).length === 0) {
    await kv.delete(key);
  } else {
    await kv.put(key, JSON.stringify(manifest));
  }
}

/**
 * Return an owner's distinct projects with counts, sorted by count desc then name asc.
 * Reads the manifest record; returns [] when none.
 */
export async function listProjectsForOwner(
  kv: KVNamespace,
  ownerId: number,
): Promise<Array<{ name: string; count: number }>> {
  const raw = await kv.get(kvKeys.projectsByOwner(ownerId));
  if (raw === null) return [];

  let manifest: ProjectManifest = {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      manifest = parsed as ProjectManifest;
    }
  } catch {
    return [];
  }

  return Object.entries(manifest)
    .filter(([, count]) => typeof count === 'number' && count > 0)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
}
