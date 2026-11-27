import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { viewWrite } from "../src/lib/view-write.ts";

const NOW = Date.parse("2026-11-25T12:00:00Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();

test("a permanent page is written back with no expiry", () => {
  assert.deepEqual(viewWrite({ permanent: true, expiresAt: null }, NOW), { expired: false, options: {} });
  assert.deepEqual(viewWrite({ permanent: false, expiresAt: null }, NOW), { expired: false, options: {} });
});

test("an expiring page keeps its exact expiry", () => {
  assert.deepEqual(viewWrite({ permanent: false, expiresAt: at(3_600_000) }, NOW), {
    expired: false,
    options: { expiration: Math.floor((NOW + 3_600_000) / 1000) },
  });
});

test("a page past its expiry is expired, never rewritten without a TTL", () => {
  assert.deepEqual(viewWrite({ permanent: false, expiresAt: at(0) }, NOW), { expired: true });
  assert.deepEqual(viewWrite({ permanent: false, expiresAt: at(-500) }, NOW), { expired: true });
});

test("in its last minute the count is skipped (KV's minimum TTL is 60s)", () => {
  assert.deepEqual(viewWrite({ permanent: false, expiresAt: at(59_999) }, NOW), { expired: false, options: null });
  assert.equal(viewWrite({ permanent: false, expiresAt: at(60_000) }, NOW).expired, false);
  assert.notEqual((viewWrite({ permanent: false, expiresAt: at(60_000) }, NOW) as { options: unknown }).options, null);
});

test("an unreadable expiry skips the write instead of making the page permanent", () => {
  assert.deepEqual(viewWrite({ permanent: false, expiresAt: "not a date" }, NOW), { expired: false, options: null });
});

test("viewer.ts uses viewWrite for the 404, and a view writes neither the page record nor stats:live", () => {
  const code = readFileSync(new URL("../src/routes/viewer.ts", import.meta.url), "utf8");
  assert.match(code, /const write = viewWrite\(metadata, Date\.now\(\)\);\s*if \(write\.expired\) \{\s*return notFoundPage/);
  const view = code.slice(code.indexOf('viewer.get("/p/:id"'), code.indexOf('viewer.post("/p/:id/verify-pin"'));
  assert.ok(view.length > 0);
  assert.doesNotMatch(view, /PAGES_KV\.put|saveStats|recordView/);
  assert.match(view, /countPageView\(c\.env\.DB, id, metadata\.readCount, metadata\.reads\)/);
});
