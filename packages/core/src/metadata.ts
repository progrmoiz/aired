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
    };
  } catch {
    return null;
  }
}
