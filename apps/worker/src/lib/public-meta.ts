/**
 * What anyone may learn about a page without its PIN or token: the public
 * metadata (GET /api/pages/:id) and the link-preview card (/og/:id). A
 * PIN-protected page shows neither its title nor its view count, since
 * both can say what's behind the PIN; its owner sees them through GET
 * /api/pages/:id/details. The id, size and expiry stay.
 *
 * No runtime imports, so tests load it directly.
 */

export type PublicPage = {
  id: string;
  title: string | null;
  size: number;
  readCount: number;
  expiresAt: string | null;
  /** True when a PIN is on: title is null and readCount 0 then, whatever they are. */
  pinProtected: boolean;
};

export function publicPageMeta(
  page: { id: string; title: string | null; size: number; pin: string | null; expiresAt: string | null },
  readCount: number,
): PublicPage {
  const pinProtected = page.pin !== null;
  return {
    id: page.id,
    title: pinProtected ? null : page.title,
    size: page.size,
    readCount: pinProtected ? 0 : readCount,
    expiresAt: page.expiresAt,
    pinProtected,
  };
}

/** The link-preview card's title for a page (before truncation). */
export function cardTitle(page: { title: string | null; pin: string | null }): string {
  if (page.pin !== null) return "PIN-protected page";
  return page.title ?? "Untitled";
}
