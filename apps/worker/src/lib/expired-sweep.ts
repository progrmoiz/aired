/**
 * Deletes the R2 files of expired pages. A page's KV record expires with the
 * page, but nothing removed its files in R2 (`pages/<id>/index.html` and its
 * link-preview screenshot `pages/<id>/shot.jpg`). A Cron Trigger (index.ts)
 * walks the bucket a batch at a time; each file is judged on its own.
 *
 * A file is deleted only when its KV page record has been seen missing on two
 * runs at least CONFIRM_AFTER_MS apart, with the file unchanged in between
 * (same etag). An update needs the KV record to exist, so once it has been
 * gone that long nothing can rewrite the file under us, and KV's ~60s lag
 * can't make a live page look expired twice a day apart. A KV error keeps
 * the file. No runtime imports, so tests run it with fakes.
 */

/** Objects looked at per run: one KV read each, plus a handful of D1/R2 calls. */
export const SWEEP_BATCH = 40;

/** Don't even look at files written in the last day. */
export const SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** How long a file's KV record must stay missing before the file goes. */
export const CONFIRM_AFTER_MS = 24 * 60 * 60 * 1000;

const PAGE_FILE = /^pages\/([A-Za-z0-9_-]{1,64})\/(?:index\.html|shot\.jpg)$/;

/** The page id of a page file key (HTML or screenshot), or null for anything else. */
export function pageIdFromKey(key: string): string | null {
  return PAGE_FILE.exec(key)?.[1] ?? null;
}

export type Candidate = { etag: string; firstSeen: number };

export type SweepDeps = {
  list: (cursor: string | null, limit: number) => Promise<{
    objects: Array<{ key: string; uploaded: Date; etag: string }>;
    truncated: boolean;
    cursor: string | null;
  }>;
  /** True if the page's KV record exists. Throws on a KV error. */
  pageExists: (id: string) => Promise<boolean>;
  deleteKeys: (keys: string[]) => Promise<void>;
  loadCursor: () => Promise<string | null>;
  /** `passDone` when the walk reached the end of the bucket. */
  saveCursor: (cursor: string | null, passDone: boolean) => Promise<void>;
  loadCandidates: (keys: string[]) => Promise<Map<string, Candidate>>;
  /** Upsert `put` and remove `drop` (deleted files and files found live). */
  saveCandidates: (put: Map<string, Candidate>, drop: string[]) => Promise<void>;
  log?: (entry: Record<string, unknown>) => void;
};

export async function sweepExpiredPages(
  deps: SweepDeps,
  now: number,
): Promise<{ scanned: number; deleted: string[]; marked: number }> {
  const page = await deps.list(await deps.loadCursor(), SWEEP_BATCH);
  const files = page.objects.filter(
    (o) => pageIdFromKey(o.key) !== null && now - o.uploaded.getTime() >= SWEEP_MIN_AGE_MS,
  );
  const known = await deps.loadCandidates(files.map((f) => f.key));

  const doomed: string[] = [];
  const put = new Map<string, Candidate>();
  const drop: string[] = [];
  for (const file of files) {
    let exists: boolean;
    try {
      exists = await deps.pageExists(pageIdFromKey(file.key)!);
    } catch (err) {
      deps.log?.({ event: 'expired_sweep_kv_error', key: file.key, err: String(err) });
      continue;
    }
    const seen = known.get(file.key);
    if (exists) {
      if (seen) drop.push(file.key);
      continue;
    }
    if (seen && seen.etag === file.etag) {
      if (now - seen.firstSeen >= CONFIRM_AFTER_MS) doomed.push(file.key);
      continue; // still waiting: keep the original first sighting
    }
    put.set(file.key, { etag: file.etag, firstSeen: now }); // new, or the file changed
  }

  if (doomed.length > 0) await deps.deleteKeys(doomed);
  if (put.size > 0 || doomed.length > 0 || drop.length > 0) {
    await deps.saveCandidates(put, [...drop, ...doomed]);
  }
  await deps.saveCursor(page.truncated ? page.cursor : null, !page.truncated);
  return { scanned: page.objects.length, deleted: doomed, marked: put.size };
}
