/**
 * Where a sign-in may send the browser afterwards. A fixed list plus page
 * links and the CLI device page, so a crafted return= can't redirect off-site.
 * No imports, so tests load it directly.
 */

// Valid return paths for post-login redirect
const ALLOWED_RETURN_PATHS = [
  '/dashboard',
  '/',
  '/upgrade',
  '/upgrade?interval=year',
  '/upgrade?interval=month',
  '/claim',
  '/device',
];
const ALLOWED_RETURN_PREFIX = '/p/';
/** /device?code=ABCD-EFGH (the CLI device page with its code filled in). */
const DEVICE_RETURN = /^\/device\?code=[A-Z0-9-]{1,16}$/;

export function isAllowedReturn(path: string): boolean {
  return ALLOWED_RETURN_PATHS.includes(path) || path.startsWith(ALLOWED_RETURN_PREFIX) || DEVICE_RETURN.test(path);
}

