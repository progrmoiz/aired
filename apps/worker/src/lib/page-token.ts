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
    if (token !== "") return token;
  }
  return null;
}
