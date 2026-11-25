import { test } from "node:test";
import assert from "node:assert/strict";
import { decideClaim } from "../src/lib/claim-decision.ts";

const ME = 4242;
const OTHER = 777;

test("an unowned page with the right token is claimed", () => {
  assert.equal(decideClaim(null, ME, true), "claim");
});

test("an unowned page with a wrong or stale token is denied", () => {
  // A claim link whose token was already rotated lands here.
  assert.equal(decideClaim(null, ME, false), "deny");
});

test("someone else's page is denied even with a matching token", () => {
  assert.equal(decideClaim(OTHER, ME, true), "deny");
  assert.equal(decideClaim(OTHER, ME, false), "deny");
});

test("the owner's own page gets a new token whatever token was sent", () => {
  // A retry after a lost response sends the old, already-rotated token.
  assert.equal(decideClaim(ME, ME, false), "reissue");
  assert.equal(decideClaim(ME, ME, true), "reissue");
});

test("user id 0 is not confused with an unowned page", () => {
  assert.equal(decideClaim(0, 0, false), "reissue");
  assert.equal(decideClaim(null, 0, false), "deny");
  assert.equal(decideClaim(0, ME, true), "deny");
});
