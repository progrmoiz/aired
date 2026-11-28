import { setup } from "./helpers/hosted-mcp.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

// The hosted MCP writes no page itself: anonymous publishes go through the
// API's publish route too (lib/pages-service.ts), so its rules apply.

test("an anonymous MCP publish is counted by the API's durable publish limit", async () => {
  const s = setup();
  const anon = await s.mcp();
  const res = await anon("publish_html", { html: "<h1>Hi</h1>" });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0]!.text, /^Published to https:\/\/aired\.sh\/p\/\S+\nUpdate token: at_/);
  assert.match(res.content[0]!.text, /To keep this page in an aired account, open: https:\/\/aired\.sh\//);
  assert.equal(res.structuredContent?.owner, null);
  assert.equal(res.structuredContent?.version, 1);
  const rows = s.d1.raw.prepare("SELECT count(*) AS n FROM rate_limits WHERE bucket LIKE 'rl:ip:%'").get() as { n: number };
  assert.equal(rows.n, 1);
});

test("an anonymous MCP publish gets the API's own size error and refusals", async () => {
  const s = setup();
  const anon = await s.mcp();
  const big = await anon("publish_html", { html: `<p>${"x".repeat(2 * 1024 * 1024 + 10)}</p>` });
  assert.equal(big.isError, true);
  const api = await s.send("POST", "/api/publish", { html: `<p>${"x".repeat(2 * 1024 * 1024 + 10)}</p>` });
  assert.equal(api.status, 400);
  assert.equal(big.content[0]!.text, api.body.error.message);
  // An id with no token anonymously: refused, not a new page at a different URL.
  const byId = await anon("publish_html", { id: "abc123", html: "<p>x</p>" });
  assert.equal(byId.isError, true);
  assert.match(byId.content[0]!.text, /update_token/);
  assert.equal((s.d1.raw.prepare("SELECT count(*) AS n FROM pages").get() as { n: number }).n, 0);
});

test("an anonymous MCP update by token answers like before, through the API", async () => {
  const s = setup();
  const anon = await s.mcp();
  const first = await anon("publish_html", { html: "<h1>One</h1>" });
  const { id, update_token } = first.structuredContent as { id: string; update_token: string };
  const upd = await anon("publish_html", { id, update_token, html: "<h1>Two</h1>" });
  assert.equal(upd.isError, undefined);
  assert.equal(upd.content[0]!.text, `Updated https://aired.sh/p/${id}\nUpdate token: ${update_token}\nPass update_token and id to update again.`);
  assert.equal(upd.structuredContent?.updated, true);
  const wrong = await anon("publish_html", { id, update_token: "at_wrong", html: "<h1>Three</h1>" });
  assert.equal(wrong.isError, true);
  assert.match(wrong.content[0]!.text, /Invalid update token/);
});
