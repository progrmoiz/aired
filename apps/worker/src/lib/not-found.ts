/**
 * The site's 404 page (apps/web/404.html) for routes the Worker answers
 * itself, such as /p/:id for a page that expired or was deleted. Unknown
 * static paths get the same page from the assets binding through
 * not_found_handling = "404-page" in wrangler.toml.
 */
export async function notFoundPage(
  assets: Fetcher | undefined,
  requestUrl: string,
  fallbackText = "Page not found",
): Promise<Response> {
  if (assets) {
    try {
      const res = await assets.fetch(new URL("/404", requestUrl).toString());
      if (res.ok || res.status === 404) {
        return new Response(res.body, {
          status: 404,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Robots-Tag": "noindex",
          },
        });
      }
    } catch {
      // Fall through to the plain-text answer.
    }
  }
  return new Response(fallbackText, {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" },
  });
}
