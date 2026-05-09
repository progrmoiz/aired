/**
 * Hash input with SHA-256 and return the result as a hex string.
 * Optionally truncate to the first `truncate` characters.
 * Works in Cloudflare Workers and Node.js (Web Crypto API).
 */
export async function hashToHex(input: string, truncate?: number): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  const hex = Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return truncate !== undefined ? hex.slice(0, truncate) : hex;
}

/**
 * Generate a cryptographically random UUID v4 string.
 * Thin wrapper over crypto.randomUUID() for consistent import paths.
 */
export function generateOpaqueId(): string {
  return crypto.randomUUID();
}

/**
 * Return true if s is a lowercase or uppercase UUID v4 string.
 */
export function isValidUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
