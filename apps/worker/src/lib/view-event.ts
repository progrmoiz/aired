/**
 * The one Analytics Engine data point a page view writes (dataset
 * `aired_views`, binding VIEWS), read back by lib/analytics.ts for Pro
 * owners. It holds exactly:
 *
 *   index1  page id (Analytics Engine samples per index, so each page's
 *           numbers stay accurate however busy other pages are)
 *   blob1   page id
 *   blob2   owner id at the time of the view ('' for an anonymous page)
 *   blob3   viewer country, from Cloudflare's CF-IPCountry ('XX' unknown)
 *   blob4   referrer host only ('' when direct, unknown, or aired itself)
 *   blob5   UTC day, YYYY-MM-DD
 *   double1 1
 *
 * Never the IP address, the full referrer URL, the user agent or a cookie:
 * viewEvent reads only the two headers it needs.
 *
 * No imports, so tests load it directly.
 */

export const VIEWS_DATASET = 'aired_views';

export type ViewDataPoint = { indexes: [string]; blobs: [string, string, string, string, string]; doubles: [number] };

/** Request headers: only `get` is used. */
type HeaderReader = { get(name: string): string | null };

const COUNTRY = /^[A-Z0-9]{2}$/;

/** CF-IPCountry as a two-letter code ('T1' is Tor), or 'XX'. */
export function viewerCountry(headers: HeaderReader): string {
  const raw = (headers.get('CF-IPCountry') ?? '').trim().toUpperCase();
  return COUNTRY.test(raw) ? raw : 'XX';
}

/**
 * The host a visitor came from, lower-cased and without "www.", and nothing
 * else of the URL. '' when there's no referrer, it can't be read, or it's
 * aired itself (the PIN page and the dashboard link to the page).
 * `android-app://com.slack` keeps its app id, which is what the host is.
 */
export function referrerHost(referer: string | null, siteHost: string): string {
  if (!referer) return '';
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return '';
  }
  if (!['http:', 'https:', 'android-app:'].includes(url.protocol)) return '';
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (host === '' || host.length > 253) return '';
  if (host === siteHost.toLowerCase().replace(/^www\./, '')) return '';
  return host;
}

export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function viewEvent(input: {
  pageId: string;
  ownerId: number | null;
  headers: HeaderReader;
  siteHost: string;
  nowMs: number;
}): ViewDataPoint {
  return {
    indexes: [input.pageId],
    blobs: [
      input.pageId,
      input.ownerId === null ? '' : String(input.ownerId),
      viewerCountry(input.headers),
      referrerHost(input.headers.get('Referer'), input.siteHost),
      utcDay(input.nowMs),
    ],
    doubles: [1],
  };
}
