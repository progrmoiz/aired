/**
 * Limits for the data layer (aired.collect and update_data), per plan, in
 * one place. The numbers are proposals until the owner signs them off;
 * pricing.html says nothing about them yet. Change them here, not in the
 * routes. No imports, so tests load it directly.
 */

export type CollectLimits = {
  /** New entries a page can take in a calendar month (UTC). Replacing a keyed entry doesn't count. */
  responsesPerMonth: number;
  /** Entries a page can hold at once. */
  storedResponses: number;
  /** Bytes of entry JSON a page can hold at once. */
  storedBytes: number;
  /** Days an entry is kept after it's saved; null keeps it while the page lives. */
  retentionDays: number | null;
  /** Bytes of JSON update_data can push to one page. */
  liveDataBytes: number;
};

export const COLLECT_LIMITS: { free: CollectLimits; pro: CollectLimits } = {
  free: {
    responsesPerMonth: 300,
    storedResponses: 1_000,
    storedBytes: 2 * 1024 * 1024,
    retentionDays: 90,
    liveDataBytes: 64 * 1024,
  },
  pro: {
    responsesPerMonth: 10_000,
    storedResponses: 50_000,
    storedBytes: 25 * 1024 * 1024,
    retentionDays: null,
    liveDataBytes: 1024 * 1024,
  },
};

/** The same for every plan: one entry's JSON. */
export const RECORD_MAX_BYTES = 8 * 1024;
/** Nesting depth of one entry: { a: { b: [ ... ] } } is 3. */
export const RECORD_MAX_DEPTH = 5;
/** Keys in one object, items in one array, characters in one key and one string. */
export const RECORD_MAX_KEYS = 100;
export const RECORD_MAX_ITEMS = 200;
export const RECORD_KEY_MAX = 100;
export const RECORD_STRING_MAX = 4_000;
/** save(record, { key }): letters, digits and _ . : - only. */
export const ENTRY_KEY_MAX = 64;

/**
 * Write limits, the same on every plan (they stop floods, not use). Durable,
 * in D1 rate_limits, so every isolate counts against the same row.
 *   viewer: one viewer on one page.
 *   ip: one address (IPv6 by /64) across every page, so minting new viewers
 *     doesn't get round the viewer limit.
 *   networkPage: one address on one page. A viewer is a browser, not a
 *     person: clearing cookies (or curl) makes a new one. This keeps one
 *     address from stuffing a poll or using up a page's month. The cost: a
 *     class or office behind one address shares 60 saves an hour per page.
 *   page: everyone on one page.
 */
export const COLLECT_WRITE_LIMITS = {
  viewer: { limit: 30, windowSeconds: 10 * 60 },
  networkPage: { limit: 60, windowSeconds: 60 * 60 },
  ip: { limit: 300, windowSeconds: 60 * 60 },
  page: { limit: 1_000, windowSeconds: 60 * 60 },
} as const;

/** update_data pushes per page, so a loop can't hammer every open tab. */
export const LIVE_DATA_PUSH_LIMIT = { limit: 120, windowSeconds: 60 * 60 } as const;

/** How often an open page asks whether its live data changed, in seconds. */
export const LIVE_DATA_POLL_SECONDS = 15;

/** How long the token the page gets lasts. A reload gets a new one. */
export const VIEWER_TOKEN_SECONDS = 7 * 24 * 3600;
/** How long the viewer cookie lasts, so the same browser stays the same viewer. */
export const VIEWER_COOKIE_SECONDS = 365 * 24 * 3600;

/** Entries one read returns at most (mine, all, the owner's list). */
export const READ_PAGE_MAX = 200;
/** Rows the CSV export holds at most. */
export const CSV_MAX_ROWS = 50_000;
