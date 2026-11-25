import { kvKeys } from '@aired/core';
import { decideLink, isGithubNoreply, loginFor, normalizeEmail } from './user-link.js';
import { createUser, ensureUserRow, findIdentityUser, findVerifiedEmailOwner, linkIdentity } from './users.js';

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

async function kvUser(kv: KVNamespace, id: number): Promise<{ login?: string; name?: string | null } | null> {
  const raw = await kv.get(kvKeys.user(id));
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as { login?: string; name?: string | null };
  } catch {
    return null;
  }
}

export type WorkosProfile = {
  workosUserId: string;
  email: string | null;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
  /** The numeric GitHub id, when they signed in with GitHub and WorkOS passed it. */
  githubId: number | null;
};

/** The aired account for a WorkOS sign-in, created if needed. */
export async function resolveWorkosUser(env: Env, profile: WorkosProfile): Promise<SignedInUser> {
  const email = normalizeEmail(profile.email);
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || null;
  const now = new Date().toISOString();

  const workosIdentityUserId = await findIdentityUser(env.DB, 'workos', profile.workosUserId);
  let githubAccountExists = false;
  if (workosIdentityUserId === null && profile.githubId !== null) {
    githubAccountExists =
      (await findIdentityUser(env.DB, 'github', String(profile.githubId))) !== null ||
      (await env.PAGES_KV.get(kvKeys.user(profile.githubId))) !== null;
  }
  let verifiedEmailOwner: number | null = null;
  if (workosIdentityUserId === null && !githubAccountExists && profile.emailVerified && email !== null && !isGithubNoreply(email)) {
    verifiedEmailOwner = await findVerifiedEmailOwner(env.DB, email);
    if (verifiedEmailOwner === null) {
      const indexed = Number(await env.PAGES_KV.get(kvKeys.emailIndex(email)));
      if (Number.isSafeInteger(indexed) && indexed > 0) verifiedEmailOwner = indexed;
    }
  }

  const decision = decideLink({
    workosIdentityUserId,
    githubId: profile.githubId,
    githubAccountExists,
    email,
    emailVerified: profile.emailVerified,
    verifiedEmailOwner,
  });

  let user: SignedInUser;
  if (decision.kind === 'existing') {
    // Keep an existing account's login and name (a GitHub login stays).
    const existing = await kvUser(env.PAGES_KV, decision.userId);
    user = {
      id: decision.userId,
      login: existing?.login ?? loginFor(email, name),
      email: email ?? null,
      name: existing?.name ?? name,
    };
    await ensureUserRow(env.DB, user, now);
  } else {
    const login = loginFor(email, name);
    user = { id: await createUser(env.DB, { login, email, name }, now), login, email, name };
  }

  await linkIdentity(
    env.DB,
    { provider: 'workos', subject: profile.workosUserId, userId: user.id, email, emailVerified: profile.emailVerified },
    now,
  );
  // A GitHub id seen through WorkOS also signs in the legacy GitHub way.
  if (profile.githubId !== null && (decision.kind === 'new' || (decision.kind === 'existing' && decision.via === 'github'))) {
    await linkIdentity(
      env.DB,
      { provider: 'github', subject: String(profile.githubId), userId: user.id, email, emailVerified: profile.emailVerified },
      now,
    );
  }
  await upsertUserRecord(env.PAGES_KV, user, profile.emailVerified);
  return user;
}

/**
 * The legacy GitHub sign-in: the account id is the GitHub id. Records the
 * identity in D1 so a later WorkOS sign-in links to it. GitHub only returns a
 * verified primary email (lib/github.ts), so the email counts as verified.
 */
export async function recordGithubSignIn(env: Env, user: SignedInUser): Promise<void> {
  const now = new Date().toISOString();
  await ensureUserRow(env.DB, user, now);
  await linkIdentity(
    env.DB,
    { provider: 'github', subject: String(user.id), userId: user.id, email: user.email, emailVerified: user.email !== null },
    now,
  );
}
