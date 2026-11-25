import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Tripwire: route handlers can't be imported by these tests, so check their
// source. Every token check must go through the D1 claim row
// (authoritativeCredentials), never straight against the KV record's hash,
// which a stale write-back can reset to the pre-claim token.
const src = (f: string) => readFileSync(new URL(`../src/routes/${f}`, import.meta.url), "utf8");

for (const file of ["api.ts", "mcp.ts"]) {
  test(`${file}: no token is verified against the KV record's hash`, () => {
    const code = src(file);
    assert.doesNotMatch(code, /verifyToken\([^)]*metadata\.tokenHash/);
    assert.match(code, /authoritativeCredentials\(/);
  });
}

test("api.ts: delete tombstones the claim row instead of deleting it", () => {
  const code = src("api.ts");
  assert.match(code, /tombstoneClaim\(/);
  assert.doesNotMatch(code, /DELETE FROM page_claims/);
});

test("me.ts: account deletion releases claim rows and claims go through runClaim", () => {
  const code = src("me.ts");
  assert.match(code, /releaseClaimsForOwner\(/);
  assert.match(code, /runClaim\(/);
});
