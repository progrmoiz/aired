/**
 * Page settings after publishing: GET /api/pages/:id/details (get_page) and
 * PATCH /api/pages/:id (set_options), in routes/api.ts. What a caller may
 * change, the bounds each value must keep, who may read or change a page,
 * and the details an owner sees. The write itself is setPageOptions in
 * lib/page-write.ts.
 *
 * No runtime imports, so tests load it directly.
 */

/** Longest title, in characters. */
export const TITLE_MAX = 200;
/** PIN length, in characters. */
export const PIN_MIN = 4;
export const PIN_MAX = 64;
/** TTL bounds, in seconds: a minute to a year. Longer than a year: permanent. */
export const TTL_MIN = 60;
export const TTL_MAX = 365 * 24 * 60 * 60;
/** Highest view limit. */
export const READS_MAX = 1_000_000;
/** The TTL `permanent: false` gives a page (DEFAULT_TTL in @aired/core). */
const DEFAULT_TTL_SECONDS = 604800;

const ALLOWED = ["title", "pin", "ttl", "permanent", "reads", "update_token"] as const;

/**
 * A validated change. A key that's absent leaves that setting alone; null
 * clears it. `pin` is the PIN as typed, hashed by the caller before writing.
 */
export type OptionsChange = {
  title?: string | null;
  pin?: string | null;
  expiry?: { permanent: true } | { ttlSeconds: number };
  reads?: number | null;
};

export type ParsedOptions = { ok: true; change: OptionsChange } | { ok: false; error: string };

const fail = (error: string): ParsedOptions => ({ ok: false, error });
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** A PATCH body (or set_options arguments in API form) as a change, or why not. */
export function parseOptions(body: unknown): ParsedOptions {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return fail("Request body must be a JSON object");
  const b = body as Record<string, unknown>;
  const unknown = Object.keys(b).filter((k) => !(ALLOWED as readonly string[]).includes(k));
  if (unknown.length > 0) {
    return fail(`Unknown field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. You can change title, pin, ttl, permanent and reads.`);
  }

  const change: OptionsChange = {};

  if ("title" in b) {
    if (b.title === null) change.title = null;
    else if (typeof b.title !== "string") return fail("title must be a string, or null to clear it");
    else {
      const t = b.title.trim();
      if (t === "") return fail("title can't be empty: send null to clear it");
      if (t.length > TITLE_MAX) return fail(`title can be at most ${TITLE_MAX} characters`);
      if (CONTROL.test(t)) return fail("title can't contain line breaks or control characters");
      change.title = t;
    }
  }

  if ("pin" in b) {
    if (b.pin === null) change.pin = null;
    else if (typeof b.pin !== "string") return fail("pin must be a string, or null to remove it");
    else {
      if (b.pin.length < PIN_MIN || b.pin.length > PIN_MAX) return fail(`pin must be ${PIN_MIN} to ${PIN_MAX} characters`);
      if (b.pin.trim() !== b.pin || CONTROL.test(b.pin)) return fail("pin can't start or end with spaces or contain control characters");
      change.pin = b.pin;
    }
  }

  const hasTtl = "ttl" in b && b.ttl !== undefined;
  const hasPermanent = "permanent" in b && b.permanent !== undefined;
  if (hasPermanent && typeof b.permanent !== "boolean") return fail("permanent must be true or false");
  if (hasTtl) {
    if (typeof b.ttl !== "number" || !Number.isInteger(b.ttl)) return fail("ttl must be a whole number of seconds");
    if (b.ttl < TTL_MIN || b.ttl > TTL_MAX) return fail(`ttl must be between ${TTL_MIN} seconds and ${TTL_MAX} seconds (a year); use permanent for longer`);
    if (b.permanent === true) return fail("Send ttl or permanent: true, not both");
    change.expiry = { ttlSeconds: b.ttl };
  } else if (hasPermanent) {
    change.expiry = b.permanent === true ? { permanent: true } : { ttlSeconds: DEFAULT_TTL_SECONDS };
  }

  if ("reads" in b) {
    if (b.reads === null) change.reads = null;
    else if (typeof b.reads !== "number" || !Number.isInteger(b.reads) || b.reads < 1 || b.reads > READS_MAX) {
      return fail(`reads must be a whole number from 1 to ${READS_MAX}, or null to remove the view limit`);
    }
    else change.reads = b.reads;
  }

  if (Object.keys(change).length === 0) return fail("Nothing to change: send at least one of title, pin, ttl, permanent or reads");
  return { ok: true, change };
}

/** The settings a page's row holds, before or after a change. */
export type PageSettings = {
  title: string | null;
  /** Stored PIN hash, or null. */
  pin: string | null;
  reads: number | null;
  permanent: boolean;
  /** Unix ms, or null when permanent. */
  expiresAt: number | null;
};

/** The settings after a change. `pinHash` is the hashed `change.pin` (unused when pin isn't set). */
export function applyOptions(current: PageSettings, change: OptionsChange, pinHash: string | null, now: number): PageSettings {
  const next = { ...current };
  if (change.title !== undefined) next.title = change.title;
  if (change.pin !== undefined) next.pin = change.pin === null ? null : pinHash;
  if (change.reads !== undefined) next.reads = change.reads;
  if (change.expiry !== undefined) {
    if ("permanent" in change.expiry) {
      next.permanent = true;
      next.expiresAt = null;
    } else {
      next.permanent = false;
      next.expiresAt = now + change.expiry.ttlSeconds * 1000;
    }
  }
  return next;
}

/** What the write did, for the response: names of settings that changed. */
export function changedSettings(change: OptionsChange): string[] {
  const out: string[] = [];
  if (change.title !== undefined) out.push("title");
  if (change.pin !== undefined) out.push("pin");
  if (change.expiry !== undefined) out.push("expiry");
  if (change.reads !== undefined) out.push("reads");
  return out;
}

/**
 * Who may read a page's details or change its settings: its update token,
 * or the signed-in owner (session, CLI sign-in or API key). Anyone else
 * gets an error; another account's page is refused like a wrong token.
 * `tokenMatches` is false when no token was sent.
 */
export type AccessDecision = { ok: true; viaToken: boolean } | { ok: false; status: 401 | 403; error: string };

export function pageAccess(input: {
  ownerId: number | null;
  userId: number | null;
  tokenSent: boolean;
  tokenMatches: boolean;
}): AccessDecision {
  if (input.tokenSent && input.tokenMatches) return { ok: true, viaToken: true };
  if (input.userId !== null && input.ownerId !== null && input.ownerId === input.userId) return { ok: true, viaToken: false };
  if (input.tokenSent) return { ok: false, status: 403, error: "Invalid update token" };
  if (input.userId !== null) return { ok: false, status: 403, error: "This page isn't in your account. Use its update token instead." };
  return { ok: false, status: 401, error: "Sign in (API key or aired login) or send the page's update token" };
}

/** A page as its owner sees it (get_page, set_options). Never the PIN or token. */
export type PageDetails = {
  id: string;
  url: string;
  title: string | null;
  size: number;
  readCount: number;
  reads: number | null;
  hasPin: boolean;
  permanent: boolean;
  createdAt: string;
  expiresAt: string | null;
  project: string | null;
};

export function pageDetails(
  row: { id: string; title: string | null; size: number; pin: string | null; reads: number | null; permanent: boolean; createdAt: number; expiresAt: number | null; project: string | null },
  readCount: number,
  origin: string,
): PageDetails {
  return {
    id: row.id,
    url: `${origin}/p/${row.id}`,
    title: row.title,
    size: row.size,
    readCount,
    reads: row.reads,
    hasPin: row.pin !== null,
    permanent: row.permanent,
    createdAt: new Date(row.createdAt).toISOString(),
    expiresAt: row.expiresAt === null ? null : new Date(row.expiresAt).toISOString(),
    project: row.project,
  };
}
