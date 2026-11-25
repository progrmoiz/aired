/**
 * A global cap on wrong PIN entries per page, in D1 (migration 0005). The
 * rate-limit bindings count per Cloudflare location, so an attacker spread
 * across many locations gets many budgets; this count is shared. After
 * PIN_MAX_FAILURES wrong entries in PIN_FAILURE_WINDOW_MS, PIN entry on that
 * page is refused until the window ends. Visitors who already entered the PIN
 * hold a cookie and aren't affected. No imports, so tests run it on node:sqlite.
 */
export const PIN_MAX_FAILURES = 30;
export const PIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

/** Whether PIN entry on this page is locked right now. */
export async function pinEntryLocked(db: D1Database, pageId: string, now: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT window_start, failures FROM pin_failures WHERE page_id = ?')
    .bind(pageId)
    .first<{ window_start: number; failures: number }>();
  return row !== null && row.window_start > now - PIN_FAILURE_WINDOW_MS && row.failures >= PIN_MAX_FAILURES;
}

/** Count one wrong entry, starting a new window if the last one has ended. */
export async function recordPinFailure(db: D1Database, pageId: string, now: number): Promise<void> {
  const cutoff = now - PIN_FAILURE_WINDOW_MS;
  await db
    .prepare(
      `INSERT INTO pin_failures (page_id, window_start, failures) VALUES (?, ?, 1)
       ON CONFLICT (page_id) DO UPDATE SET
         failures = CASE WHEN pin_failures.window_start <= ? THEN 1 ELSE pin_failures.failures + 1 END,
         window_start = CASE WHEN pin_failures.window_start <= ? THEN excluded.window_start ELSE pin_failures.window_start END`,
    )
    .bind(pageId, now, cutoff, cutoff)
    .run();
}
