/**
 * Update and delete accept the page's update token either as `update_token`
 * in the JSON body or as `Authorization: Bearer <token>`. The body wins when
 * both are sent.
 */
export function readUpdateToken(
  bodyToken: unknown,
  authorization: string | undefined,
): string | null {
  if (typeof bodyToken === "string" && bodyToken !== "") return bodyToken;
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    // An API key in the header signs the caller in (auth middleware); it's
    // never a page's update token.
    if (token !== "" && !token.startsWith("aired_sk_")) return token;
  }
  return null;
}
