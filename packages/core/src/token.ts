const TOKEN_PREFIX = "at_";

/**
 * Generate a new update token: "at_" + 32 random bytes encoded as base64url.
 * Works in both Cloudflare Workers and Node.js (Web Crypto API).
 */
export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const base64 = btoa(String.fromCharCode(...bytes));
  // Convert base64 to base64url
  const base64url = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return TOKEN_PREFIX + base64url;
}

/**
 * Hash a token using SHA-256. Returns a hex string.
 * Only the hash is stored server-side.
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Hash the candidate token and compare to the stored hash in constant time.
 * Uses crypto.subtle.timingSafeEqual (Workers) or a manual approach (Node).
 */
export async function verifyToken(token: string, storedHash: string): Promise<boolean> {
  const candidateHash = await hashToken(token);
  if (candidateHash.length !== storedHash.length) return false;
  // Constant-time comparison using crypto.subtle
  const encoder = new TextEncoder();
  const a = encoder.encode(candidateHash);
  const b = encoder.encode(storedHash);
  // Manual constant-time compare — avoids relying on non-standard timingSafeEqual
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i]! ^ b[i]!);
  }
  return diff === 0;
}
