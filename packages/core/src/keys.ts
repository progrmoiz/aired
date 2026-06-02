/**
 * Reverse timestamp for lexicographic descending sort.
 * Returns a 16-character zero-padded string of (Number.MAX_SAFE_INTEGER - ms).
 */
export function revTs(ms: number): string {
  return String(Number.MAX_SAFE_INTEGER - ms).padStart(16, '0');
}

/** Max length for a project name. Names are trimmed and capped, case preserved. */
export const MAX_PROJECT_LENGTH = 64;

/**
 * Normalize a raw project value into a stable display string, or null.
 * Trims whitespace, caps length, and rejects empties. Case is preserved for display.
 * Returns null for non-strings, empty/whitespace-only input — meaning "Unsorted".
 */
export function normalizeProject(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_PROJECT_LENGTH);
}

/**
 * Reserved query value used by the dashboard to request the user's pages that
 * have no project (project === null). Not a real project name.
 */
export const UNSORTED_PROJECT = '__unsorted__';

export const kvKeys = {
  /** KV key for a page's metadata */
  page: (id: string) => `page:${id}`,

  /** KV key for a user record */
  user: (id: number) => `user:${id}`,

  /** KV key for email → github_id index */
  emailIndex: (email: string) => `email:${email.toLowerCase()}`,

  /** KV key for owner page index entry (exact) */
  pagesByOwner: (uid: number, ts: string, pageId: string) =>
    `pages_by_owner:${uid}:${ts}:${pageId}`,

  /** KV prefix for listing all pages by owner */
  pagesByOwnerPrefix: (uid: number) => `pages_by_owner:${uid}:`,

  /** KV key for owner+project page index entry (exact). The project segment is
   *  encodeURIComponent-escaped so names with `:` `/` or spaces stay delimiter-safe. */
  pagesByOwnerProject: (uid: number, project: string, ts: string, pageId: string) =>
    `pages_by_owner_project:${uid}:${encodeURIComponent(project)}:${ts}:${pageId}`,

  /** KV prefix for listing one owner's pages within a single project */
  pagesByOwnerProjectPrefix: (uid: number, project: string) =>
    `pages_by_owner_project:${uid}:${encodeURIComponent(project)}:`,

  /** KV prefix for listing all of an owner's project-index entries (any project) */
  pagesByOwnerProjectOwnerPrefix: (uid: number) =>
    `pages_by_owner_project:${uid}:`,

  /** KV key for an owner's project manifest: JSON map of { projectName: count } */
  projectsByOwner: (uid: number) => `projects_by_owner:${uid}`,

  /** KV key for OAuth state */
  authState: (state: string) => `auth_state:${state}`,

  /** KV key for CLI one-time code */
  cliCode: (code: string) => `cli_code:${code}`,

  /** KV key for device flow code */
  deviceCode: (code: string) => `device_code:${code}`,

  /** KV key for a revoked JWT ID */
  revokedJti: (jti: string) => `revoked_jti:${jti}`,
};
