import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SIGN_IN_REQUIRED,
  accountResult,
  apiErrorResult,
  deleteResult,
  listResult,
  publishResult,
  updateResult,
} from "../src/lib/mcp-account.ts";

const txt = (r: { content: Array<{ text: string }> }) => r.content[0]!.text;

test("a plan limit is a tool error that says a person must open the upgrade link", () => {
  const r = apiErrorResult(402, { error: "This needs Pro", code: "plan_limit", limit: "page_size", upgrade_url: "https://aired.sh/upgrade?ref=api" });
  assert.equal(r.isError, true);
  assert.match(txt(r), /A person needs to open this link to upgrade: https:\/\/aired\.sh\/upgrade\?ref=api/);
  assert.match(txt(r), /page_size/);
});

test("other API errors pass their message through as tool errors", () => {
  assert.deepEqual(apiErrorResult(404, { error: "Page not found" }), { content: [{ type: "text", text: "Page not found" }], isError: true });
  assert.match(txt(apiErrorResult(429, { error: "Rate limit exceeded" })), /Wait a while/);
  const unauth = apiErrorResult(401, { error: "Invalid or revoked API key" });
  assert.equal(unauth.isError, true);
  assert.ok(txt(unauth).includes(SIGN_IN_REQUIRED));
  assert.match(txt(apiErrorResult(500, null)), /answered 500/);
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
  const free = txt(accountResult({ login: "kim", plan: "free", limits: { maxBytes: 2_000_000, publishTier: "authenticated" }, billing: null }, "https://aired.sh/upgrade?ref=mcp"));
  assert.match(free, /Plan: Free\nLargest page: 2 MB\nPublish limit: 30 an hour/);
  assert.match(free, /upgrade_url: https:\/\/aired\.sh\/upgrade\?ref=mcp \(a person needs to open it\)/);
  const pro = txt(accountResult({ login: "kim", plan: "pro", limits: { maxBytes: 10_000_000, publishTier: "pro" }, billing: { renewsAt: "2027-11-25T00:00:00Z", cancelAtPeriodEnd: false } }, "x"));
  assert.match(pro, /Plan: Pro\nLargest page: 10 MB\nPublish limit: 500 a day\nRenews: 2027-11-25/);
  assert.doesNotMatch(pro, /upgrade_url/);
});

test("wiring: only an API key signs MCP callers in, and key tool calls skip the /mcp limit (the API applies its own)", () => {
  const mcp = readFileSync(new URL("../src/routes/mcp.ts", import.meta.url), "utf8");
  assert.match(mcp, /user !== null && c\.get\("authMethod"\) === "key" && authorization/);
  for (const tool of ["list_pages", "update_page", "delete_page", "get_account"]) {
    assert.match(mcp, new RegExp(`"${tool}",[\\s\\S]*?if \\(signedIn === null\\) return signInRequired\\(\\);`), tool);
  }
  const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(index, /if \(isMcpToolCall\(body\) && c\.get\("authMethod"\) !== "key"\) return publishRateLimit\(c, next\);/);
});
