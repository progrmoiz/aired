/**
 * Cache-Control for static assets the Worker hands back from ASSETS. Only the
 * self-hosted font files, whose names carry their version
 * (apps/web/fonts/*-v<N>.woff2), are cached for a year; everything else keeps
 * the assets default. No imports, so tests load it directly.
 */
const VERSIONED_FONT = /^\/fonts\/[a-z0-9-]+-v\d+\.woff2$/;

export function assetCacheControl(pathname: string): string | null {
  return VERSIONED_FONT.test(pathname) ? 'public, max-age=31536000, immutable' : null;
}

/**
 * The asset response with the long cache header added when it applies: a
 * 200 or a 304 revalidation for a versioned font. Anything else is returned
 * untouched, including the 404 page for a missing file.
 */
export function withAssetCache(res: Response, pathname: string): Response {
  const cache = res.ok || res.status === 304 ? assetCacheControl(pathname) : null;
  if (cache === null) return res;
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', cache);
  return new Response(res.status === 304 ? null : res.body, { status: res.status, statusText: res.statusText, headers });
}
