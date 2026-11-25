import { kvKeys } from '@aired/core';
import { loadUserRecord } from './user-record.js';
import { decideLink, isGithubId, isGithubNoreply, loginFor, normalizeEmail } from './user-link.js';
import {
  createUser,
  ensureUserRow,
  findIdentityUser,
  findVerifiedEmailOwner,
  linkIdentity,
  userHasIdentities,
} from './users.js';

/**
 * Turn a sign-in into an aired account (blueprint Task 3.1). The decision is
 * lib/user-link.ts; this file does the lookups and writes:
 * - D1 `identities` records which provider identity signs in as which
 *   account, and `users` holds the account row.
 * - KV `user:<id>` is the record sessions, API keys and /api/me read, and
 *   `email:<email>` the GitHub-era index of verified emails.
 */

export type SignedInUser = { id: number; login: string; email: string | null; name: string | null };

type Env = { DB: D1Database; PAGES_KV: KVNamespace };

/** Write KV user:<id>, keeping createdAt. Indexes the email only when verified. */
export async function upsertUserRecord(
  kv: KVNamespace,
  user: SignedInUser,
  emailVerified: boolean,
): Promise<void> {
  const existingRaw = await kv.get(kvKeys.user(user.id));
  let createdAt = new Date().toISOString();
  if (existingRaw !== null) {
    try {
      createdAt = (JSON.parse(existingRaw) as { createdAt?: string }).createdAt ?? createdAt;
    } catch {
      // keep the new createdAt
    }
  }
  await kv.put(
    kvKeys.user(user.id),
    JSON.stringify({ ...user, createdAt, updatedAt: new Date().toISOString() }),
  );
  if (user.email !== null && emailVerified && !isGithubNoreply(user.email)) {
    await kv.put(kvKeys.emailIndex(user.email), String(user.id));
  }
}

export type WorkosProfile = {
  workosUserId: string;
  email: string | null;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
  /**
   * The numeric GitHub id. Only ever from api.github.com/user, read with the
   * provider token WorkOS returned for a GitHub sign-in; never from a field
   * the person signing in can set.
   */
  githubId: number | null;
  /**
   * A GitHub sign-in whose GitHub id couldn't be read: only an existing
   * account may be used (a new one could split a GitHub-era account).
   */
  requireExisting?: boolean;
};

/** resolveWorkosUser found no existing account and wasn't allowed to make one. */
export class NoExistingAccountError extends Error {
  constructor() {
    super('No existing account for this sign-in');
    this.name = 'NoExistingAccountError';
  }
}

/**
 * The account a GitHub-era email index entry points at, if it still holds
 * that email. The index is last-writer-wins and nothing clears it when an
 * address changes, so an entry only counts when the account's own record
 * still says this email and D1 doesn't know the account under other emails.
 */
async function indexedEmailOwner(env: Env, email: string): Promise<number | null> {
  const indexed = Number(await env.PAGES_KV.get(kvKeys.emailIndex(email)));
  if (!Number.isSafeInteger(indexed) || indexed <= 0) return null;
  const record = await loadUserRecord(env.PAGES_KV, indexed);
  if (record === null || normalizeEmail(record.email) !== email) return null;
  // D1 found no identity with this email; if it knows this account by others, the entry is stale.
  if (await userHasIdentities(env.DB, indexed)) return null;
  return indexed;
}

/** The aired account for a WorkOS sign-in, created if needed. */
export async function resolveWorkosUser(env: Env, profile: WorkosProfile): Promise<SignedInUser> {
  const email = normalizeEmail(profile.email);
  const verifiedEmail = profile.emailVerified && email !== null && !isGithubNoreply(email) ? email : null;
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || null;
  const githubId = isGithubId(profile.githubId) ? profile.githubId : null;
  const now = new Date().toISOString();

  const workosIdentityUserId = await findIdentityUser(env.DB, 'workos', profile.workosUserId);
  let githubAccountUserId: number | null = null;
  if (workosIdentityUserId === null && githubId !== null) {
    githubAccountUserId =
      (await findIdentityUser(env.DB, 'github', String(githubId))) ??
      ((await env.PAGES_KV.get(kvKeys.user(githubId))) !== null ? githubId : null);
  }
  let verifiedEmailOwner: number | null = null;
  if (workosIdentityUserId === null && githubAccountUserId === null && verifiedEmail !== null) {
    const owner = await findVerifiedEmailOwner(env.DB, verifiedEmail);
    // Two accounts holding the address is no answer: make a new account.
    if (owner.kind === 'one') verifiedEmailOwner = owner.userId;
    else if (owner.kind === 'none') verifiedEmailOwner = await indexedEmailOwner(env, verifiedEmail);
  }

  const decision = decideLink({
    workosIdentityUserId,
    githubAccountUserId,
    email,
    emailVerified: profile.emailVerified,
    verifiedEmailOwner,
  });

  if (decision.kind === 'new' && profile.requireExisting === true) throw new NoExistingAccountError();

  let user: SignedInUser;
  if (decision.kind === 'existing') {
    // Keep an existing account's login and name (a GitHub login stays), and
    // its email unless WorkOS vouches for the new one.
    const existing = await loadUserRecord(env.PAGES_KV, decision.userId);
    user = {
      id: decision.userId,
      login: existing?.login ?? loginFor(verifiedEmail, name),
      email: verifiedEmail ?? existing?.email ?? null,
      name: existing?.name ?? name,
    };
    await ensureUserRow(env.DB, user, now);
  } else {
    // An unverified address isn't stored as the account's email.
    const login = loginFor(verifiedEmail, name);
    user = { id: await createUser(env.DB, { login, email: verifiedEmail, name }, now), login, email: verifiedEmail, name };
  }

  // The GitHub id signs in as this account the legacy GitHub way too. It goes
  // in before the WorkOS identity: if this fails, nothing ties the WorkOS
  // identity to the account yet, and the next sign-in decides afresh.
  if (githubId !== null && !(decision.kind === 'existing' && decision.via === 'workos')) {
    const githubLinkedTo = await linkIdentity(
      env.DB,
      { provider: 'github', subject: String(githubId), userId: user.id, email, emailVerified: verifiedEmail !== null },
      now,
    );
    if (githubLinkedTo !== user.id) throw new Error('GitHub identity is linked to another account');
  }
  const linkedTo = await linkIdentity(
    env.DB,
    { provider: 'workos', subject: profile.workosUserId, userId: user.id, email, emailVerified: verifiedEmail !== null },
    now,
  );
  // Two first sign-ins racing: the other one linked first. Fail; the retry finds it.
  if (linkedTo !== user.id) throw new Error('WorkOS identity is linked to another account');
  await upsertUserRecord(env.PAGES_KV, user, user.email !== null && user.email === verifiedEmail);
  return user;
}

/**
 * The legacy GitHub sign-in (web and device flow). A GitHub-era account's id
 * is the GitHub id; but when this GitHub identity was first seen through
 * WorkOS it belongs to a newer account, and it signs in as that one.
 * GitHub only returns a verified email (lib/github.ts), so it counts as
 * verified. If D1 can't be read, a GitHub-era account (KV user:<GitHub id>)
 * still signs in as before; anyone else is refused rather than guessed at,
 * since their GitHub id may belong to a newer account.
 */
export async function resolveGithubSignIn(env: Env, gh: SignedInUser): Promise<SignedInUser> {
  if (!isGithubId(gh.id)) throw new Error('GitHub returned no user id');
  const now = new Date().toISOString();
  let accountId: number;
  try {
    accountId = (await findIdentityUser(env.DB, 'github', String(gh.id))) ?? gh.id;
  } catch (err) {
    console.error('Failed to read GitHub identity from D1:', err);
    if ((await env.PAGES_KV.get(kvKeys.user(gh.id))) === null) throw err;
    accountId = gh.id;
  }

  if (accountId !== gh.id) {
    const existing = await loadUserRecord(env.PAGES_KV, accountId);
    const user: SignedInUser = {
      id: accountId,
      login: existing?.login ?? gh.login,
      email: existing?.email ?? gh.email,
      name: existing?.name ?? gh.name,
    };
    if (existing === null) await upsertUserRecord(env.PAGES_KV, user, false);
    return user;
  }

  await upsertUserRecord(env.PAGES_KV, gh, gh.email !== null);
  try {
    await ensureUserRow(env.DB, gh, now);
    await linkIdentity(
      env.DB,
      { provider: 'github', subject: String(gh.id), userId: gh.id, email: gh.email, emailVerified: gh.email !== null },
      now,
    );
  } catch (err) {
    console.error('Failed to record GitHub identity in D1:', err);
  }
  return gh;
}
