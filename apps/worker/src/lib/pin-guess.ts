/**
 * Keys for the PIN guess limits (wrangler.toml PIN_GUESS and PIN_GUESS_PAGE).
 * No imports, so tests load it directly.
 *
 * - Per visitor: page id + network. An IPv6 visitor is keyed by their /64,
 *   since one connection usually controls the whole /64 and could otherwise
 *   take a fresh address for every guess.
 * - Per page: the page id alone, capping all guesses on a page whatever the
 *   number of addresses. A visitor who already entered the PIN has a cookie
 *   and isn't affected if someone else hits this cap.
 */

/** The part of an address that identifies one visitor: the IPv4 address, or an IPv6 /64. */
export function visitorNetwork(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = ip.includes('::') ? Math.max(0, 8 - left.length - right.length) : 0;
  const groups = [...left, ...Array(missing).fill('0'), ...right];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

export function pinGuessKeys(pageId: string, ipHash: string): { visitor: string; page: string } {
  return { visitor: `${pageId}:${ipHash}`, page: `page:${pageId}` };
}
