export const GITHUB_NOREPLY_PATTERN = /@users\.noreply\.github\.com$/i;

/**
 * Returns null if the email is a GitHub no-reply address; otherwise returns the email unchanged.
 * Call this before storing or returning any email from GitHub.
 */
export function redactNoreplyEmail(email: string | null): string | null {
  if (email === null) return null;
  return GITHUB_NOREPLY_PATTERN.test(email) ? null : email;
}
