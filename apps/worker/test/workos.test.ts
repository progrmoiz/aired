import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { authorizeUrl, parseAuthenticateResponse, sessionIdFromAccessToken, workosEnabled, workosLogoutUrl, workosRedirectUri } from "../src/lib/workos.ts";
import { isAllowedReturn } from "../src/lib/return-path.ts";

test("WorkOS stays off until both the client id and the API key are set", () => {
  assert.equal(workosEnabled({}), false);
  assert.equal(workosEnabled({ WORKOS_CLIENT_ID: "client_1" }), false);
  assert.equal(workosEnabled({ WORKOS_API_KEY: "sk_test_1" }), false);
  assert.equal(workosEnabled({ WORKOS_CLIENT_ID: " ", WORKOS_API_KEY: "sk_test_1" }), false);
  assert.equal(workosEnabled({ WORKOS_CLIENT_ID: "client_1", WORKOS_API_KEY: "sk_test_1" }), true);
});

test("the AuthKit URL carries the client id, the callback on this site and the state", () => {
  const url = new URL(authorizeUrl({ WORKOS_CLIENT_ID: "client_1", WORKOS_API_KEY: "sk_test_secret", SITE_ORIGIN: "http://localhost:8787/" }, "st8"));
  assert.equal(url.origin + url.pathname, "https://api.workos.com/user_management/authorize");
  assert.equal(url.searchParams.get("client_id"), "client_1");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:8787/auth/workos/callback");
  assert.equal(url.searchParams.get("provider"), "authkit");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "st8");
  assert.ok(!url.toString().includes("sk_test_secret") && !url.searchParams.has("client_secret"), "never the API key");
  assert.equal(workosRedirectUri({}), "https://aired.sh/auth/workos/callback");
});

test("the authenticate answer is read, including provider tokens when present", () => {
  assert.deepEqual(
    parseAuthenticateResponse({
      user: { id: "user_01", email: "kim@example.com", email_verified: true, first_name: "Kim", last_name: null },
      authentication_method: "GitHubOAuth",
      oauth_tokens: { access_token: "gho_x", provider: "GitHubOAuth" },
      access_token: "eyJ...",
    }),
    { userId: "user_01", email: "kim@example.com", emailVerified: true, firstName: "Kim", lastName: null, authenticationMethod: "GitHubOAuth", providerAccessToken: "gho_x", sessionId: null },
  );
  const noTokens = parseAuthenticateResponse({ user: { id: "user_02", email: "a@b.co", email_verified: false }, authentication_method: "MagicAuth" });
  assert.equal(noTokens?.providerAccessToken, null);
  assert.equal(noTokens?.emailVerified, false);
  assert.equal(parseAuthenticateResponse({ user: {} }), null);
  assert.equal(parseAuthenticateResponse(null), null);
});

test("return paths: the device page with its code is allowed, open redirects aren't", () => {
  assert.equal(isAllowedReturn("/device"), true);
  assert.equal(isAllowedReturn("/device?code=ABCD-EFGH"), true);
  assert.equal(isAllowedReturn("/device?code=ABCD-EFGH&next=//evil.com"), false);
  assert.equal(isAllowedReturn("//evil.com"), false);
  assert.equal(isAllowedReturn("https://evil.com"), false);
  assert.equal(isAllowedReturn("/dashboard"), true);
});

test("wiring: /auth/login falls back to GitHub, callbacks refuse each other's state, the CLI uses AuthKit when on", () => {
  const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  const workos = src("routes/auth-workos.ts");
  assert.match(workos, /if \(!workosEnabled\(c\.env\)\) \{\s*return c\.redirect\(`\/auth\/github\?return=\$\{encodeURIComponent\(returnPath\)\}`, 302\);/);
  assert.match(workos, /if \(authState\.provider !== 'workos'\) return failed\(c, 'state'\);/);
  assert.match(workos, /if \(!urlState \|\| !cookieState \|\| !constantTimeEqual\(urlState, cookieState\)\) return failed\(c, 'state'\);/);
  const github = src("routes/auth.ts");
  assert.match(github, /if \(authState\.provider === 'workos'\) \{/);
  assert.match(github, /if \(workosEnabled\(c\.env\)\) \{\s*return startWorkosSignIn\(c, \{ port: portNum, client_state: clientState \}\);/);
  const index = src("index.ts");
  assert.ok(index.indexOf('app.route("/auth", authWorkos)') < index.indexOf('app.route("/auth", auth)'));
});

test("every Log in link and signed-out redirect goes through /auth/login", () => {
  const dir = new URL("../../web/", import.meta.url);
  const offenders = readdirSync(dir)
    .filter((f) => f.endsWith(".html") || f.endsWith(".js"))
    .filter((f) => readFileSync(new URL(f, dir), "utf8").includes("/auth/github?return="));
  assert.deepEqual(offenders, []);
  for (const f of ["routes/dashboard.ts", "routes/billing.ts"]) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
    assert.ok(!src.includes("/auth/github?return="), f);
    assert.ok(src.includes("/auth/login?return="), f);
  }
  // With WorkOS off, /auth/login doesn't count the attempt twice.
  const workos = readFileSync(new URL("../src/routes/auth-workos.ts", import.meta.url), "utf8");
  assert.match(workos, /authWorkos\.get\('\/login', \(c, next\) => \(workosEnabled\(c\.env\) \? loginRateLimit\(c, next\) : next\(\)\)/);
});

test("a GitHub sign-in through WorkOS whose GitHub id can't be read may only reach an existing account", () => {
  const workos = readFileSync(new URL("../src/routes/auth-workos.ts", import.meta.url), "utf8");
  assert.match(workos, /if \(!auth\.result\.providerAccessToken\) \{[\s\S]*?githubUnreadable = true;/);
  assert.match(workos, /requireExisting: githubUnreadable,/);
  assert.match(workos, /if \(err instanceof NoExistingAccountError\) return failed\(c, 'github_unavailable'\);/);
});

test("signing out of aired also ends the AuthKit session", () => {
  const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
  assert.equal(sessionIdFromAccessToken(jwt({ sid: "session_01ABC", sub: "user_1" })), "session_01ABC");
  assert.equal(sessionIdFromAccessToken(jwt({ sub: "user_1" })), null);
  assert.equal(sessionIdFromAccessToken(jwt({ sid: "a/../b" })), null, "only id-shaped values");
  assert.equal(sessionIdFromAccessToken("not-a-jwt"), null);
  assert.equal(parseAuthenticateResponse({ user: { id: "u" }, access_token: jwt({ sid: "session_9" }) })?.sessionId, "session_9");
  const url = new URL(workosLogoutUrl({ SITE_ORIGIN: "https://aired.sh" }, "session_9"));
  assert.equal(url.origin + url.pathname, "https://api.workos.com/user_management/sessions/logout");
  assert.equal(url.searchParams.get("session_id"), "session_9");
  assert.equal(url.searchParams.get("return_to"), "https://aired.sh/");
  const auth = readFileSync(new URL("../src/routes/auth.ts", import.meta.url), "utf8");
  assert.match(auth, /if \(workosEnabled\(c\.env\)\) return c\.json\(\{ ok: true, redirect: workosLogoutUrl\(c\.env, workosSession\) \}\);/);
  const dash = readFileSync(new URL("../../dashboard/src/lib/api.ts", import.meta.url), "utf8");
  assert.match(dash, /\/\^https:\\\/\\\/api\\\.workos\\\.com\\\/\/\.test\(data\.redirect\)/, "the dashboard only follows WorkOS logout URLs");
});
