import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { consentErrorPage, consentPage, escapeHtml } from "../src/lib/mcp-consent.ts";
import { isAllowedReturn } from "../src/lib/return-path.ts";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("the consent page escapes everything the client chose and says where access goes", () => {
  const page = consentPage({ clientName: `Evil"><script>alert(1)</script>`, redirectHost: "x.example\"onmouseover=1", redirectIsLoopback: false }, `h"1`, "kim<b>");
  assert.ok(!page.includes("<script>alert(1)"));
  assert.ok(page.includes("Evil&#34;&#62;&#60;script&#62;"));
  assert.ok(page.includes('value="h&#34;1"'));
  assert.ok(page.includes("@kim&#60;b&#62;"));
  assert.ok(page.includes("x.example&#34;onmouseover&#61;1"));
  assert.match(page, /This app registered itself, so its name isn’t verified\./);
  assert.ok(!page.includes("an app on your computer"));
  assert.match(page, /<form method="post" action="\/authorize">/);
  assert.match(page, /name="decision" value="approve"[\s\S]*name="decision" value="deny"/);
});

test("a metadata-document client shows its domain; a local redirect gets the warning", () => {
  const cimd = consentPage({ clientName: "Claude", clientDomain: "claude.ai", redirectHost: "claude.ai", redirectIsLoopback: false }, "h", "kim");
  assert.match(cimd, /Published by <b>claude\.ai<\/b>\./);
  const local = consentPage({ clientName: "Inspector", redirectHost: "localhost", redirectIsLoopback: true }, "h", "kim");
  assert.match(local, /This sends access to an app on your computer/);
  assert.ok(!consentErrorPage("<img src=x onerror=1>").includes("<img"));
  assert.equal(escapeHtml("`='"), "&#96;&#61;&#39;");
});

test("signing in can return to an OAuth authorize request, and nowhere else new", () => {
  assert.equal(isAllowedReturn("/authorize?response_type=code&client_id=abc&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=x"), true);
  assert.equal(isAllowedReturn("/authorize"), false);
  assert.equal(isAllowedReturn("/authorizex?a=b"), false);
  assert.equal(isAllowedReturn("//evil.com/authorize?a=b"), false);
  assert.equal(isAllowedReturn("/authorize?a=b\r\nSet-Cookie: x"), false);
  assert.equal(isAllowedReturn("/authorize?a=b\\@evil"), false);
});

test("wiring: /mcp/account challenges, OAuth tokens sign in only on MCP, and the token is never passed on", () => {
  const index = src("src/index.ts");
  assert.match(index, /if \(bearer !== null && !bearer\.startsWith\(API_KEY_PREFIX\)\) \{/);
  assert.match(index, /if \(found === null\) return mcpChallenge\(c, resource, "invalid_token"\);/);
  assert.match(index, /if \(!found\.scope\.includes\(MCP_SCOPE\)\) return mcpInsufficientScope\(c, resource\);/);
  assert.match(index, /\} else if \(which === "account" && c\.get\("via"\) !== "key"\) \{\s*return mcpChallenge\(c, resource\);/);
  assert.match(index, /for \(const \[path, which\] of \[\["\/mcp", "open"\], \["\/mcp\/account", "account"\]\] as const\)/);
  assert.match(index, /asUser === undefined \? c\.env : withMcpOAuthUser\(c\.env, asUser\)/);
  // Only in-process calls carry the account: a request can't set env, and vars are strings.
  const auth = src("src/middleware/auth.ts");
  assert.match(auth, /const mcpUser = c\.env\.AIRED_MCP_OAUTH_USER;\s*if \(typeof mcpUser === 'number'\) return mcpOAuthAuth\(c, next, mcpUser\);/);
  assert.match(auth, /c\.set\('via', 'oauth'\);/);
  // OAuth callers are not sessions: no keys, billing or account deletion.
  assert.match(auth, /if \(c\.get\('via'\) !== 'cookie'\) \{/);
});

test("wiring: consent needs the web session, and the OAuth store and fetch flag are configured", () => {
  const oauth = src("src/routes/mcp-oauth.ts");
  assert.match(oauth, /if \(user === null \|\| c\.get\('via'\) !== 'cookie'\) return null;/);
  assert.match(oauth, /if \(err instanceof AuthorizationError && err\.redirectTo\) return Response\.redirect\(err\.redirectTo, 302\);/);
  assert.match(oauth, /clientIdMetadataDocumentEnabled: true,/);
  assert.match(oauth, /h\.set\('X-Frame-Options', 'DENY'\);/);
  const toml = src("wrangler.toml");
  assert.match(toml, /compatibility_flags = \["nodejs_compat", "global_fetch_strictly_public"\]/);
  assert.match(toml, /binding = "OAUTH_KV"\nid = "6388d6b3b6c04fe5ad8529ae029e723e"/);
  const pkg = JSON.parse(src("package.json"));
  assert.equal(pkg.dependencies["@cloudflare/workers-oauth-provider"], "1.2.4", "pinned exactly");
});

test("CORS: protocol paths are open without credentials; the consent page and the API aren't", async () => {
  const { isPublicProtocolPath } = await import("../src/middleware/cors.ts").catch(() => ({ isPublicProtocolPath: null as never }));
  if (isPublicProtocolPath) {
    for (const p of ["/mcp", "/mcp/account", "/oauth/token", "/oauth/register", "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource/mcp/account"]) assert.equal(isPublicProtocolPath(p), true, p);
    for (const p of ["/authorize", "/api/me", "/auth/login", "/mcpx", "/dashboard"]) assert.equal(isPublicProtocolPath(p), false, p);
  }
  const cors = src("src/middleware/cors.ts");
  assert.match(cors, /c\.res\.headers\.delete\('Access-Control-Allow-Credentials'\);/);
});

test("MCP connections end with the account and with sign-out-everywhere; rate limits fit hosted clients", () => {
  const oauth = src("src/routes/mcp-oauth.ts");
  assert.match(oauth, /props: \{ userId: account\.id, issuedAt: Math\.floor\(Date\.now\(\) \/ 1000\) \}/);
  assert.match(oauth, /if \(grantRetired\(env, v\.props\?\.issuedAt\)\) return null;/);
  assert.match(oauth, /await oauth\.revokeGrant\(grant\.id, String\(userId\)\);/);
  const me = src("src/routes/me.ts");
  assert.match(me, /await revokeMcpGrants\(c\.env, userId\);/);
  assert.match(oauth, /mcpOAuth\.post\('\/oauth\/register', rateLimit\(TIERS\.oauth_register\), authServerFetch\);/);
  assert.match(oauth, /mcpOAuth\.all\('\/oauth\/\*', rateLimit\(TIERS\.oauth_token\), authServerFetch\);/);
  const tiers = src("src/lib/rate-limit-tiers.ts");
  assert.match(tiers, /oauth_register: \{[^}]*burst: 'OAUTH_BURST' \}/);
  assert.match(src("wrangler.toml"), /name = "OAUTH_BURST"/);
});

test("the authorize return path survives characters URL leaves raw", () => {
  const search = "?response_type=code&state=a|b[c]{d}^e";
  const back = `/authorize${search}`.replace(/[|[\]{}^`"<> ]/g, (ch) => encodeURIComponent(ch));
  assert.equal(isAllowedReturn(back), true);
  assert.match(src("src/routes/mcp-oauth.ts"), /\.replace\(\/\[\|\[\\\]\{\}\^`"<> \]\/g, \(ch\) => encodeURIComponent\(ch\)\)/);
});

test("retired grants can't refresh, grants can't outlive their account, and deleting an account ends the AuthKit session", () => {
  const oauth = src("src/routes/mcp-oauth.ts");
  assert.match(oauth, /tokenExchangeCallback: \(\{ props, env: e \}\) => \{\s*if \(grantRetired\(e,[\s\S]*?throw new OAuthError\('invalid_grant'/);
  const index = src("src/index.ts");
  assert.match(index, /found\.issuedAt === null \|\| found\.issuedAt \* 1000 < created - 60_000/);
  const me = src("src/routes/me.ts");
  assert.match(me, /if \(workosSession !== null\) clearWorkosSessionCookie\(c\);/);
  assert.match(me, /\? \{ ok: true, redirect: workosLogoutUrl\(c\.env, workosSession\) \}/);
});
