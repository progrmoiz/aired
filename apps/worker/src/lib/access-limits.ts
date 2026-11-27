/**
 * Limits for "only these people" (private sharing by email code), per plan,
 * in one place. The plan numbers are proposals until the owner signs them
 * off; pricing.html says nothing about them yet. Change them here, not in
 * the routes. No imports, so tests load it directly.
 */

export type AccessLimits = {
  /** Emails a page's list can hold. */
  people: number;
  /** Whole domains (@client.com) a page's list can hold. 0: domains need Pro. */
  domains: number;
  /** Code emails one owner's pages can send in a day (UTC), across all of them. */
  sendsPerDay: number;
};

export const ACCESS_LIMITS: { free: AccessLimits; pro: AccessLimits } = {
  free: { people: 3, domains: 0, sendsPerDay: 100 },
  pro: { people: 500, domains: 25, sendsPerDay: 2_000 },
};

/** How long a code works. */
export const CODE_TTL_MS = 10 * 60 * 1000;
/** Tries one code allows before it stops working (a new code starts again). */
export const CODE_MAX_ATTEMPTS = 5;
/** How long a right code lets that browser in. */
export const ACCESS_COOKIE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Request limits, the same on every plan. Durable (D1 rate_limits), so every
 * isolate counts against the same row.
 *
 * Counted on every request, before the list is looked at (so being over one
 * says nothing about who is on the list):
 *   pageEmail: codes asked for one email on one page.
 *   ip: codes asked for from one address (IPv6 by /64).
 *   page: codes asked for on one page, listed or not.
 *   verifyIp: codes tried from one address on one page.
 *
 * Counted only for codes actually sent, after the answer, so a stranger's
 * junk requests can't use them up and lock real people out:
 *   email: codes sent to one address across every page (an inbox can't be flooded).
 *   domainCodes: codes sent on one page to addresses that are only on it
 *     through a domain (@client.com). Anyone can make up addresses at a
 *     domain, so each would be a fresh code to guess at; this caps them.
 *
 * Counted only for wrong guesses at a code that exists:
 *   verifyFailures: per page, a day. Every guess needs a live code, and every
 *     wrong one counts here, wherever it comes from: at most 100 guesses a
 *     day at 1 in 1,000,000 each, about 1 in 10,000 a day for a whole page.
 *     When it's used up, code entry on that page waits for the window to
 *     end; people who already have a cookie aren't affected.
 */
export const ACCESS_RATE_LIMITS = {
  pageEmail: { limit: 3, windowSeconds: 15 * 60 },
  ip: { limit: 20, windowSeconds: 60 * 60 },
  page: { limit: 200, windowSeconds: 60 * 60 },
  verifyIp: { limit: 15, windowSeconds: 15 * 60 },
  email: { limit: 10, windowSeconds: 60 * 60 },
  domainCodes: { limit: 50, windowSeconds: 24 * 60 * 60 },
  verifyFailures: { limit: 100, windowSeconds: 24 * 60 * 60 },
} as const;
