/**
 * Who may claim, update or delete a page, and with which token. No runtime
 * imports, so tests can import it; D1, KV and hashing are passed in.
 *
 * A claimed page has a row in D1 `page_claims` (lib/page-claims.ts). That row,
 * not the KV page record, decides its owner and token: KV records get written
 * back stale (a view bumping the read count, an update racing the claim), and
 * a stale write must never bring back the token the claim retired. Rows are
 * released or tombstoned, never deleted, for the same reason.
 */

export type ClaimRecord = {
  /** Null once released (owner deleted their account, or page deleted). */
  ownerId: number | null;
  /** Hash of the current token: the one the claim handed to the owner. */
  tokenHash: string;
  /** Hash of the pre-claim token, which travelled in claim links and output. */
  prevTokenHash: string;
  /** Unix ms. */
  claimedAt: number;
};

/**
 * How long after a claim the pre-claim token may claim again, so a retry
 * after a lost response still gets the new token. After this the old token
 * does nothing at all.
 */
export const CLAIM_RETRY_WINDOW_MS = 10 * 60 * 1000;

/** Checks the supplied token against a stored hash (verifyToken from @aired/core). */
export type TokenMatcher = (storedHash: string) => Promise<boolean>;

/** The owner and token hash that count for a page: the claim row wins. */
export function pageCredentials(
  kvOwnerId: number | null,
  kvTokenHash: string,
  record: ClaimRecord | null,
): { ownerId: number | null; tokenHash: string } {
  if (record !== null) return { ownerId: record.ownerId, tokenHash: record.tokenHash };
  return { ownerId: kvOwnerId, tokenHash: kvTokenHash };
}

/**
 * The one way update, delete, publish-update and MCP get a page's owner and
 * token hash. `lookup` reads the claim row (getClaim); if it throws, so does
 * this, and callers fail closed rather than trust a possibly stale KV hash.
 */
export async function authoritativeCredentials(
  lookup: () => Promise<ClaimRecord | null>,
  kvOwnerId: number | null,
  kvTokenHash: string,
): Promise<{ ownerId: number | null; tokenHash: string }> {
  return pageCredentials(kvOwnerId, kvTokenHash, await lookup());
}

/**
 * - `deny`: someone else's page, or a token that doesn't match an unowned
 *   page. The caller gives the same generic 403 for both.
 * - `claim`: an unowned page and the right token. It becomes the user's page
 *   with a new token.
 * - `reissue`: the user claimed it within the retry window and sent the
 *   pre-claim token again (their first response was lost). A new token.
 * - `owned`: already the user's. Nothing changes and no token is returned,
 *   so a session alone can never mint a token, and pages that were owned
 *   from the start keep the token their CI or agents use.
 */
export type ClaimPlan = 'deny' | 'claim' | 'reissue' | 'owned';

export async function planClaim(input: {
  kvOwnerId: number | null;
  kvTokenHash: string;
  record: ClaimRecord | null;
  userId: number;
  now: number;
  matches: TokenMatcher;
}): Promise<ClaimPlan> {
  const { record, userId } = input;
  const { ownerId, tokenHash } = pageCredentials(input.kvOwnerId, input.kvTokenHash, record);

  if (ownerId === userId) {
    if (
      record !== null &&
      input.now - record.claimedAt < CLAIM_RETRY_WINDOW_MS &&
      (await input.matches(record.prevTokenHash))
    ) {
      return 'reissue';
    }
    return 'owned';
  }
  if (ownerId !== null) return 'deny';
  return (await input.matches(tokenHash)) ? 'claim' : 'deny';
}

export type ClaimDeps = {
  getClaim: () => Promise<ClaimRecord | null>;
  /** Insert a row, or take a released one still at `checkedHash`; false if
   *  the row changed or someone holds the page. */
  upsertClaim: (record: ClaimRecord & { ownerId: number }, checkedHash: string) => Promise<boolean>;
  /** Replace the token on the user's own row; false if it isn't theirs. */
  replaceClaimToken: (tokenHash: string) => Promise<boolean>;
  newToken: () => string;
  hash: (token: string) => Promise<string>;
  matches: TokenMatcher;
  /** Copy owner and hash into the KV record. Must not throw. */
  mirrorToKv: (ownerId: number, tokenHash: string) => Promise<void>;
  /** Owner and project indexes, first claim only. Must not throw. */
  indexPage: () => Promise<void>;
};

/** `token` is set only when a new token was issued. */
export type ClaimOutcome = { ok: false } | { ok: true; token: string | null };

/** The whole claim: plan, write D1, mirror to KV, index. */
export async function runClaim(
  input: { kvOwnerId: number | null; kvTokenHash: string; userId: number; now: number },
  deps: ClaimDeps,
): Promise<ClaimOutcome> {
  const planFor = (record: ClaimRecord | null) =>
    planClaim({ ...input, record, matches: deps.matches });

  const record = await deps.getClaim();
  let plan = await planFor(record);
  if (plan === 'deny') return { ok: false };
  if (plan === 'owned') return { ok: true, token: null };

  const token = deps.newToken();
  const tokenHash = await deps.hash(token);

  if (plan === 'claim') {
    const prevTokenHash = pageCredentials(input.kvOwnerId, input.kvTokenHash, record).tokenHash;
    const won = await deps.upsertClaim(
      { ownerId: input.userId, tokenHash, prevTokenHash, claimedAt: input.now },
      prevTokenHash,
    );
    if (!won) {
      // The row changed after it was read: another claim got there first.
      // Re-plan against it. Only a page that turns out to be the user's own
      // counts as success, and a same-user race ('reissue') returns no token
      // so this request doesn't retire the one the winner handed out.
      plan = await planFor(await deps.getClaim());
      return plan === 'owned' || plan === 'reissue' ? { ok: true, token: null } : { ok: false };
    }
  } else if (!(await deps.replaceClaimToken(tokenHash))) {
    return { ok: false };
  }

  await deps.mirrorToKv(input.userId, tokenHash);
  if (plan === 'claim') await deps.indexPage();
  return { ok: true, token };
}

export type WriteAuth =
  | { ok: true; viaToken: boolean }
  | { ok: false; reason: 'bad_token' | 'no_token' };

/**
 * Update or delete: a matching token wins; otherwise the signed-in owner.
 * `allowSession` is false for paths that only take a token (POST /api/publish
 * with an id, MCP).
 */
export async function authorizePageWrite(input: {
  ownerId: number | null;
  tokenHash: string;
  token: string | null;
  userId: number | null;
  allowSession: boolean;
  matches: TokenMatcher;
}): Promise<WriteAuth> {
  if (input.token !== null && (await input.matches(input.tokenHash))) {
    return { ok: true, viaToken: true };
  }
  if (input.allowSession && input.userId !== null && input.ownerId === input.userId) {
    return { ok: true, viaToken: false };
  }
  return { ok: false, reason: input.token !== null ? 'bad_token' : 'no_token' };
}

export type ClaimBatchResult = {
  claimed: string[];
  failed: { id: string; reason: string }[];
  /** New update token per claimed id. Kept apart from `claimed` so older
   *  clients that read `claimed` as a list of ids keep working. */
  tokens: Record<string, string>;
};

/** Fold one claim response body into the claim-batch result. */
export function addClaimResult(
  acc: ClaimBatchResult,
  id: string,
  body: { ok?: boolean; update_token?: unknown },
): void {
  if (body.ok === true) {
    acc.claimed.push(id);
    if (typeof body.update_token === 'string') acc.tokens[id] = body.update_token;
  } else {
    acc.failed.push({ id, reason: 'claim failed' });
  }
}
