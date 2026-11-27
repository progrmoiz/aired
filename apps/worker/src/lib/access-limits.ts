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
 * isolate counts against the same row. Each is counted before the list is
 * looked at, so being over one says nothing about who is on the list.
 *   pageEmail: codes asked for one email on one page.
 *   email: codes asked for one email across every page (an inbox can't be flooded).
 *   ip: codes asked for from one address (IPv6 by /64).
 *   page: codes asked for on one page, listed or not.
 *   verifyIp: codes tried from one address on one page.
 *   verifyPage: codes tried on one page in all, so guesses spread over many
 *     addresses and emails still hit a wall. 60 per 15 minutes is at most
 *     5,760 guesses a day at 1 in 1,000,000 each.
 */
export const ACCESS_RATE_LIMITS = {
  pageEmail: { limit: 3, windowSeconds: 15 * 60 },
  email: { limit: 10, windowSeconds: 60 * 60 },
  ip: { limit: 20, windowSeconds: 60 * 60 },
  page: { limit: 200, windowSeconds: 60 * 60 },
  verifyIp: { limit: 15, windowSeconds: 15 * 60 },
  verifyPage: { limit: 60, windowSeconds: 15 * 60 },
} as const;
