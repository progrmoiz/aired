import { MAX_SIZE } from "./constants.js";

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validate HTML content for upload.
 * Checks size limit and presence of relative path references that could break in isolation.
 */
export function validateHtml(html: string): ValidationResult {
  const byteSize = new TextEncoder().encode(html).byteLength;
  if (byteSize > MAX_SIZE) {
    return {
      ok: false,
      error: `HTML exceeds maximum size of ${MAX_SIZE / 1024 / 1024}MB (got ${(byteSize / 1024 / 1024).toFixed(2)}MB)`,
    };
  }

  if (html.trim().length === 0) {
    return { ok: false, error: "HTML content is empty" };
  }

  if (hasRelativePaths(html)) {
    return {
      ok: false,
      error:
        "HTML contains relative resource paths (src='./' or href='./') that will not resolve when served. Bundle all assets inline or use absolute URLs.",
    };
  }

  return { ok: true };
}

/**
 * Check whether the HTML references relative paths for external resources.
 * These would break when served from aired.sh since there is no relative context.
 *
 * We check for src/href attributes that start with ./ or ../ but NOT:
 * - data: URIs (inline)
 * - http:// / https:// (absolute)
 * - // (protocol-relative)
 * - # (hash anchors)
 * - bare filenames without directory traversal are fine (they'll 404 but won't break layout)
 */
export function hasRelativePaths(html: string): boolean {
  // Match src or href attributes pointing to relative paths
  const relativePattern = /(?:src|href)\s*=\s*["'](?:\.\.?\/)[^"']*["']/gi;
  return relativePattern.test(html);
}

/**
 * Extract the <title> from an HTML string, or return null.
 */
export function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  if (match && match[1]) {
    return match[1].trim() || null;
  }
  return null;
}
