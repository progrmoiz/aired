import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPageId, parseReport } from "../src/lib/report.ts";
import { isMcpToolCall } from "../src/lib/mcp-rpc.ts";
import { underBurstLimit } from "../src/lib/burst-limit.ts";

test("extractPageId accepts bare IDs and page URLs", () => {
  assert.equal(extractPageId("abc123XYZ0"), "abc123XYZ0");
  assert.equal(extractPageId("  https://aired.sh/p/abc123XYZ0  "), "abc123XYZ0");
  assert.equal(extractPageId("https://aired.sh/p/abc123XYZ0?x=1"), "abc123XYZ0");
  assert.equal(extractPageId("aired.sh/p/abc123XYZ0/"), "abc123XYZ0");
  assert.equal(extractPageId("https://example.com/whatever"), null);
  assert.equal(extractPageId("../../etc"), null);
});

test("parseReport keeps old clients working with category default", () => {
  const r = parseReport({ id: "abc123XYZ0", reason: "reported via viewer bar" });
  assert.deepEqual(r, {
    ok: true,
    report: { pageId: "abc123XYZ0", category: "other", reason: "reported via viewer bar", contact: null },
  });
});

test("parseReport validates category, reason and contact", () => {
  assert.equal(parseReport({ id: "abc123XYZ0", category: "nope", reason: "x" }).ok, false);
  assert.equal(parseReport({ id: "abc123XYZ0", category: "spam", reason: "   " }).ok, false);
  assert.equal(parseReport({ id: "abc123XYZ0", reason: "x", contact: 42 }).ok, false);
  assert.equal(parseReport({ id: "not a page", reason: "x" }).ok, false);
  assert.equal(parseReport(["abc123XYZ0"]).ok, false);

  const r = parseReport({ id: "https://aired.sh/p/abc123XYZ0", category: "phishing", reason: "y".repeat(2000), contact: " me@example.com " });
  assert.ok(r.ok);
  assert.equal(r.report.category, "phishing");
  assert.equal(r.report.reason.length, 1000);
  assert.equal(r.report.contact, "me@example.com");
});

test("only MCP tool calls count toward the publish limit", () => {
  assert.equal(isMcpToolCall({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }), true);
  assert.equal(isMcpToolCall([{ method: "notifications/initialized" }, { method: "tools/call" }]), true);
  assert.equal(isMcpToolCall({ jsonrpc: "2.0", id: 1, method: "initialize" }), false);
  assert.equal(isMcpToolCall({ jsonrpc: "2.0", id: 2, method: "tools/list" }), false);
  assert.equal(isMcpToolCall([{ method: "ping" }]), false);
  assert.equal(isMcpToolCall(null), false);
  assert.equal(isMcpToolCall("tools/call"), false);
});

test("burst limit blocks when the binding says no", async () => {
  const calls: string[] = [];
  const limiter = {
    async limit({ key }: { key: string }) {
      calls.push(key);
      return { success: calls.length <= 2 };
    },
  };
  assert.equal(await underBurstLimit(limiter, "rl:ip:a"), true);
  assert.equal(await underBurstLimit(limiter, "rl:ip:a"), true);
  assert.equal(await underBurstLimit(limiter, "rl:ip:a"), false);
  assert.deepEqual(calls, ["rl:ip:a", "rl:ip:a", "rl:ip:a"]);
});

test("burst limit fails open when the binding is missing or errors", async () => {
  assert.equal(await underBurstLimit(undefined, "k"), true);
  const broken = { async limit(): Promise<{ success: boolean }> { throw new Error("down"); } };
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await underBurstLimit(broken, "k"), true);
  } finally {
    console.error = original;
  }
});
