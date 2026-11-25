import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  addClaimResult,
  authorizePageWrite,
  CLAIM_RETRY_WINDOW_MS,
  pageCredentials,
  planClaim,
  type ClaimBatchResult,
  type ClaimRecord,
} from "../src/lib/claim-decision.ts";

const ME = 4242;
const OTHER = 777;
const NOW = 1_800_000_000_000;

// Same scheme as @aired/core: SHA-256 hex of the token.
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const OLD = "at_old_token_from_the_claim_link";
const NEW = "at_new_token_from_the_claim_response";

/** A matcher for one supplied token that records which hashes it was asked about. */
function matcherFor(token: string) {
  const asked: string[] = [];
  const matches = async (hash: string) => {
    asked.push(hash);
    return sha(token) === hash;
  };
  return { matches, asked };
}

function record(over: Partial<ClaimRecord> = {}): ClaimRecord {
  return { ownerId: ME, tokenHash: sha(NEW), prevTokenHash: sha(OLD), claimedAt: NOW, ...over };
}

// --- planClaim -------------------------------------------------------------

test("an unowned page with the right token is claimed", async () => {
  const m = matcherFor(OLD);
  const plan = await planClaim({ kvOwnerId: null, kvTokenHash: sha(OLD), record: null, userId: ME, now: NOW, matches: m.matches });
  assert.equal(plan, "claim");
  assert.deepEqual(m.asked, [sha(OLD)]);
});

test("an unowned page with a wrong token is denied", async () => {
  const m = matcherFor("at_guess");
  const plan = await planClaim({ kvOwnerId: null, kvTokenHash: sha(OLD), record: null, userId: ME, now: NOW, matches: m.matches });
  assert.equal(plan, "deny");
});

test("someone else's page is denied without checking the token", async () => {
  const m = matcherFor(OLD);
  assert.equal(
    await planClaim({ kvOwnerId: OTHER, kvTokenHash: sha(OLD), record: null, userId: ME, now: NOW, matches: m.matches }),
    "deny",
  );
  assert.deepEqual(m.asked, []);
});

test("a claim row beats a stale KV record that still says unowned", async () => {
  // KV was written back stale after OTHER claimed: the old token matches KV,
  // but the D1 row says the page is OTHER's.
  const m = matcherFor(OLD);
  const plan = await planClaim({
    kvOwnerId: null,
    kvTokenHash: sha(OLD),
    record: record({ ownerId: OTHER }),
    userId: ME,
    now: NOW,
    matches: m.matches,
  });
  assert.equal(plan, "deny");
  assert.deepEqual(m.asked, []);
});

test("the claimer retrying with the old token inside the window gets a new token", async () => {
  const m = matcherFor(OLD);
  const plan = await planClaim({
    kvOwnerId: ME,
    kvTokenHash: sha(NEW),
    record: record(),
    userId: ME,
    now: NOW + CLAIM_RETRY_WINDOW_MS - 1,
    matches: m.matches,
  });
  assert.equal(plan, "reissue");
  assert.deepEqual(m.asked, [sha(OLD)]);
});

test("the old token can't reissue once the window has passed", async () => {
  const m = matcherFor(OLD);
  const plan = await planClaim({
    kvOwnerId: ME,
    kvTokenHash: sha(NEW),
    record: record(),
    userId: ME,
    now: NOW + CLAIM_RETRY_WINDOW_MS,
    matches: m.matches,
  });
  assert.equal(plan, "owned");
});

test("a session alone never mints a token: any other token on your own page is just 'owned'", async () => {
  for (const token of ["at_made_up", NEW]) {
    const m = matcherFor(token);
    const plan = await planClaim({ kvOwnerId: ME, kvTokenHash: sha(NEW), record: record(), userId: ME, now: NOW, matches: m.matches });
    assert.equal(plan, "owned", token);
  }
});

test("a page owned from the start (no claim row) is never rotated", async () => {
  const m = matcherFor(OLD);
  const plan = await planClaim({ kvOwnerId: ME, kvTokenHash: sha(OLD), record: null, userId: ME, now: NOW, matches: m.matches });
  assert.equal(plan, "owned");
});

test("user id 0 is not confused with an unowned page", async () => {
  const m = matcherFor("at_x");
  assert.equal(await planClaim({ kvOwnerId: 0, kvTokenHash: sha(OLD), record: null, userId: 0, now: NOW, matches: m.matches }), "owned");
  assert.equal(await planClaim({ kvOwnerId: 0, kvTokenHash: sha(OLD), record: null, userId: ME, now: NOW, matches: matcherFor(OLD).matches }), "deny");
});

// --- pageCredentials and authorizePageWrite ---------------------------------

test("the claim row's owner and hash win over the KV record", () => {
  assert.deepEqual(pageCredentials(null, sha(OLD), record()), { ownerId: ME, tokenHash: sha(NEW) });
  assert.deepEqual(pageCredentials(OTHER, sha(OLD), null), { ownerId: OTHER, tokenHash: sha(OLD) });
});

test("after a claim, the old token can't write even if KV was reverted to it", async () => {
  // KV holds the pre-claim record (ownerId null, old hash): what a stale
  // write-back leaves behind. Token checks go through pageCredentials.
  const creds = pageCredentials(null, sha(OLD), record());
  const old = await authorizePageWrite({ ...creds, token: OLD, userId: null, allowSession: true, matches: matcherFor(OLD).matches });
  assert.deepEqual(old, { ok: false, reason: "bad_token" });

  const fresh = await authorizePageWrite({ ...creds, token: NEW, userId: null, allowSession: true, matches: matcherFor(NEW).matches });
  assert.deepEqual(fresh, { ok: true, viaToken: true });
});

test("the owner's session updates a claimed page even with a stale token, and gets no token back", async () => {
  const creds = pageCredentials(null, sha(OLD), record());
  const auth = await authorizePageWrite({ ...creds, token: OLD, userId: ME, allowSession: true, matches: matcherFor(OLD).matches });
  assert.deepEqual(auth, { ok: true, viaToken: false });
});

test("token-only paths ignore the session", async () => {
  const creds = pageCredentials(null, sha(OLD), record());
  const auth = await authorizePageWrite({ ...creds, token: OLD, userId: ME, allowSession: false, matches: matcherFor(OLD).matches });
  assert.deepEqual(auth, { ok: false, reason: "bad_token" });
});

test("no token and someone else's session is 'no_token'", async () => {
  const creds = pageCredentials(ME, sha(NEW), null);
  const auth = await authorizePageWrite({ ...creds, token: null, userId: OTHER, allowSession: true, matches: matcherFor("").matches });
  assert.deepEqual(auth, { ok: false, reason: "no_token" });
});

// --- addClaimResult ------------------------------------------------------------

test("claim-batch keeps claimed as ids and puts new tokens in a separate map", () => {
  const acc: ClaimBatchResult = { claimed: [], failed: [], tokens: {} };
  addClaimResult(acc, "a", { ok: true, update_token: NEW });
  addClaimResult(acc, "b", { ok: true }); // already owned: no token
  addClaimResult(acc, "c", { ok: false });
  addClaimResult(acc, "d", { ok: true, update_token: 42 });
  assert.deepEqual(acc, {
    claimed: ["a", "b", "d"],
    failed: [{ id: "c", reason: "claim failed" }],
    tokens: { a: NEW },
  });
});
