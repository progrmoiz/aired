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

export type EmailOwner = { kind: 'none' } | { kind: 'one'; userId: number } | { kind: 'ambiguous' };

/**
 * Who holds this verified email in D1. "ambiguous" (two or more accounts) is
 * its own answer, so a caller can't mistake it for "nobody" and look elsewhere.
 */
export async function findVerifiedEmailOwner(db: D1Database, email: string): Promise<EmailOwner> {
  const { results } = await db
    .prepare('SELECT DISTINCT user_id FROM identities WHERE lower(email) = ? AND email_verified = 1 LIMIT 2')
    .bind(email.trim().toLowerCase())
    .all<{ user_id: number }>();
  if (results.length === 0) return { kind: 'none' };
  if (results.length > 1) return { kind: 'ambiguous' };
  return { kind: 'one', userId: results[0]!.user_id };
}

/** Whether D1 has any sign-in identity for this account. */
export async function userHasIdentities(db: D1Database, userId: number): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS x FROM identities WHERE user_id = ? LIMIT 1').bind(userId).first<{ x: number }>();
  return row !== null;
}

/** Every email this account's identities carry (lower-cased), for account deletion. */
export async function identityEmails(db: D1Database, userId: number): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT DISTINCT lower(email) AS email FROM identities WHERE user_id = ? AND email IS NOT NULL')
    .bind(userId)
    .all<{ email: string }>();
  return results.map((r) => r.email);
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

/**
 * Record that this provider identity signs in as this account. Idempotent.
 * Stores the email lower-cased. Returns the account the identity belongs to:
 * when it was already linked to another account, that one, and the caller
 * must not sign in as the account it asked for.
 */
export async function linkIdentity(
  db: D1Database,
  identity: { provider: IdentityProvider; subject: string; userId: number; email: string | null; emailVerified: boolean },
  now: string,
): Promise<number> {
  const email = identity.email?.trim().toLowerCase() || null;
  const row = await db
    .prepare(
      `INSERT INTO identities (provider, subject, user_id, email, email_verified, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (provider, subject) DO UPDATE SET email = excluded.email, email_verified = excluded.email_verified
       RETURNING user_id`,
    )
    .bind(identity.provider, identity.subject, identity.userId, email, identity.emailVerified ? 1 : 0, now)
    .first<{ user_id: number }>();
  if (row === null) throw new Error('identities upsert returned no row');
  return row.user_id;
}
