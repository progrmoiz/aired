import { test } from "node:test";
import assert from "node:assert/strict";
import { csrfHeaderRequired } from "../src/lib/csrf-rule.ts";
import { readUpdateToken } from "../src/lib/page-token.ts";
import { TIERS, publishTier } from "../src/lib/rate-limit-tiers.ts";

test("token-only API calls don't need the CSRF header", () => {
  // A curl or agent call carries no cookie, so a forged cross-site request
  // has nothing to ride on.
  assert.equal(csrfHeaderRequired("PUT", false), false);
  assert.equal(csrfHeaderRequired("DELETE", false), false);
});

test("cookie-authenticated writes still need the CSRF header", () => {
  assert.equal(csrfHeaderRequired("PUT", true), true);
  assert.equal(csrfHeaderRequired("DELETE", true), true);
  assert.equal(csrfHeaderRequired("POST", true), true);
  assert.equal(csrfHeaderRequired("GET", true), false);
  assert.equal(csrfHeaderRequired("HEAD", true), false);
  assert.equal(csrfHeaderRequired("OPTIONS", true), false);
});

test("update token is read from the body or a Bearer header", () => {
  assert.equal(readUpdateToken("tok_body", undefined), "tok_body");
  assert.equal(readUpdateToken(undefined, "Bearer tok_header"), "tok_header");
  assert.equal(readUpdateToken(undefined, "Bearer   tok_header  "), "tok_header");
  // The body wins when both are sent.
  assert.equal(readUpdateToken("tok_body", "Bearer tok_header"), "tok_body");
  assert.equal(readUpdateToken(undefined, undefined), null);
  assert.equal(readUpdateToken(42, "Basic abc"), null);
  assert.equal(readUpdateToken(undefined, "Bearer "), null);
});

test("signed-in publishes get the account limit, not the per-IP one", () => {
  assert.equal(publishTier({ id: "u1" }), TIERS.authenticated);
  assert.equal(publishTier(null), TIERS.anonymous);
  assert.equal(publishTier(undefined), TIERS.anonymous);
});
