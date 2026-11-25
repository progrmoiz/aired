/** Default TTL: 7 days in seconds */
export const DEFAULT_TTL = 604800;

/** Maximum HTML size: 2MB in bytes */
export const MAX_SIZE = 2097152;

/** Maximum HTML size on the Pro plan: 10MB in bytes */
export const PRO_MAX_SIZE = 10 * 1024 * 1024;

/** Session cookie and JWT lifetime (web): 30 days in seconds */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** CLI/device JWT lifetime: 365 days in seconds. CLI tokens are header-presented
 *  and never rotated, so they ride this full TTL (vs the web cookie's sliding 30d). */
export const CLI_SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
