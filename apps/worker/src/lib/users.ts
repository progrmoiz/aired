/**
 * Accounts and sign-in identities in D1 (migrations 0001 and 0007). Only type
 * imports, so tests run this against the real migrations on node:sqlite.
 * GitHub-era accounts keep their GitHub id as the account id; accounts made
 * through WorkOS get ids from the users sequence, which starts at 10^12.
 */

export type IdentityProvider = 'github' | 'workos';

export async function findIdentityUser(
  db: D1Database,
  provider: IdentityProvider,
  subject: string,
): Promise<number | null> {
  const row = await db
    .prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?')
    .bind(provider, subject)
    .first<{ user_id: number }>();
  return row?.user_id ?? null;
}

/** The account holding this verified email in D1, if exactly one does. */
export async function findVerifiedEmailOwner(db: D1Database, email: string): Promise<number | null> {
  const { results } = await db
    .prepare('SELECT DISTINCT user_id FROM identities WHERE email = ? AND email_verified = 1 LIMIT 2')
    .bind(email)
    .all<{ user_id: number }>();
  return results.length === 1 ? results[0]!.user_id : null;
}

/** Make sure a users row exists for this id (GitHub-era accounts). */
export async function ensureUserRow(
  db: D1Database,
  user: { id: number; login: string; email: string | null; name: string | null },
  now: string,
): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO users (id, email, name, login, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(user.id, user.email, user.name, user.login, now)
    .run();
}

/** A new account with an id from the sequence (10^12 and up). */
export async function createUser(
  db: D1Database,
  user: { login: string; email: string | null; name: string | null },
  now: string,
): Promise<number> {
  const row = await db
    .prepare('INSERT INTO users (email, name, login, created_at) VALUES (?, ?, ?, ?) RETURNING id')
    .bind(user.email, user.name, user.login, now)
    .first<{ id: number }>();
  if (row === null) throw new Error('users insert returned no id');
  return row.id;
}

/** Record that this provider identity signs in as this account. Idempotent. */
export async function linkIdentity(
  db: D1Database,
  identity: { provider: IdentityProvider; subject: string; userId: number; email: string | null; emailVerified: boolean },
  now: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO identities (provider, subject, user_id, email, email_verified, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (provider, subject) DO UPDATE SET email = excluded.email, email_verified = excluded.email_verified`,
    )
    .bind(identity.provider, identity.subject, identity.userId, identity.email, identity.emailVerified ? 1 : 0, now)
    .run();
}
