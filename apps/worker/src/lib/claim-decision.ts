/**
 * What a claim request does to a page. Pure, so tests can import it.
 *
 * Every successful claim issues a new update token and stores only its hash,
 * so the token that travelled in claim links, CLI output and chat transcripts
 * stops working the moment the page has an owner.
 *
 * - `deny`: someone else owns the page, or the token doesn't match an
 *   unowned page. The caller answers with the same generic failure either way,
 *   so the response never tells a stranger whether a page is owned.
 * - `claim`: the page had no owner and the token matched. It becomes the
 *   user's page, with a new token.
 * - `reissue`: the user already owns the page. Their session is enough, so the
 *   supplied token isn't checked: a retry after a lost response (whose token
 *   is already stale) still succeeds, and claiming a page that was claimed
 *   before rotation existed retires its old token.
 */
export type ClaimDecision = 'deny' | 'claim' | 'reissue';

export function decideClaim(
  ownerId: number | null,
  userId: number,
  tokenValid: boolean,
): ClaimDecision {
  if (ownerId === userId) return 'reissue';
  if (ownerId !== null) return 'deny';
  return tokenValid ? 'claim' : 'deny';
}
