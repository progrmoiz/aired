import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { outputShapes, pageOut, patchBody } from "../src/lib/mcp-shapes.ts";
import {
  accountResult,
  deleteResult,
  feedbackResult,
  listResult,
  pageResult,
  publishResult,
  publishUpdateResult,
  setOptionsResult,
  updateResult,
  type ToolResult,
} from "../src/lib/mcp-account.ts";

const O = "https://aired.sh";

/** The structured content, checked against the tool's schema as the MCP SDK checks it (strict here, so no stray keys). */
function valid(tool: keyof typeof outputShapes, r: ToolResult): Record<string, unknown> {
  assert.equal(r.isError, undefined);
  assert.ok(r.content[0]!.text.length > 0, "text is kept next to the structured content");
  const parsed = z.object(outputShapes[tool]).strict().safeParse(r.structuredContent);
  assert.ok(parsed.success, `${tool}: ${parsed.success ? "" : parsed.error.message}`);
  return r.structuredContent!;
}

// The API's answers as routes/api.ts and routes/me.ts send them.
const details = {
  id: "p1",
  url: `${O}/p/p1`,
  title: "Q4",
  size: 2048,
  readCount: 3,
  reads: 10,
  hasPin: true,
  permanent: false,
  createdAt: "2026-11-27T10:00:00.000Z",
  expiresAt: "2026-12-04T10:00:00.000Z",
  project: "reports",
};

test("get_page and set_options: the page's settings, snake_case, never the PIN", () => {
  const page = valid("get_page", pageResult(details, O));
  assert.deepEqual(page, {
    id: "p1",
    url: `${O}/p/p1`,
    title: "Q4",
    size: 2048,
    views: 3,
    view_limit: 10,
    has_pin: true,
    permanent: false,
    created_at: "2026-11-27T10:00:00.000Z",
    expires_at: "2026-12-04T10:00:00.000Z",
    project: "reports",
  });
  const set = valid("set_options", setOptionsResult({ ...details, changed: ["pin", "expiry"] }, O));
  assert.deepEqual(set.changed, ["pin", "expiry"]);
  assert.match(setOptionsResult({ ...details, changed: ["pin"] }, O).content[0]!.text, /^Changed pin of https:\/\/aired\.sh\/p\/p1\n[\s\S]*PIN: on/);
  // A PIN the API might send by mistake still never comes out.
  assert.ok(!JSON.stringify(pageOut({ ...details, pin: "pbkdf2$secret" }, O)).includes("secret"));
});

test("publish_html: create, by-id update and token update share one shape", () => {
  const created = valid("publish_html", publishResult({ id: "a", url: `${O}/p/a`, update_token: "at_x", expiresAt: null, upgrade: { url: `${O}/upgrade?ref=publish` } }, "kim"));
  assert.deepEqual(created, {
    id: "a",
    url: `${O}/p/a`,
    updated: false,
    // An owned page is updated by id: its token stays out of the transcript, as in the text.
    update_token: null,
    expires_at: null,
    owner: "kim",
    claim_url: null,
    upgrade_url: `${O}/upgrade?ref=publish`,
  });
  const byId = valid("publish_html", publishUpdateResult({ id: "a", url: `${O}/p/a`, expiresAt: null }, "kim"));
  assert.equal(byId.updated, true);
  assert.equal(byId.update_token, null);
  const byToken = valid("publish_html", publishUpdateResult({ id: "a", url: `${O}/p/a`, update_token: "at_x", expiresAt: "2026-12-04T00:00:00Z" }, null));
  assert.equal(byToken.owner, null);
  assert.equal(byToken.update_token, "at_x");
});

test("list_pages, update_page, delete_page, get_account and send_feedback", () => {
  const list = valid(
    "list_pages",
    listResult({ pages: [{ id: "a1", title: "R", size: 10, readCount: 2, reads: null, permanent: true, createdAt: "2026-11-01T00:00:00Z", expiresAt: null, hasPin: false, ownerId: 7, project: null, tile: null }], cursor: "c2" }, O),
  );
  assert.equal((list.pages as Array<{ url: string }>)[0]!.url, `${O}/p/a1`);
  assert.equal(list.cursor, "c2");
  assert.deepEqual(valid("list_pages", listResult({ pages: [], cursor: null }, O)), { pages: [], cursor: null });
  assert.deepEqual(valid("update_page", updateResult({ id: "a", url: `${O}/p/a`, expiresAt: null })), { id: "a", url: `${O}/p/a`, expires_at: null, upgrade_url: null });
  assert.deepEqual(valid("delete_page", deleteResult("a")), { id: "a", deleted: true });
  const opts = { upgradeUrl: `${O}/upgrade?ref=mcp`, freePublishLimit: "30 an hour", proPublishLimit: "500 a day" };
  const free = valid("get_account", accountResult({ login: "kim", plan: "free", limits: { maxBytes: 2_000_000, publishTier: "authenticated" }, billing: null }, opts));
  assert.deepEqual(free, { login: "kim", plan: "free", max_bytes: 2_000_000, publish_limit: "30 an hour", renews_at: null, cancel_at_period_end: false, upgrade_url: `${O}/upgrade?ref=mcp` });
  const pro = valid("get_account", accountResult({ login: "kim", plan: "pro", limits: { maxBytes: 10_000_000, publishTier: "pro" }, billing: { renewsAt: "2027-01-01T00:00:00Z", cancelAtPeriodEnd: true } }, opts));
  assert.equal(pro.upgrade_url, null);
  assert.equal(pro.publish_limit, "500 a day");
  assert.equal(pro.cancel_at_period_end, true);
  assert.deepEqual(valid("send_feedback", feedbackResult({ id: "fb_abc", message: "Thanks." })), { id: "fb_abc", message: "Thanks." });
});

test("set_options arguments become the PATCH body the API reads", () => {
  assert.deepEqual(patchBody({ title: null, pin: "1234", ttl_seconds: 60, permanent: false, view_limit: null, update_token: "at_x" }), {
    title: null,
    pin: "1234",
    ttl: 60,
    permanent: false,
    reads: null,
    update_token: "at_x",
  });
  assert.deepEqual(patchBody({}), {});
});

test("both servers declare an outputSchema on every tool and keep their hints", () => {
  const hosted = readFileSync(new URL("../src/routes/mcp.ts", import.meta.url), "utf8");
  const stdio = readFileSync(new URL("../../mcp/src/index.ts", import.meta.url), "utf8");
  const tools = (code: string) => [...code.matchAll(/registerTool\(\s*"(\w+)",[\s\S]*?outputSchema: outputShapes\.(\w+),\s*annotations: \{ title: "[^"]+", readOnlyHint: (?:true|false), destructiveHint: (?:true|false), idempotentHint: (?:true|false), openWorldHint: (?:true|false) \}/g)].map((m) => [m[1], m[2]]);
  for (const [code, names] of [
    [hosted, ["publish_html", "get_page", "set_options", "check_page", "send_feedback", "list_pages", "update_page", "delete_page", "get_account"]],
    [stdio, ["publish_html", "get_page", "set_options", "check_page", "send_feedback"]],
  ] as const) {
    assert.doesNotMatch(code, /server\.tool\(/, "no tool registered without a schema");
    const found = tools(code);
    assert.deepEqual(found.map((t) => t[0]), [...names]);
    for (const [name, shape] of found) assert.equal(name, shape, `${name} declares its own shape`);
    assert.equal((code.match(/registerTool\(/g) ?? []).length, names.length);
  }
  // Every success path of the stdio tools returns structured content.
  assert.equal((stdio.match(/structuredContent:/g) ?? []).length, 5);
});
