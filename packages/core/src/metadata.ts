export type PageMetadata = {
  id: string;
  title: string | null;
  size: number;
  tokenHash: string;
  pin: string | null;
  reads: number | null;
  readCount: number;
  permanent: boolean;
  createdAt: string;
  expiresAt: string | null;
  ownerId: number | null;
  /** Source project this page was published from. Null for old records (pre-tagging),
   *  anonymous publishes, or MCP publishes without an explicit project. */
  project: string | null;
  /**
   * "people": only the emails and domains on the page's list may open it
   * (the worker's lib/access-list.ts). Absent or null: public, or PIN-only.
   * Copied from the D1 row whenever the record is rebuilt.
   */
  access?: "people" | null;
};

export function serializeMetadata(meta: PageMetadata): string {
  return JSON.stringify(meta);
}

export function parseMetadata(raw: string): PageMetadata | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    if (
      typeof obj["id"] !== "string" ||
      typeof obj["size"] !== "number" ||
      typeof obj["tokenHash"] !== "string" ||
      typeof obj["readCount"] !== "number" ||
      typeof obj["permanent"] !== "boolean" ||
      typeof obj["createdAt"] !== "string"
    ) {
      return null;
    }
    return {
      id: obj["id"],
      title: typeof obj["title"] === "string" ? obj["title"] : null,
      size: obj["size"],
      tokenHash: obj["tokenHash"],
      pin: typeof obj["pin"] === "string" ? obj["pin"] : null,
      reads: typeof obj["reads"] === "number" ? obj["reads"] : null,
      readCount: obj["readCount"],
      permanent: obj["permanent"],
      createdAt: obj["createdAt"],
      expiresAt: typeof obj["expiresAt"] === "string" ? obj["expiresAt"] : null,
      ownerId: typeof obj["ownerId"] === "number" ? obj["ownerId"] : null,
      project: typeof obj["project"] === "string" ? obj["project"] : null,
      access: obj["access"] === "people" ? "people" : null,
    };
  } catch {
    return null;
  }
}
