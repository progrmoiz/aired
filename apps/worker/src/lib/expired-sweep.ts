/**
 * Deletes the R2 files of expired pages. A page's KV record expires with the
 * page, but nothing removed its files in R2 (`pages/<id>/index.html` and its
 * screenshots `pages/<id>/shot.jpg` and `tile.jpg`). A Cron Trigger
 * (index.ts) walks the bucket a batch at a time; each file is judged on its
 * own. When the HTML goes, index.ts also drops the page's page_shots row.
 *
 * A file is deleted only when its page is live neither in D1 `pages` nor in
 * KV, and its KV page record has been seen missing on two
 * runs at least CONFIRM_AFTER_MS apart, with the file unchanged in between
 * (same etag). An update needs the KV record to exist, so once it has been
 * gone that long nothing can rewrite the file under us, and KV's ~60s lag
 * can't make a live page look expired twice a day apart. A KV error keeps
 * the file.
 *
 * Before a file is deleted it is copied to the backup bucket (`trash/`, kept
 * 14 days; docs/backups.md), and only files whose copy succeeded are
 * deleted. So even a KV record lost by mistake, which the rule above would
 * read as an expiry, leaves the page recoverable. No runtime imports, so
 * tests run it with fakes.
 */

/** Objects looked at per run: one KV read each, plus a handful of D1/R2 calls. */
export const SWEEP_BATCH = 40;

/** Don't even look at files written in the last day. */
export const SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** How long a file's KV record must stay missing before the file goes. */
export const CONFIRM_AFTER_MS = 24 * 60 * 60 * 1000;

// Version files (lib/page-versions.ts) too: housekeeping removes them by their
// D1 rows, and this catches any a failed write left behind.
const PAGE_FILE = /^pages\/([A-Za-z0-9_-]{1,64})\/(?:index\.html|shot\.jpg|tile\.jpg|doc\.json|versions\/[0-9a-f]{24}\.(?:html|doc\.json))$/;

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
  /**
   * Which of these pages D1 `pages` has as live (lib/pages-store.ts). A
   * file of one of them is kept without asking KV. Throws on a D1 error,
   * and the sweep then goes by KV alone.
   */
  livePages?: (ids: string[]) => Promise<Set<string>>;
  /**
   * Copy these files to the backup bucket, each only if it still has this
   * etag. Returns the keys that are safely copied (or already gone).
   */
  preserve: (files: Array<{ key: string; etag: string }>) => Promise<string[]>;
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
  // A file goes only if neither D1 nor KV has its page as live.
  let liveInD1 = new Set<string>();
  if (deps.livePages && files.length > 0) {
    try {
      liveInD1 = await deps.livePages([...new Set(files.map((f) => pageIdFromKey(f.key)!))]);
    } catch (err) {
      deps.log?.({ event: 'expired_sweep_d1_error', err: String(err) });
    }
  }

  const doomed: Array<{ key: string; etag: string }> = [];
  const put = new Map<string, Candidate>();
  const drop: string[] = [];
  for (const file of files) {
    let exists: boolean;
    try {
      exists = liveInD1.has(pageIdFromKey(file.key)!) || (await deps.pageExists(pageIdFromKey(file.key)!));
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
      if (now - seen.firstSeen >= CONFIRM_AFTER_MS) doomed.push({ key: file.key, etag: file.etag });
      continue; // still waiting: keep the original first sighting
    }
    put.set(file.key, { etag: file.etag, firstSeen: now }); // new, or the file changed
  }

  // Only what made it into the backup bucket is deleted; the rest keep
  // their mark and are tried again next pass.
  let deleted: string[] = [];
  if (doomed.length > 0) {
    let copied: Set<string>;
    try {
      copied = new Set(await deps.preserve(doomed));
    } catch (err) {
      deps.log?.({ event: 'expired_sweep_preserve_failed', count: doomed.length, err: String(err) });
      copied = new Set();
    }
    deleted = doomed.filter((d) => copied.has(d.key)).map((d) => d.key);
    if (deleted.length < doomed.length) {
      deps.log?.({ event: 'expired_sweep_kept_uncopied', count: doomed.length - deleted.length });
    }
    if (deleted.length > 0) await deps.deleteKeys(deleted);
  }
  if (put.size > 0 || deleted.length > 0 || drop.length > 0) {
    await deps.saveCandidates(put, [...drop, ...deleted]);
  }
  await deps.saveCursor(page.truncated ? page.cursor : null, !page.truncated);
  return { scanned: page.objects.length, deleted, marked: put.size };
}
