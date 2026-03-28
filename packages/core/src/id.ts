const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Generate a URL-safe ID using crypto.getRandomValues.
 * Produces 10 characters from a 62-char alphabet.
 * Works in both Cloudflare Workers and Node.js.
 */
export function generateId(size = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let id = "";
  for (let i = 0; i < size; i++) {
    id += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return id;
}
