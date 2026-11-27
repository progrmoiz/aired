import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  signInRequiredText,
  accountResult,
  apiErrorResult,
  deleteResult,
  listResult,
  publishResult,
  updateResult,
} from "../src/lib/mcp-account.ts";

const txt = (r: { content: Array<{ text: string }> }) => r.content[0]!.text;
const O = "https://aired.sh";

test("a plan limit is a tool error that says a person must open the upgrade link", () => {
  const r = apiErrorResult(402, { error: "This needs Pro", code: "plan_limit", limit: "page_size", upgrade_url: "https://aired.sh/upgrade?ref=api" }, O);
  assert.equal(r.isError, true);
  assert.match(txt(r), /A person needs to open this link to upgrade: https:\/\/aired\.sh\/upgrade\?ref=api/);
  assert.match(txt(r), /page_size/);
});

test("other API errors pass their message through as tool errors", () => {
  assert.deepEqual(apiErrorResult(404, { error: "Page not found" }, O), { content: [{ type: "text", text: "Page not found" }], isError: true });
  assert.match(txt(apiErrorResult(429, { error: "Rate limit exceeded" }, O)), /Wait a while/);
  const unauth = apiErrorResult(401, { error: "Invalid or revoked API key" }, O);
  assert.equal(unauth.isError, true);
  assert.ok(txt(unauth).includes(signInRequiredText(O)));
  assert.ok(signInRequiredText(O).includes("https://aired.sh/mcp/account"));
  assert.match(txt(apiErrorResult(500, null, O)), /answered 500/);
});

test("publish, update and delete results", () => {
  const p = publishResult({ id: "abc", url: "https://aired.sh/p/abc", expiresAt: null, upgrade: { reason: "badge", url: "https://aired.sh/upgrade?ref=publish" } }, "kim");
  assert.equal(p.isError, undefined);
  assert.match(txt(p), /Published to https:\/\/aired\.sh\/p\/abc/);
  assert.match(txt(p), /Owner: @kim/);
  assert.match(txt(p), /never \(permanent\)/);
  assert.match(txt(p), /remove the aired badge with Pro: https:\/\/aired\.sh\/upgrade\?ref=publish/);
  assert.doesNotMatch(txt(p), /update_token|at_/, "no update token for owned pages");
  assert.match(txt(updateResult({ url: "https://aired.sh/p/abc", expiresAt: "2026-12-02T00:00:00Z" })), /Updated .*\nExpires: 2026-12-02/);
  assert.equal(txt(deleteResult("abc")), "Deleted page abc.");
});

test("list_pages shows id, URL, title, views and expiry, and the next cursor", () => {
  const r = listResult(
    { pages: [{ id: "a1", title: "Report", readCount: 3, expiresAt: null, hasPin: true, project: "q4" }, { id: "b2", title: null, readCount: 0, expiresAt: "2026-12-01T10:00:00Z" }], cursor: "c2" },
    "https://aired.sh",
  );
  const t = txt(r);
  assert.match(t, /a1  https:\/\/aired\.sh\/p\/a1 · "Report" · 3 views · permanent · PIN · project q4/);
  assert.match(t, /b2  https:\/\/aired\.sh\/p\/b2 · untitled · 0 views · expires 2026-12-01/);
  assert.match(t, /cursor "c2"/);
  assert.equal(txt(listResult({ pages: [] }, "https://aired.sh")), "No pages yet.");
});

test("get_account shows plan and limits, and an upgrade link only on Free", () => {
  const free = txt(accountResult({ login: "kim", plan: "free", limits: { maxBytes: 2_000_000, publishTier: "authenticated" }, billing: null }, { upgradeUrl: "https://aired.sh/upgrade?ref=mcp", freePublishLimit: "30 an hour", proPublishLimit: "500 a day" }));
  assert.match(free, /Plan: Free\nLargest page: 2 MB\nPublish limit: 30 an hour/);
  assert.match(free, /upgrade_url: https:\/\/aired\.sh\/upgrade\?ref=mcp \(a person needs to open it\)/);
  const pro = txt(accountResult({ login: "kim", plan: "pro", limits: { maxBytes: 10_000_000, publishTier: "pro" }, billing: { renewsAt: "2027-11-25T00:00:00Z", cancelAtPeriodEnd: false } }, { upgradeUrl: "https://aired.sh/upgrade?ref=mcp", freePublishLimit: "30 an hour", proPublishLimit: "500 a day" }));
  assert.match(pro, /Plan: Pro\nLargest page: 10 MB\nPublish limit: 500 a day\nRenews: 2027-11-25/);
  assert.doesNotMatch(pro, /upgrade_url/);
});

test("wiring: only an API key or an MCP OAuth token signs MCP callers in, and their tool calls get the per-account limit", () => {
  const mcp = readFileSync(new URL("../src/routes/mcp.ts", import.meta.url), "utf8");
  assert.match(mcp, /const asKey = via === "key" && authorization !== undefined;\s*const asOAuth = via === "oauth";/);
  assert.match(mcp, /user !== null && \(asKey \|\| asOAuth\)/);
  // The OAuth token is never passed on: OAuth calls run as the account in-process.
  // Anonymous callers' API calls carry no credentials at all.
  assert.match(mcp, /if \(signedIn !== null && asKey\) headers\.set\("Authorization", authorization!\);/);
  assert.match(mcp, /signedIn !== null && asOAuth \? user!\.id : undefined/);
  for (const tool of ["list_pages", "update_page", "delete_page", "get_account"]) {
    assert.match(mcp, new RegExp(`"${tool}",[\\s\\S]*?if \\(signedIn === null\\) return signInRequired\\(origin\\);`), tool);
  }
  const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(index, /if \(via === "key" \|\| via === "oauth"\) return rateLimit\(TIERS\.mcp_key\)\(c, next\);/);
  // Anonymous: publish_html keeps the publish limit; the other tools get their own per-IP one.
  assert.match(index, /return mcpToolName\(body\) === "publish_html" \? publishRateLimit\(c, next\) : rateLimit\(TIERS\.mcp_anon\)\(c, next\);/);
  assert.match(index, /if \(countMcpToolCalls\(body\) > 1\) \{/);
  assert.match(mcp, /if \(typeof update_token === "string" && typeof existingId !== "string"\) \{/);
  assert.match(mcp, /return isTokenUpdate \? publishUpdateResult\(res\.body, null\) : publishResult\(res\.body, signedIn\.login\);/);
  // update_page, delete_page and get_page check the id; set_options checks args.id.
  assert.equal((mcp.match(/if \(!PAGE_ID\.test\(id\)\) return badId\(\);/g) ?? []).length, 3);
  assert.match(mcp, /if \(!PAGE_ID\.test\(args\.id\)\) return badId\(\);/);
  const api = readFileSync(new URL("../src/routes/api.ts", import.meta.url), "utf8");
  assert.match(api, /if \(user !== null && creds\.ownerId === null\) \{\s*const verdict = detectSpam/);
});

test("get_account hides the upgrade link when billing is off", () => {
  const t = txt(accountResult({ login: "kim", plan: "free", limits: { maxBytes: 2_000_000, publishTier: "authenticated" } }, { upgradeUrl: null, freePublishLimit: "30 an hour", proPublishLimit: "500 a day" }));
  assert.doesNotMatch(t, /upgrade_url/);
});
