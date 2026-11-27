/**
 * Request body caps, checked by Hono's bodyLimit in index.ts before any
 * route parses JSON. Only type imports, so tests load it directly.
 *
 * Page HTML travels as a JSON string, which escaping can make up to twice
 * as long (quotes, backslashes, newlines), so routes that take HTML allow
 * twice the Pro plan's 10 MB plus room for the other fields. The plan's own
 * size limit (lib/entitlements.ts) is checked after, on the HTML itself.
 */

/** Pro's HTML limit (PRO_MAX_SIZE in @aired/core), repeated to stay import-free. */
const PRO_HTML_BYTES = 10 * 1024 * 1024;

/** POST /api/publish, PUT/PATCH/DELETE /api/pages/:id, and the remote MCP. */
export const PAGE_BODY_LIMIT_BYTES = 2 * PRO_HTML_BYTES + 1024 * 1024;

/** Every other /api, /auth and /oauth request. */
export const BODY_LIMIT_BYTES = 1024 * 1024;
