/**
 * Who may open an "only these people" page: the list's rules, its checks,
 * and the `access` field of PATCH /api/pages/:id (set_options, `aired set
 * --only`). No imports, so tests load it directly.
 *
 * An entry is an email (`alice@client.com`), one person, or a domain
 * (`@client.com`), everyone with an address at exactly that domain (not its
 * subdomains). Both are kept lowercased and trimmed. Emails match exactly:
 * `alice+work@client.com` is another person, so list it or list the domain.
 */

export type AccessMode = "public" | "pin" | "people";

/** A parsed `access` field. emails and domains only for "people"; domains without the @. */
export type AccessInput = { mode: AccessMode; emails: string[]; domains: string[] };

/** Longest email we take: the SMTP limit. */
export const EMAIL_MAX = 254;
/** Hard caps on one request, whatever the plan: the plan limits are lower. */
const LIST_MAX = 1_000;

/**
 * Webmail domains nobody should list whole: `@gmail.com` would let anyone
 * with a Gmail address in, which is the opposite of private.
 */
export const OPEN_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.net",
  "mail.com", "zoho.com", "yandex.com", "yandex.ru", "qq.com", "163.com", "fastmail.com", "hey.com", "tutanota.com",
]);

// A practical shape check, not RFC 5322: one @, a local part without spaces
// or angle brackets, a domain of dot-separated labels with a 2+ letter TLD.
const LOCAL = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}$/;
const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** An email as we store and compare it: trimmed and lowercased. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Whether a (normalized) email looks deliverable enough to send a code to. */
export function isEmail(email: string): boolean {
  if (email.length > EMAIL_MAX) return false;
  const at = email.lastIndexOf("@");
  if (at <= 0 || email.indexOf("@") !== at) return false;
  const local = email.slice(0, at);
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  return LOCAL.test(local) && DOMAIN.test(email.slice(at + 1));
}

/** A domain entry as stored, without the @, or null if it isn't one. Takes `@client.com` or `client.com`. */
export function normalizeDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/^@/, "");
  return DOMAIN.test(d) ? d : null;
}

/** Whether `email` is on the list. `entries` as stored: emails, and domains as `@domain`. */
export function onList(email: string, entries: readonly string[]): boolean {
  const e = normalizeEmail(email);
  if (!isEmail(e)) return false;
  const domain = "@" + e.slice(e.lastIndexOf("@") + 1);
  return entries.some((x) => x === e || x === domain);
}

/** The stored entries for a list: emails as they are, domains with a leading @. */
export function toEntries(input: { emails: readonly string[]; domains: readonly string[] }): string[] {
  return [...input.emails, ...input.domains.map((d) => "@" + d)];
}

/** Stored entries split back into emails and domains (without the @), for the owner. */
export function fromEntries(entries: readonly string[]): { emails: string[]; domains: string[] } {
  const emails: string[] = [];
  const domains: string[] = [];
  for (const x of entries) (x.startsWith("@") ? domains : emails).push(x.startsWith("@") ? x.slice(1) : x);
  return { emails: emails.sort(), domains: domains.sort() };
}

export type ParsedAccess = { ok: true; access: AccessInput } | { ok: false; error: string };

const fail = (error: string): ParsedAccess => ({ ok: false, error });

function stringList(v: unknown, name: string): string[] | string {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return `access.${name} must be a list of strings`;
  if (v.length > LIST_MAX) return `access.${name} can have at most ${LIST_MAX} entries`;
  if (!v.every((x) => typeof x === "string")) return `access.${name} must be a list of strings`;
  return v as string[];
}

/**
 * The `access` field: `{ mode: "public" }`, `{ mode: "pin" }` (the PIN
 * itself comes in `pin`), or `{ mode: "people", emails: [...], domains: [...] }`.
 * Emails and domains are checked, lowercased and deduplicated here; the plan
 * limits are the route's (lib/access-limits.ts).
 */
export function parseAccess(v: unknown): ParsedAccess {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return fail('access must be an object: { "mode": "public" | "pin" | "people", "emails": [...], "domains": [...] }');
  }
  const a = v as Record<string, unknown>;
  const unknown = Object.keys(a).filter((k) => !["mode", "emails", "domains"].includes(k));
  if (unknown.length > 0) return fail(`Unknown field in access: ${unknown.join(", ")}. Use mode, emails and domains.`);
  const mode = a.mode;
  if (mode !== "public" && mode !== "pin" && mode !== "people") return fail('access.mode must be "public", "pin" or "people"');
  const rawEmails = stringList(a.emails, "emails");
  if (typeof rawEmails === "string") return fail(rawEmails);
  const rawDomains = stringList(a.domains, "domains");
  if (typeof rawDomains === "string") return fail(rawDomains);
  if (mode !== "people") {
    if (rawEmails.length > 0 || rawDomains.length > 0) return fail(`emails and domains only go with access.mode "people"`);
    return { ok: true, access: { mode, emails: [], domains: [] } };
  }

  const emails = new Set<string>();
  for (const raw of rawEmails) {
    const e = normalizeEmail(raw);
    if (e.startsWith("@")) return fail(`${raw.trim()} is a domain: put it in access.domains`);
    if (!isEmail(e)) return fail(`${raw.trim().slice(0, 80)} isn't an email address`);
    emails.add(e);
  }
  const domains = new Set<string>();
  for (const raw of rawDomains) {
    const d = normalizeDomain(raw);
    if (d === null) return fail(`${raw.trim().slice(0, 80)} isn't a domain. Write it like @client.com`);
    if (OPEN_DOMAINS.has(d)) return fail(`@${d} would let anyone with an address there in. List the people instead.`);
    domains.add(d);
  }
  if (emails.size === 0 && domains.size === 0) {
    return fail('access.mode "people" needs at least one email or domain. To make the page public, send access.mode "public".');
  }
  return { ok: true, access: { mode, emails: [...emails].sort(), domains: [...domains].sort() } };
}

/** Why a list is over the plan's limits, or null when it fits. */
export function overLimit(
  access: { emails: readonly string[]; domains: readonly string[] },
  limits: { people: number; domains: number },
): { limit: "access_people" | "access_domains"; error: string } | null {
  if (access.domains.length > 0 && limits.domains === 0) {
    return { limit: "access_domains", error: "Sharing with a whole domain (@client.com) needs Pro. List the people instead, or upgrade." };
  }
  if (access.domains.length > limits.domains) {
    return { limit: "access_domains", error: `A page can list at most ${limits.domains} domains.` };
  }
  if (access.emails.length > limits.people) {
    return { limit: "access_people", error: `Your plan lets a page list up to ${limits.people} people. Remove some, or upgrade.` };
  }
  return null;
}
