/**
 * Account deletion: remove everything D1 holds about the user's billing and
 * sign-in. Link (Stripe) keeps its own record of each sale. No imports, so
 * tests run it against the real migrations on node:sqlite.
 */
export async function deleteAccountRows(
  db: D1Database,
  uid: number,
  /**
   * Statements that must commit with the deletion or not at all (the
   * account's pages becoming anonymous). Their results come first in the
   * returned array.
   */
  alongside: D1PreparedStatement[] = [],
): Promise<D1Result[]> {
  // Children before the users row they reference.
  return db.batch([
    ...alongside,
    // API keys stop working with the account.
    db.prepare('DELETE FROM api_keys WHERE user_id = ?').bind(uid),
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
