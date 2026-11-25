import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Tripwire: route handlers can't be imported by these tests, so check their
// source. Every token check must go through the D1 claim row (getClaim via
// authoritativeCredentials), never straight against the KV record's hash,
// which a stale write-back can reset to the pre-claim token.
const src = (f: string) => readFileSync(new URL(`../src/routes/${f}`, import.meta.url), "utf8");
const count = (code: string, re: RegExp) => (code.match(new RegExp(re.source, "g")) ?? []).length;

test("api.ts: publish-update, PUT and DELETE all read credentials from the claim row", () => {
  const code = src("api.ts");
  assert.doesNotMatch(code, /verifyToken\([^)]*metadata\.tokenHash/);
  assert.match(code, /authoritativeCredentials\(\s*\(\) => getClaim\(db, id\)/);
  assert.equal(count(code, /await credentialsFor\(c\.env\.DB, /), 3);
});

test("api.ts: PUT accepts the owner's session, writes back the row's owner and hash, and DELETE checks the row's owner", () => {
  const code = src("api.ts");
  assert.match(code, /allowSession: true/);
  assert.equal(count(code, /\.\.\.metadata,\s*\n\s*\/\/ Write the authoritative owner and hash[^\n]*\n\s*ownerId: creds\.ownerId,\s*\n\s*tokenHash: creds\.tokenHash,/), 2);
  assert.match(code, /creds\.ownerId === deleteUser\.id/);
});

test("api.ts: DELETE tombstones the page's claim row", () => {
  const code = src("api.ts");
  assert.match(code, /tombstoneClaim\(c\.env\.DB, id, /);
  assert.doesNotMatch(code, /DELETE FROM page_claims/);
});

test("mcp.ts: MCP updates read credentials from the claim row", () => {
  const code = src("mcp.ts");
  assert.doesNotMatch(code, /verifyToken\([^)]*metadata\.tokenHash/);
  assert.match(code, /authoritativeCredentials\(\s*\(\) => getClaim\(env\.DB, existingId\)/);
});

test("me.ts: claims go through runClaim; account deletion releases rows and mirrors their hash", () => {
  const code = src("me.ts");
  assert.match(code, /runClaim\(/);
  assert.match(code, /releaseClaimsForOwner\(c\.env\.DB, userId\)/);
  assert.match(code, /tokenHash: released\.get\(pageId\) \?\? metadata\.tokenHash/);
});
