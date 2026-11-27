import { test } from "node:test";
import assert from "node:assert/strict";
import { replaceAllowed } from "../src/lib/page-options.ts";

test("replaceAllowed: a page with no responses can be replaced as before", () => {
  assert.equal(replaceAllowed({ ownerId: 7, userId: null, hasResponses: false }), true);
  assert.equal(replaceAllowed({ ownerId: null, userId: null, hasResponses: false }), true);
});

test("replaceAllowed: a page with responses needs its signed-in owner", () => {
  assert.equal(replaceAllowed({ ownerId: 7, userId: 7, hasResponses: true }), true);
  assert.equal(replaceAllowed({ ownerId: 7, userId: null, hasResponses: true }), false, "update token alone");
  assert.equal(replaceAllowed({ ownerId: 7, userId: 8, hasResponses: true }), false, "another account");
  assert.equal(replaceAllowed({ ownerId: null, userId: 8, hasResponses: true }), false, "no owner");
});
