/**
 * What anyone may learn about a page without its PIN or token: the public
 * metadata (GET /api/pages/:id) and the link-preview card (/og/:id). A
 * PIN-protected page, and an "only these people" page, shows neither its
 * title nor its view count, since both can say what's behind the gate; its
 * owner sees them through GET /api/pages/:id/details. The id, size and
 * expiry stay.
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
  /** True when only listed people may open it: title and readCount hidden the same way. */
  restricted: boolean;
};

/** Whether a page has a gate in front of it: a PIN, or a list of people. */
export function isGated(page: { pin: string | null; access?: "people" | null }): boolean {
  return page.pin !== null || page.access === "people";
}

export function publicPageMeta(
  page: { id: string; title: string | null; size: number; pin: string | null; expiresAt: string | null; access?: "people" | null },
  readCount: number,
): PublicPage {
  const gated = isGated(page);
  return {
    id: page.id,
    title: gated ? null : page.title,
    size: page.size,
    readCount: gated ? 0 : readCount,
    expiresAt: page.expiresAt,
    pinProtected: page.pin !== null,
    restricted: page.access === "people",
  };
}

/** The link-preview card's title for a page (before truncation). */
export function cardTitle(page: { title: string | null; pin: string | null; access?: "people" | null }): string {
  if (page.access === "people") return "Private page";
  if (page.pin !== null) return "PIN-protected page";
  return page.title ?? "Untitled";
}
