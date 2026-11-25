/**
 * A global cap on PIN attempts per page, in D1 (migration 0005). The
 * rate-limit bindings count per Cloudflare location, so an attacker spread
 * across many locations gets many budgets; this count is shared.
 *
 * Each attempt reserves a slot first, in one atomic upsert that returns the
 * new count, and only then is the PIN checked. So a burst of parallel guesses
 * can't all pass a stale check: D1 serializes the reservations, and at most
 * PIN_MAX_FAILURES get through per window. A correct PIN gives its slot back,
 * so only wrong PINs use up the budget. After that, PIN entry on the page is
 * refused until the window ends; visitors who already entered the PIN hold a
 * cookie and aren't affected. No imports, so tests run it on node:sqlite.
 */
export const PIN_MAX_FAILURES = 30;
export const PIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

/** Reserve one attempt. False when the page has used up this window's budget. */
export async function reservePinAttempt(db: D1Database, pageId: string, now: number): Promise<boolean> {
  const cutoff = now - PIN_FAILURE_WINDOW_MS;
  const row = await db
    .prepare(
      `INSERT INTO pin_failures (page_id, window_start, failures) VALUES (?, ?, 1)
       ON CONFLICT (page_id) DO UPDATE SET
         failures = CASE WHEN pin_failures.window_start <= ? THEN 1 ELSE pin_failures.failures + 1 END,
         window_start = CASE WHEN pin_failures.window_start <= ? THEN excluded.window_start ELSE pin_failures.window_start END
       RETURNING failures`,
    )
    .bind(pageId, now, cutoff, cutoff)
    .first<{ failures: number }>();
  return row !== null && row.failures <= PIN_MAX_FAILURES;
}

/** Give back the slot a correct PIN reserved. */
export async function releasePinAttempt(db: D1Database, pageId: string): Promise<void> {
  await db
    .prepare('UPDATE pin_failures SET failures = MAX(failures - 1, 0) WHERE page_id = ?')
    .bind(pageId)
    .run();
}
