/**
 * Who may claim, update or delete a page, and with which token. Pure (no
 * runtime imports), so tests can import it; hashing is passed in.
 *
 * A claimed page has a row in D1 `page_claims` (lib/page-claims.ts). That row,
 * not the KV page record, decides its owner and token: KV records get written
 * back stale (a view bumping the read count, an update racing the claim), and
 * a stale write must never bring back the token the claim retired.
 */

export type ClaimRecord = {
  ownerId: number;
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

/** Checks a token against a stored hash (verifyToken from @aired/core). */
export type TokenMatcher = (storedHash: string) => Promise<boolean>;

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
  const ownerId = record !== null ? record.ownerId : input.kvOwnerId;

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
  return (await input.matches(input.kvTokenHash)) ? 'claim' : 'deny';
}

/** The owner and token hash that count for a page: the claim row wins. */
export function pageCredentials(
  kvOwnerId: number | null,
  kvTokenHash: string,
  record: ClaimRecord | null,
): { ownerId: number | null; tokenHash: string } {
  if (record !== null) return { ownerId: record.ownerId, tokenHash: record.tokenHash };
  return { ownerId: kvOwnerId, tokenHash: kvTokenHash };
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
