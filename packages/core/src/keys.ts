/**
 * Reverse timestamp for lexicographic descending sort.
 * Returns a 16-character zero-padded string of (Number.MAX_SAFE_INTEGER - ms).
 */
export function revTs(ms: number): string {
  return String(Number.MAX_SAFE_INTEGER - ms).padStart(16, '0');
}

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

  /** KV key for OAuth state */
  authState: (state: string) => `auth_state:${state}`,

  /** KV key for CLI one-time code */
  cliCode: (code: string) => `cli_code:${code}`,

  /** KV key for device flow code */
  deviceCode: (code: string) => `device_code:${code}`,

  /** KV key for a revoked JWT ID */
  revokedJti: (jti: string) => `revoked_jti:${jti}`,
};
