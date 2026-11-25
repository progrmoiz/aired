/**
 * Which aired account a WorkOS sign-in belongs to (blueprint Phase 3, Task
 * 3.1). Pure, so tests import it; the lookups happen in lib/resolve-user.ts.
 *
 * In this order, first match wins:
 * 1. The WorkOS user already has an identity row: that account.
 * 2. They signed in with GitHub and WorkOS passed the GitHub id: the account
 *    that GitHub id already signs in as (its identity row, else the
 *    GitHub-era account whose id is the GitHub id).
 * 3. WorkOS says the email is verified, it isn't a GitHub noreply address,
 *    and an existing account holds the same verified email: that account.
 * 4. Otherwise a new account.
 *
 * An unverified email never links: anyone can type an address into a sign-in
 * form, and linking on it would hand them someone else's pages.
 */

export type LinkInput = {
  /** Account id from identities(workos, <WorkOS user id>), if any. */
  workosIdentityUserId: number | null;
  /** The account that GitHub id already signs in as, if any. */
  githubAccountUserId: number | null;
  email: string | null;
  emailVerified: boolean;
  /** The account holding this email as a verified address, if any. */
  verifiedEmailOwner: number | null;
};

export type LinkDecision =
  | { kind: 'existing'; userId: number; via: 'workos' | 'github' | 'email' }
  | { kind: 'new' };

/** Ids from the users sequence start here; real GitHub ids are far below it. */
export const NEW_ACCOUNT_ID_START = 1_000_000_000_000;

/** A plausible GitHub user id: a positive integer below the new-account range. */
export function isGithubId(id: unknown): id is number {
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 && id < NEW_ACCOUNT_ID_START;
}

export function isGithubNoreply(email: string | null): boolean {
  return email !== null && /@users\.noreply\.github\.com$/i.test(email.trim());
}

/** A trimmed, lower-cased email, or null. */
export function normalizeEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e ? e : null;
}

export function decideLink(input: LinkInput): LinkDecision {
  if (input.workosIdentityUserId !== null) {
    return { kind: 'existing', userId: input.workosIdentityUserId, via: 'workos' };
  }
  if (input.githubAccountUserId !== null) {
    return { kind: 'existing', userId: input.githubAccountUserId, via: 'github' };
  }
  if (
    input.emailVerified &&
    input.email !== null &&
    !isGithubNoreply(input.email) &&
    input.verifiedEmailOwner !== null
  ) {
    return { kind: 'existing', userId: input.verifiedEmailOwner, via: 'email' };
  }
  return { kind: 'new' };
}

/** A display login for a new account: the email's local part, else the name, else "user". */
export function loginFor(email: string | null, name: string | null): string {
  const local = email?.split('@')[0]?.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 39);
  if (local) return local;
  const fromName = name?.trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 39);
  return fromName || 'user';
}
