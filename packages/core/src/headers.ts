/** Session JWT — sent as HttpOnly cookie (web) or this header (CLI/API/MCP). Never Authorization. */
export const AUTH_HEADER = 'aired-Session';

/** Bearer <update_token> only — never a JWT. */
export const UPDATE_TOKEN_HEADER = 'Authorization';

/** Value '1' required on state-mutating /api/* calls when using cookie auth. */
export const CSRF_HEADER = 'X-Aired-Request';
