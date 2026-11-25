/**
 * Deletes the R2 files of expired pages. A page's KV record expires with the
 * page, but nothing removed its file in R2 (`pages/<id>/index.html`). This
 * walks the bucket a little at a time (Cron Trigger, see index.ts) and
 * deletes a file only when it was last written more than SWEEP_GRACE_MS ago
 * and its KV page record is definitely gone. A KV error means "keep".
 * No runtime imports, so tests run it with fakes.
 */

/** Objects looked at per run: a few dozen KV reads and one R2 delete. */
export const SWEEP_BATCH = 40;

/**
 * A file must be this old before it can go. KV is eventually consistent for
 * about a minute after a write, and every publish or update rewrites the
 * file, so a live page's file is either newer than this or has a KV record.
 */
export const SWEEP_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const PAGE_FILE = /^pages\/([A-Za-z0-9_-]{1,64})\/index\.html$/;

/** The page id of a page file key, or null for anything else in the bucket. */
export function pageIdFromKey(key: string): string | null {
  return PAGE_FILE.exec(key)?.[1] ?? null;
}

export type SweepDeps = {
  list: (cursor: string | null, limit: number) => Promise<{
    objects: Array<{ key: string; uploaded: Date }>;
    truncated: boolean;
    cursor: string | null;
  }>;
  /** True if `page:<id>` exists in KV. Throws on a KV error. */
  pageExists: (id: string) => Promise<boolean>;
  deleteKeys: (keys: string[]) => Promise<void>;
  loadCursor: () => Promise<string | null>;
  saveCursor: (cursor: string | null) => Promise<void>;
  log?: (entry: Record<string, unknown>) => void;
};

export async function sweepExpiredPages(
  deps: SweepDeps,
  now: number,
): Promise<{ scanned: number; deleted: string[] }> {
  const page = await deps.list(await deps.loadCursor(), SWEEP_BATCH);
  const doomed: string[] = [];
  for (const obj of page.objects) {
    const id = pageIdFromKey(obj.key);
    if (id === null) continue;
    if (now - obj.uploaded.getTime() < SWEEP_GRACE_MS) continue;
    let exists: boolean;
    try {
      exists = await deps.pageExists(id);
    } catch (err) {
      deps.log?.({ event: 'expired_sweep_kv_error', id, err: String(err) });
      continue;
    }
    if (!exists) doomed.push(obj.key);
  }
  if (doomed.length > 0) await deps.deleteKeys(doomed);
  // End of the bucket: start over next run.
  await deps.saveCursor(page.truncated ? page.cursor : null);
  return { scanned: page.objects.length, deleted: doomed };
}
