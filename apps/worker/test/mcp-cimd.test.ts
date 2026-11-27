import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./helpers/worker-loader.ts";

const { CimdFetchError } = await import("@cloudflare/workers-oauth-provider");
const { mcpAuthServer } = await import("../src/routes/mcp-oauth.ts");

/**
 * Client ID Metadata Documents (CIMD), the MCP way for a client to say who it
 * is now that Dynamic Client Registration is deprecated (spec 2026-07-28):
 * the client_id is an HTTPS URL, and the server fetches the client's
 * metadata from it. This runs aired's own OAuth server (mcpAuthServer in
 * routes/mcp-oauth.ts, on the pinned library) against stubbed documents, and
 * checks DCR still works next to it.
 */

const ISSUER = "https://aired.test";
const oauthSrc = readFileSync(new URL("../src/routes/mcp-oauth.ts", import.meta.url), "utf8");

function fakeKv() {
  const m = new Map<string, string>();
  return {
    async get(k: string, opt?: string | { type?: string }) {
      const v = m.get(k);
      const type = typeof opt === "string" ? opt : opt?.type;
      return v === undefined ? null : type === "json" ? JSON.parse(v) : v;
    },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
    async list({ prefix = "" }: { prefix?: string } = {}) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

const CLIENT = "https://client.example/oauth/metadata.json";
const docs = new Map<string, () => Response>();
const fetched: string[] = [];
const realFetch = globalThis.fetch;
const g = globalThis as { Cloudflare?: unknown };
const realCloudflare = g.Cloudflare;

before(() => {
  // What wrangler.toml's global_fetch_strictly_public sets in the Workers runtime.
  g.Cloudflare = { compatibilityFlags: { global_fetch_strictly_public: true } };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    fetched.push(url);
    const make = docs.get(url);
    return make ? make() : new Response("not found", { status: 404 });
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  g.Cloudflare = realCloudflare;
});

const json = (body: unknown, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", ...headers } });
const goodDoc = (over: Record<string, unknown> = {}) => ({
  client_id: CLIENT,
  client_name: "Example Agent",
  redirect_uris: ["https://client.example/callback"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
  ...over,
});

const server = () => mcpAuthServer({ SITE_ORIGIN: ISSUER } as never);
const env = () => ({ OAUTH_KV: fakeKv(), PAGES_KV: fakeKv(), SITE_ORIGIN: ISSUER });

function authorizeUrl(clientId: string, redirect = "https://client.example/callback") {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    scope: "mcp",
    state: "s1",
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    resource: `${ISSUER}/mcp/account`,
  });
  return new Request(`${ISSUER}/authorize?${q}`);
}

let n = 0;
/** A fresh client URL per test, so the library's metadata cache can't answer for another test. */
function clientUrl() {
  return `https://client.example/oauth/metadata-${++n}.json`;
}

test("aired's OAuth server is configured for CIMD and keeps DCR", () => {
  assert.match(oauthSrc, /clientIdMetadataDocumentEnabled: true,/);
  assert.match(oauthSrc, /clientRegistrationEndpoint: '\/oauth\/register',/);
  assert.match(oauthSrc, /scopesSupported: \[MCP_SCOPE, 'offline_access'\],/);
  assert.match(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8"), /"global_fetch_strictly_public"/);
});

test("discovery advertises CIMD support and the registration endpoint", async () => {
  const e = env();
  const res = await server().fetch(new Request(`${ISSUER}/.well-known/oauth-authorization-server`), e as never, { waitUntil() {}, passThroughOnException() {} } as never);
  const meta = (await res.json()) as Record<string, unknown>;
  assert.equal(meta.client_id_metadata_document_supported, true);
  assert.equal(meta.registration_endpoint, `${ISSUER}/oauth/register`);
  assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
});

test("a valid metadata document is accepted, and the consent page gets the client's verified domain", async () => {
  const id = clientUrl();
  docs.set(id, json(goodDoc({ client_id: id })));
  const oauth = server().getOAuthApi(env() as never);
  const req = await oauth.parseAuthRequest(authorizeUrl(id));
  assert.equal(req.clientId, id);
  const consent = await oauth.describeConsent(req);
  assert.equal(consent.clientName, "Example Agent");
  assert.equal(consent.clientDomain, "client.example");
  assert.ok(fetched.includes(id));
});

test("CIMD validation: documents that lie or overreach are refused", async () => {
  const cases: [string, (id: string) => () => Response][] = [
    ["client_id differs from the URL it came from", () => json(goodDoc({ client_id: "https://evil.example/oauth/metadata.json" }))],
    ["no client_name", (id) => json(goodDoc({ client_id: id, client_name: "" }))],
    ["carries a client secret", (id) => json(goodDoc({ client_id: id, client_secret: "s3cret" }))],
    ["a shared-secret auth method", (id) => json(goodDoc({ client_id: id, token_endpoint_auth_method: "client_secret_basic" }))],
    ["not JSON", () => () => new Response("<html>hi</html>", { headers: { "Content-Type": "text/html" } })],
    ["over 5 KB", (id) => json(goodDoc({ client_id: id, client_name: "x".repeat(6000) }))],
    ["the document is missing", () => () => new Response("gone", { status: 404 })],
  ];
  for (const [why, make] of cases) {
    const id = clientUrl();
    docs.set(id, make(id));
    const oauth = server().getOAuthApi(env() as never);
    await assert.rejects(oauth.parseAuthRequest(authorizeUrl(id)), (err: unknown) => {
      // The library wraps every fetch or validation failure, and /authorize shows "could not be verified".
      assert.ok(err instanceof CimdFetchError, `${why}: ${String(err)}`);
      return true;
    }, why);
  }
});

test("CIMD: a redirect_uri the document doesn't list is refused, without redirecting there", async () => {
  const id = clientUrl();
  docs.set(id, json(goodDoc({ client_id: id })));
  const oauth = server().getOAuthApi(env() as never);
  await assert.rejects(oauth.parseAuthRequest(authorizeUrl(id, "https://evil.example/steal")), (err: unknown) => {
    // routes/mcp-oauth.ts redirects only when the error carries redirectTo.
    assert.equal((err as { redirectTo?: string }).redirectTo, undefined);
    return true;
  });
});

test("CIMD: client ids that aren't safe HTTPS document URLs never trigger a fetch", async () => {
  const before = fetched.length;
  for (const id of [
    "http://client.example/oauth/metadata.json",
    "https://client.example",
    "https://client.example/a/../metadata.json",
    "https://user:pw@client.example/metadata.json",
    "https://client.example/metadata.json#frag",
  ]) {
    const oauth = server().getOAuthApi(env() as never);
    await assert.rejects(oauth.parseAuthRequest(authorizeUrl(id)), id);
  }
  assert.equal(fetched.length, before, "no metadata fetch for an unsafe client id");
});

test("DCR still works next to CIMD: register, then authorize with the issued client_id", async () => {
  const e = env();
  const s = server();
  const res = await s.fetch(
    new Request(`${ISSUER}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Old Client", redirect_uris: ["https://old.example/cb"], token_endpoint_auth_method: "none" }),
    }),
    e as never,
    { waitUntil() {}, passThroughOnException() {} } as never,
  );
  assert.equal(res.status, 201);
  const reg = (await res.json()) as { client_id: string };
  assert.ok(reg.client_id && !reg.client_id.startsWith("https://"));
  const req = await s.getOAuthApi(e as never).parseAuthRequest(authorizeUrl(reg.client_id, "https://old.example/cb"));
  assert.equal(req.clientId, reg.client_id);
  const consent = await s.getOAuthApi(e as never).describeConsent(req);
  assert.equal(consent.clientDomain, undefined, "a self-registered client has no verified domain");
});
