import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Read the JWT from the aired CLI's session file (~/.config/aired/session.json),
 * so MCP publishes are attributed to the signed-in account instead of going up
 * anonymously (anonymous = 7-day expiry). Returns null if there's no usable
 * session — never throws; publishing falls back to anonymous.
 */
export function readCliSession(): string | null {
  try {
    const home = process.env["HOME"] ?? homedir();
    const raw = readFileSync(join(home, ".config", "aired", "session.json"), "utf-8");
    const parsed = JSON.parse(raw) as { session?: { jwt?: unknown } };
    const jwt = parsed.session?.jwt;
    if (typeof jwt !== "string") return null;

    // Reject structurally invalid or expired tokens (mirrors the CLI's getSession).
    const segments = jwt.split(".");
    if (segments.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(segments[1]!, "base64url").toString("utf-8")) as {
      exp?: unknown;
    };
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;

    return jwt;
  } catch {
    return null;
  }
}
