/**
 * A cross-site request can only act as someone through cookies the browser
 * attaches on its own. Calls that carry no session cookie (curl, agents, the
 * CLI) authenticate with a token the attacker would have to know, so they
 * don't need the header.
 */
export function csrfHeaderRequired(method: string, hasSessionCookie: boolean): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  return hasSessionCookie;
}
