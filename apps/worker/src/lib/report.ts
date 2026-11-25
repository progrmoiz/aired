export const REPORT_CATEGORIES = [
  "spam",
  "phishing",
  "malware",
  "illegal",
  "other",
  // The publisher lost their update token and wants their own page removed.
  // Handled on review; ownership is never transferred without the token.
  "owner_removal",
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export type AbuseReport = {
  pageId: string;
  category: ReportCategory;
  reason: string;
  contact: string | null;
};

const PAGE_ID = /^[A-Za-z0-9_-]{4,32}$/;
const PAGE_URL_ID = /\/p\/([A-Za-z0-9_-]{4,32})(?:[/?#]|$)/;

/**
 * Accepts a bare page ID or any aired.sh page URL and returns the ID.
 */
export function extractPageId(input: string): string | null {
  const value = input.trim();
  if (PAGE_ID.test(value)) return value;
  const match = PAGE_URL_ID.exec(value);
  return match ? match[1]! : null;
}

/**
 * Validates a POST /api/report body. `id` may be a page ID or URL.
 * `category` defaults to "other" so older clients that only send a reason keep working.
 */
export function parseReport(
  body: unknown,
): { ok: true; report: AbuseReport } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object" };
  }
  const { id, category, reason, contact } = body as Record<string, unknown>;

  const pageId = typeof id === "string" ? extractPageId(id) : null;
  if (pageId === null) {
    return { ok: false, error: "id must be an aired page ID or URL" };
  }

  const resolvedCategory = category === undefined ? "other" : category;
  if (!REPORT_CATEGORIES.includes(resolvedCategory as ReportCategory)) {
    return { ok: false, error: `category must be one of: ${REPORT_CATEGORIES.join(", ")}` };
  }

  if (typeof reason !== "string" || reason.trim().length === 0) {
    return { ok: false, error: "reason is required" };
  }

  if (contact !== undefined && contact !== null && typeof contact !== "string") {
    return { ok: false, error: "contact must be a string" };
  }
  const trimmedContact = typeof contact === "string" ? contact.trim().slice(0, 200) : "";

  return {
    ok: true,
    report: {
      pageId,
      category: resolvedCategory as ReportCategory,
      reason: reason.trim().slice(0, 1000),
      contact: trimmedContact.length > 0 ? trimmedContact : null,
    },
  };
}
