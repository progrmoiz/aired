/**
 * How much page history each plan keeps (lib/page-versions.ts), in one
 * place. Proposals until the owner signs them off; pricing.html doesn't
 * list them yet. Change them here, not in the routes. No imports, so tests
 * load it directly.
 *
 * A version is an earlier content of a page, kept when an update or a
 * restore replaced it. The live content is always there and isn't counted.
 */

export type VersionLimits = {
  /** Earlier versions kept per page; the oldest beyond this go on the next update. */
  versions: number;
  /** Days an earlier version is kept after it was replaced; null: as long as the count allows. */
  days: number | null;
};

export const VERSION_LIMITS: { free: VersionLimits; pro: VersionLimits } = {
  free: { versions: 5, days: null },
  pro: { versions: 50, days: 90 },
};

/**
 * The newest earlier versions every plan keeps, however old: the day limit
 * never takes a page below this, so Pro never keeps less than Free.
 */
export const ALWAYS_KEEP = 5;

/** The most any plan keeps; hourly housekeeping trims to this whatever the plan. */
export const MOST_VERSIONS = Math.max(VERSION_LIMITS.free.versions, VERSION_LIMITS.pro.versions);

/** Rows housekeeping removes per hourly run, so one run stays short. */
export const PRUNE_BATCH = 200;

/** Longest version note, in characters (PAGE_INPUT_LIMITS.messageMax in @aired/core). */
export const MESSAGE_MAX = 200;

/** The plain-words summary docs, the API and the CLI give. */
export function retentionText(plan: "free" | "pro"): string {
  const l = VERSION_LIMITS[plan];
  return l.days === null
    ? `the last ${l.versions} earlier versions`
    : `the last ${l.versions} earlier versions for ${l.days} days (the newest ${ALWAYS_KEEP} stay however old)`;
}
