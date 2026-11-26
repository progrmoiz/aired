import type { Context, Next } from "hono";
import type { AppBindings } from "../types.js";

/**
 * On the staging deploy (AIRED_ENV = "staging", wrangler.toml
 * [env.staging.vars]) every response says noindex, so search engines never
 * list staging copies of aired's pages or published pages. Production
 * doesn't set AIRED_ENV, so this does nothing there.
 */
export async function stagingNoIndex(c: Context<AppBindings>, next: Next): Promise<void> {
  await next();
  if (c.env.AIRED_ENV !== "staging" || c.res.status === 101) return;
  try {
    c.res.headers.set("X-Robots-Tag", "noindex, nofollow");
  } catch {
    // Headers from fetch() (static assets) are immutable: copy the response.
    c.res = new Response(c.res.body, c.res);
    c.res.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
}
