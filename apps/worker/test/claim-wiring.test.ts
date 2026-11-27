import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Tripwire: route handlers can't be imported by these tests, so check their
// source. Every token and owner check must go through the page's D1 row
// (loadPage in lib/page-write.ts), never straight against the KV record's
// hash, which a stale write-back can reset to the pre-claim token.
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const count = (code: string, re: RegExp) => (code.match(new RegExp(re.source, "g")) ?? []).length;

test("api.ts: publish-update, PUT and DELETE all read credentials from the D1 row", () => {
  const code = src("routes/api.ts");
  assert.doesNotMatch(code, /verifyToken\([^)]*metadata\.tokenHash/);
  assert.doesNotMatch(code, /getClaim|page_claims|PAGES_KV\.get\(`page:\$\{(existingId|id)\}`\)[\s\S]{0,200}verifyToken/);
  assert.match(code, /return \(await loadPage\(c\.env, id\)\) \?\? apiError\(c, 404, "not_found", "Page not found"\)/);
  // publish-update, PUT, DELETE, and the details and PATCH routes (set_options).
  assert.equal(count(code, /await pageFor\(c, /), 5);
  assert.equal(count(code, /const creds = \{ ownerId: page\.row\.ownerId, tokenHash: page\.row\.tokenHash \};/), 3);
  // Details and PATCH decide access from the row too (lib/page-options.ts pageAccess).
  assert.match(code, /ownerId: page\.row\.ownerId,\s*userId: c\.get\("user"\)\?\.id \?\? null,/);
  assert.match(code, /tokenMatches: token !== null && \(await verifyToken\(token, page\.row\.tokenHash\)\)/);
  assert.equal(count(code, /const access = await ownerAccess\(c, page, /), 2);
});

test("api.ts: PUT accepts the owner's session, and DELETE checks the row's owner", () => {
  const code = src("routes/api.ts");
  assert.match(code, /allowSession: true/);
  assert.match(code, /creds\.ownerId === deleteUser\.id/);
});

test("page-write.ts: loadPage reads the row (made from KV only if missing) and drops dead pages", () => {
  const code = src("lib/page-write.ts");
  assert.match(code, /const row = await resolvePage\(env\.DB, id, kv, now\);\s*if \(row === null \|\| !isLive\(row, now\)\) return null;/);
  // KV cache records are rebuilt from the row on update, so a stale one can't win.
  assert.match(code, /const metadata = cacheRecord\(updated, kv\);/);
});

test("page-write.ts: DELETE marks the row; the retired page_claims and KV indexes aren't written", () => {
  const code = src("lib/page-write.ts");
  // Marked first, so no update can bring the page back once a delete starts.
  const fn = code.slice(code.indexOf("export async function deletePage"));
  assert.match(fn, /^[^]*?\{\s*const \{ row \} = page;\s*await markPageDeleted\(env\.DB, row\.id, now\);\s*try \{\s*await removeContent\(env, row\.id\);/);
  // An update that raced a delete removes what it wrote.
  assert.match(code, /if \(after === null \|\| after\.deletedAt !== null\) \{\s*await removeContent\(env, row\.id\);/);
  assert.doesNotMatch(code, /tombstoneClaim|mirrorClaim|page_claims \(|DELETE FROM page_claims/);
  assert.doesNotMatch(code, /owner-index|addPageToOwner|removePageFromOwner|bumpProjectCount|indexForOwner/);
});

test("mcp.ts: MCP updates read credentials from the D1 row", () => {
  const code = src("routes/mcp.ts");
  assert.doesNotMatch(code, /verifyToken\([^)]*metadata\.tokenHash/);
  assert.match(code, /page = await loadPage\(env, existingId\);/);
  assert.match(code, /verifyToken\(update_token, page\.row\.tokenHash\)/);
});

test("me.ts: claims go through runClaim on the row; account deletion releases pages in D1 first", () => {
  const code = src("routes/me.ts");
  assert.match(code, /runClaim\(/);
  assert.match(code, /upsertClaim: \(record, checkedHash\) => claimPageRow\(env\.DB, pageId, record, checkedHash\)/);
  assert.match(code, /replaceClaimToken: \(hash\) => replacePageToken\(env\.DB, pageId, userId, hash, Date\.now\(\)\)/);
  // Pages are released in the same batch as the account rows.
  // Old claims too, so a page without a row can't come back owned by the deleted id.
  assert.match(code, /await deleteAccountRows\(c\.env\.DB, userId, \[\s*releaseOwnerPagesStatement\(c\.env\.DB, userId, now\),\s*releaseClaimsStatement\(c\.env\.DB, userId\),\s*\]\)/);
  assert.match(code, /claimIds = claimedPageIds\(claims\);/);
  assert.doesNotMatch(code, /releaseClaimsForOwner|mirrorClaim|indexForOwner|indexPage/);
  // Lists and project counts come from D1, not the KV indexes.
  assert.match(code, /listOwnerPages\(c\.env\.DB, ownerId, filter, cursor, limit, Date\.now\(\)\)/);
  assert.match(code, /listOwnerProjects\(c\.env\.DB, user\.id, Date\.now\(\)\)/);
  assert.doesNotMatch(code, /listPagesForOwner|listProjectsForOwner|claimedIds/);
});
