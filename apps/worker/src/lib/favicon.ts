/**
 * Referrer favicons for Pro analytics (routes/favicon.ts). The Worker
 * fetches a site's icon itself and keeps it in R2, so the dashboard loads
 * icons only from aired.sh and viewers' browsers never contact the sites.
 * No favicon services (Google's, DuckDuckGo's) are ever used.
 *
 * Safety:
 * - Only hosts aired signed (iconSig) in the caller's own analytics report,
 *   so the route can't be used as a proxy for arbitrary sites.
 * - Public https hostnames only (validIconHost): no IP literals, localhost
 *   or private/reserved names. The Worker's global_fetch_strictly_public
 *   flag also keeps every fetch on the public internet.
 * - Short timeouts, a 100 KB cap, and only real image bytes (sniffed, not
 *   trusted from Content-Type): ico, png, gif, webp, svg.
 *
 * No imports, so tests load it directly.
 */

export const ICON_MAX_BYTES = 100 * 1024;
const HTML_MAX_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 3000;
/** A site with no icon isn't asked again for this long. */
export const MISSING_TTL_MS = 7 * 24 * 3600 * 1000;
export const ICON_CACHE_SECONDS = 7 * 24 * 3600;

export type IconType = 'image/svg+xml' | 'image/png' | 'image/x-icon' | 'image/gif' | 'image/webp';
export type Icon = { bytes: Uint8Array; type: IconType };

/**
 * The host whose icon stands for a referrer: redirectors and mail or app
 * subdomains point at the site people know. Anything else is its own host.
 */
const ICON_HOSTS: Record<string, string> = {
  't.co': 'x.com',
  'twitter.com': 'x.com',
  'mobile.twitter.com': 'x.com',
  'lnkd.in': 'linkedin.com',
  'l.facebook.com': 'facebook.com',
  'lm.facebook.com': 'facebook.com',
  'm.facebook.com': 'facebook.com',
  'web.facebook.com': 'facebook.com',
  'l.instagram.com': 'instagram.com',
  'l.threads.net': 'threads.net',
  'out.reddit.com': 'reddit.com',
  'old.reddit.com': 'reddit.com',
  'slack-redir.net': 'slack.com',
  'app.slack.com': 'slack.com',
  'com.slack': 'slack.com',
  'com.google.android.gm': 'mail.google.com',
  'com.linkedin.android': 'linkedin.com',
  'com.reddit.frontpage': 'reddit.com',
  'com.facebook.katana': 'facebook.com',
  'com.instagram.android': 'instagram.com',
  'com.whatsapp': 'whatsapp.com',
  'web.whatsapp.com': 'whatsapp.com',
  'wa.me': 'whatsapp.com',
  'org.telegram.messenger': 'telegram.org',
  't.me': 'telegram.org',
  'com.discord': 'discord.com',
  'com.microsoft.teams': 'teams.microsoft.com',
  'com.microsoft.office.outlook': 'outlook.live.com',
  'outlook.office.com': 'outlook.live.com',
  'outlook.office365.com': 'outlook.live.com',
  'com.google.android.googlequicksearchbox': 'google.com',
  // chatgpt.com turns away server fetches; OpenAI's own site has the same mark.
  'chatgpt.com': 'openai.com',
  'chat.openai.com': 'openai.com',
  'youtu.be': 'youtube.com',
  'm.youtube.com': 'youtube.com',
  'gist.github.com': 'github.com',
};

export function iconHost(referrer: string): string {
  const h = referrer.toLowerCase();
  if (ICON_HOSTS[h]) return ICON_HOSTS[h]!;
  if (/^[a-z0-9-]+\.slack\.com$/.test(h)) return 'slack.com';
  if (/^[a-z0-9-]+\.notion\.site$/.test(h)) return 'notion.so';
  return h;
}

const RESERVED_SUFFIXES = ['localhost', 'local', 'internal', 'intranet', 'lan', 'home', 'corp', 'home.arpa', 'test', 'example', 'invalid', 'onion', 'arpa'];

/** A public DNS name we may fetch over https. */
export function validIconHost(host: string): boolean {
  if (host.length < 4 || host.length > 253 || host !== host.toLowerCase()) return false;
  const labels = host.split('.');
  if (labels.length < 2) return false;
  for (const l of labels) if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) return false;
  const tld = labels[labels.length - 1]!;
  // An IPv4 literal (or any all-numeric last label) is never a public name.
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(tld) && !/^xn--[a-z0-9-]+$/.test(tld)) return false;
  for (const s of RESERVED_SUFFIXES) if (host === s || host.endsWith('.' + s)) return false;
  return true;
}

// ─── Signing: only hosts from the caller's own report ───

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg))).slice(0, 22);
}

/** The signature the analytics report attaches to a host it saw. */
export function iconSig(secret: string, host: string): Promise<string> {
  return hmac(secret, `favicon:v1:${host}`);
}

export async function verifyIconSig(secret: string, host: string, sig: string | undefined): Promise<boolean> {
  if (!sig || sig.length !== 22) return false;
  const want = await iconSig(secret, host);
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

/** /api/favicon URLs for a report's referrer hosts ('' = direct gets none). */
export async function iconUrls(secret: string, hosts: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const ref of new Set(hosts)) {
    if (!ref) continue;
    const host = iconHost(ref);
    if (!validIconHost(host)) continue;
    out[ref] = `/api/favicon/${host}?s=${await iconSig(secret, host)}`;
  }
  return out;
}

// ─── Finding and checking an icon ───

/** The real type of the bytes, or null if they aren't an allowed image. */
export function sniffIcon(bytes: Uint8Array): IconType | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length >= 6 && b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2) && b[3] === 0) return 'image/x-icon';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  // An SVG may open with an XML declaration, comments or an SVG doctype.
  let head = new TextDecoder().decode(b.subarray(0, 2048)).replace(/^\uFEFF/, '').toLowerCase();
  for (;;) {
    const next = head.trimStart().replace(/^<\?xml[^>]*\?>/, '').replace(/^<!--[\s\S]*?-->/, '').replace(/^<!doctype svg[^>]*>/, '');
    if (next === head) break;
    head = next;
  }
  if (head.trimStart().startsWith('<svg')) return 'image/svg+xml';
  return null;
}

/**
 * Remove what could run or load anything from an SVG. It's also served
 * under a CSP sandbox and as an <img>, where scripts never run; this is a
 * second layer.
 */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script[^>]*\/>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|xlink:href)\s*=\s*("|')\s*(?!#|data:image\/)[^"']*\2/gi, '');
}

/** Read at most `max` bytes; null when the body is bigger. */
export async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const len = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(len) && len > max) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

/** The first `max` bytes of a body (a page's <head> comes first); the rest isn't read. */
export async function readPrefix(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const out = new Uint8Array(max);
  let at = 0;
  while (at < max) {
    const { done, value } = await reader.read();
    if (done) break;
    const take = Math.min(value.byteLength, max - at);
    out.set(value.subarray(0, take), at);
    at += take;
  }
  await reader.cancel().catch(() => {});
  return out.subarray(0, at);
}

/**
 * Icon links in a page's <head>, best first: SVG, then the largest PNG or
 * other image, then Apple touch icons. Only https URLs (relative ones
 * resolve against the page).
 */
export function iconLinks(html: string, base: string): string[] {
  const found: { url: string; score: number }[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(2).find((v) => v !== undefined) ?? '';
    const rel = attr('rel').toLowerCase().split(/\s+/);
    if (!rel.includes('icon') && !rel.includes('apple-touch-icon') && !rel.includes('apple-touch-icon-precomposed')) continue;
    const href = attr('href').trim();
    if (!href || href.startsWith('data:')) continue;
    let url: URL;
    try { url = new URL(href, base); } catch { continue; }
    if (url.protocol !== 'https:') continue;
    const type = attr('type').toLowerCase();
    const size = Math.max(0, ...attr('sizes').split(/\s+/).map((s) => Number(s.split('x')[0]) || 0));
    const svg = type.includes('svg') || /\.svg(\?|$)/i.test(url.pathname);
    const score = svg ? 1000 : rel.includes('icon') ? 100 + Math.min(size, 256) : 50 + Math.min(size, 256) / 10;
    found.push({ url: url.href, score });
  }
  return [...new Set(found.sort((a, b) => b.score - a.score).map((f) => f.url))];
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const get = (fetcher: Fetcher, url: string, accept: string) =>
  fetcher(url, { redirect: 'follow', headers: { Accept: accept, 'User-Agent': 'aired-favicon/1' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

/** One icon URL's bytes, if they're an allowed image under the cap. */
async function tryIcon(fetcher: Fetcher, url: string): Promise<Icon | null> {
  try {
    const res = await get(fetcher, url, 'image/svg+xml,image/png,image/x-icon,image/webp,image/gif,image/*;q=0.8');
    if (!res.ok) { await res.body?.cancel().catch(() => {}); return null; }
    const bytes = await readCapped(res, ICON_MAX_BYTES);
    if (bytes === null || bytes.length === 0) return null;
    const type = sniffIcon(bytes);
    if (type === null) return null;
    if (type === 'image/svg+xml') return { type, bytes: enc.encode(sanitizeSvg(new TextDecoder().decode(bytes))) };
    return { type, bytes };
  } catch {
    return null;
  }
}

/** The site's icon: its home page's icon links, best first, then /favicon.ico. At most four fetches. */
export async function findIcon(fetcher: Fetcher, host: string): Promise<Icon | null> {
  if (!validIconHost(host)) return null;
  const home = `https://${host}/`;
  let candidates: string[] = [];
  try {
    const res = await get(fetcher, home, 'text/html');
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && type.includes('html')) {
      const html = await readPrefix(res, HTML_MAX_BYTES).catch(() => null);
      if (html) candidates = iconLinks(new TextDecoder().decode(html), res.url || home);
    } else {
      await res.body?.cancel().catch(() => {});
    }
  } catch {
    // No home page: /favicon.ico may still be there.
  }
  const urls = [...candidates.slice(0, 2), `https://${host}/favicon.ico`];
  for (const url of [...new Set(urls)]) {
    const icon = await tryIcon(fetcher, url);
    if (icon) return icon;
  }
  return null;
}

/** Headers for a served icon: an image only, never a document that can run anything. */
export function iconHeaders(type: IconType): Headers {
  return new Headers({
    'Content-Type': type,
    'Cache-Control': `private, max-age=${ICON_CACHE_SECONDS}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'Content-Disposition': 'inline',
  });
}
