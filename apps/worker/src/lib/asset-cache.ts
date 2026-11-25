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
