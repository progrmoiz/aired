/**
 * Account deletion: remove everything D1 holds about the user's billing and
 * sign-in. Link (Stripe) keeps its own record of each sale. No imports, so
 * tests run it against the real migrations on node:sqlite.
 */
export async function deleteAccountRows(db: D1Database, uid: number): Promise<void> {
  // Children before the users row they reference.
  await db.batch([
    db.prepare('DELETE FROM subscriptions WHERE user_id = ?').bind(uid),
    db.prepare('DELETE FROM billing_customers WHERE user_id = ?').bind(uid),
    db.prepare('DELETE FROM identities WHERE user_id = ?').bind(uid),
    db.prepare('DELETE FROM users WHERE id = ?').bind(uid),
  ]);
}

/**
 * Whether Stripe's live subscriptions for the user's customer block account
 * deletion: one that will renew (not set to cancel at period end) would keep
 * charging an account that no longer exists.
 */
export function blocksAccountDeletion(live: ReadonlyArray<{ cancelAtPeriodEnd: boolean }>): boolean {
  return live.some((sub) => !sub.cancelAtPeriodEnd);
}
