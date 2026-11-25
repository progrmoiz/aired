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
  const token = bearerToken(authorization);
  // An API key in the header signs the caller in (auth middleware); it's
  // never a page's update token.
  if (token !== null && !token.startsWith("aired_sk_")) return token;
  return null;
}

/**
 * The credential in an `Authorization: Bearer …` header, or null. The scheme
 * is case-insensitive and extra spaces are allowed (RFC 7235), so the auth
 * middleware and readUpdateToken agree on what was sent.
 */
export function bearerToken(authorization: string | undefined | null): string | null {
  const match = /^\s*bearer\s+(\S+)\s*$/i.exec(authorization ?? "");
  return match ? match[1]! : null;
}
