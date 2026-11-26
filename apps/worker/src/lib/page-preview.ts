/**
 * Whether the dashboard may show a page's HTML as a preview, and how the
 * response must be sent. The owner's preview never counts a view, never asks
 * for the PIN and ignores the view limit: it's their own page. No imports, so
 * tests load it directly.
 *
 * The HTML goes back as text/plain with a sandbox CSP, never as text/html on
 * aired.sh: the dashboard drops it into a sandboxed iframe (opaque origin), so
 * the page's scripts can't reach the account.
 */
export const PREVIEW_MAX_BYTES = 1024 * 1024;

export type PreviewDecision =
  | { ok: true }
  | { ok: false; status: 404 }
  /** Too big to preview cheaply: the dashboard shows its cover instead. */
  | { ok: false; status: 204 };

export function previewDecision(
  page: { ownerId: number | null; size: number; permanent: boolean; expiresAt: string | null } | null,
  userId: number,
  claimedByUser: boolean,
  nowMs: number,
): PreviewDecision {
  if (page === null) return { ok: false, status: 404 };
  const owner = page.ownerId === userId || (page.ownerId === null && claimedByUser);
  if (!owner) return { ok: false, status: 404 };
  if (!page.permanent && page.expiresAt !== null) {
    const exp = Date.parse(page.expiresAt);
    if (Number.isFinite(exp) && exp <= nowMs) return { ok: false, status: 404 };
  }
  if (page.size > PREVIEW_MAX_BYTES) return { ok: false, status: 204 };
  return { ok: true };
}

export const PREVIEW_HEADERS: Record<string, string> = {
  'Content-Type': 'text/plain; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "sandbox; default-src 'none'",
  'Cache-Control': 'private, max-age=60',
};
