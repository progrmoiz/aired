import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  addClaimResult,
  authoritativeCredentials,
  authorizePageWrite,
  runClaim,
  type ClaimDeps,
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
  addClaimResult(acc, "e", {}); // claimPage threw
  assert.deepEqual(acc, {
    claimed: ["a", "b", "d"],
    failed: [{ id: "c", reason: "claim failed" }, { id: "e", reason: "claim failed" }],
    tokens: { a: NEW },
  });
});

// --- released and deleted rows -------------------------------------------------

test("a released row (owner deleted their account) is claimable only with its rotated token", async () => {
  const released = record({ ownerId: null });
  // The stale KV record still has the pre-claim hash: it must not count.
  assert.equal(
    await planClaim({ kvOwnerId: null, kvTokenHash: sha(OLD), record: released, userId: OTHER, now: NOW, matches: matcherFor(OLD).matches }),
    "deny",
  );
  assert.equal(
    await planClaim({ kvOwnerId: null, kvTokenHash: sha(OLD), record: released, userId: OTHER, now: NOW, matches: matcherFor(NEW).matches }),
    "claim",
  );
});

test("a tombstoned row (page deleted) matches no token and no owner", async () => {
  const gone = record({ ownerId: null, tokenHash: "deleted", prevTokenHash: "deleted" });
  for (const token of [OLD, NEW, "deleted"]) {
    assert.equal(
      await planClaim({ kvOwnerId: null, kvTokenHash: sha(OLD), record: gone, userId: ME, now: NOW, matches: matcherFor(token).matches }),
      "deny",
    );
    const creds = pageCredentials(ME, sha(OLD), gone);
    assert.deepEqual(
      await authorizePageWrite({ ...creds, token, userId: ME, allowSession: true, matches: matcherFor(token).matches }),
      { ok: false, reason: "bad_token" },
    );
  }
});

test("authoritativeCredentials reads the claim row and fails closed when it can't", async () => {
  assert.deepEqual(await authoritativeCredentials(async () => record(), null, sha(OLD)), { ownerId: ME, tokenHash: sha(NEW) });
  assert.deepEqual(await authoritativeCredentials(async () => null, OTHER, sha(OLD)), { ownerId: OTHER, tokenHash: sha(OLD) });
  await assert.rejects(authoritativeCredentials(async () => { throw new Error("D1 down"); }, null, sha(OLD)), /D1 down/);
});

// --- runClaim ------------------------------------------------------------------

/** An in-memory claim store and KV page, with a log of every side effect. */
function fakeClaim(opts: { kvOwnerId: number | null; kvTokenHash: string; row?: ClaimRecord | null; userId: number; token: string; loseRaceTo?: ClaimRecord; rowAfterRead?: ClaimRecord }) {
  let row: ClaimRecord | null = opts.row ?? null;
  let reads = 0;
  const log: string[] = [];
  let n = 0;
  const deps: ClaimDeps = {
    getClaim: async () => {
      reads++;
      const current = row;
      // Simulate the row changing right after the first read.
      if (reads === 1 && opts.rowAfterRead !== undefined) row = opts.rowAfterRead;
      return current;
    },
    upsertClaim: async (rec, checkedHash) => {
      if (opts.loseRaceTo !== undefined && row === null) {
        row = opts.loseRaceTo;
        log.push("upsert:lost");
        return false;
      }
      if (row !== null && (row.ownerId !== null || row.tokenHash === "deleted" || row.tokenHash !== checkedHash)) {
        log.push("upsert:held");
        return false;
      }
      row = rec;
      log.push(`upsert:${rec.ownerId}`);
      return true;
    },
    replaceClaimToken: async (hash) => {
      if (row === null || row.ownerId !== opts.userId) return false;
      row = { ...row, tokenHash: hash };
      log.push("replace");
      return true;
    },
    newToken: () => `at_issued_${++n}`,
    hash: async (t) => sha(t),
    matches: async (hash) => sha(opts.token) === hash,
    mirrorToKv: async (ownerId, hash) => { log.push(`kv:${ownerId}:${hash === row?.tokenHash ? "row" : "other"}`); },
  };
  const run = (now = NOW) => runClaim({ kvOwnerId: opts.kvOwnerId, kvTokenHash: opts.kvTokenHash, userId: opts.userId, now }, deps);
  return { run, log, row: () => row };
}

test("runClaim: first claim stores the old hash as prev and mirrors the new hash", async () => {
  const f = fakeClaim({ kvOwnerId: null, kvTokenHash: sha(OLD), userId: ME, token: OLD });
  const out = await f.run();
  assert.deepEqual(out, { ok: true, token: "at_issued_1" });
  assert.deepEqual(f.row(), { ownerId: ME, tokenHash: sha("at_issued_1"), prevTokenHash: sha(OLD), claimedAt: NOW });
  assert.deepEqual(f.log, [`upsert:${ME}`, `kv:${ME}:row`]);
});

test("runClaim: a retry with the old token inside the window reissues the token", async () => {
  const f = fakeClaim({ kvOwnerId: null, kvTokenHash: sha(OLD), userId: ME, token: OLD });
  await f.run();
  const again = await f.run(NOW + 1000);
  assert.deepEqual(again, { ok: true, token: "at_issued_2" });
  assert.equal(f.row()?.tokenHash, sha("at_issued_2"));
  assert.equal(f.row()?.prevTokenHash, sha(OLD));
  assert.deepEqual(f.log, [`upsert:${ME}`, `kv:${ME}:row`, "replace", `kv:${ME}:row`]);
});

test("runClaim: on your own page with any other token, nothing is written and no token returned", async () => {
  const f = fakeClaim({ kvOwnerId: ME, kvTokenHash: sha(NEW), row: record(), userId: ME, token: "at_made_up" });
  assert.deepEqual(await f.run(), { ok: true, token: null });
  assert.deepEqual(f.log, []);
});

test("runClaim: losing the insert race to someone else is a deny, with no KV or index writes", async () => {
  const f = fakeClaim({ kvOwnerId: null, kvTokenHash: sha(OLD), userId: ME, token: OLD, loseRaceTo: record({ ownerId: OTHER }) });
  assert.deepEqual(await f.run(), { ok: false });
  assert.deepEqual(f.log, ["upsert:lost"]);
});

test("runClaim: losing the race to your own other request returns ok without retiring its token", async () => {
  const winner = record({ ownerId: ME, tokenHash: sha("at_winner") });
  const f = fakeClaim({ kvOwnerId: null, kvTokenHash: sha(OLD), userId: ME, token: OLD, loseRaceTo: winner });
  assert.deepEqual(await f.run(), { ok: true, token: null });
  assert.equal(f.row()?.tokenHash, sha("at_winner"));
  assert.deepEqual(f.log, ["upsert:lost"]);
});

test("runClaim: a released row is claimed with its rotated token; the old link token is refused", async () => {
  const released = record({ ownerId: null });
  const old = fakeClaim({ kvOwnerId: null, kvTokenHash: sha(OLD), row: released, userId: OTHER, token: OLD });
  assert.deepEqual(await old.run(), { ok: false });
  const fresh = fakeClaim({ kvOwnerId: null, kvTokenHash: sha(OLD), row: released, userId: OTHER, token: NEW });
  assert.deepEqual(await fresh.run(), { ok: true, token: "at_issued_1" });
  assert.equal(fresh.row()?.prevTokenHash, sha(NEW));
});

test("runClaim: a reissue whose row changed hands is refused, and nothing is mirrored", async () => {
  // Planned as a reissue, but by the time the token is replaced the row is
  // someone else's (released and re-claimed in between).
  const f = fakeClaim({
    kvOwnerId: ME,
    kvTokenHash: sha(NEW),
    row: record(),
    rowAfterRead: record({ ownerId: OTHER }),
    userId: ME,
    token: OLD,
  });
  assert.deepEqual(await f.run(NOW + 1000), { ok: false });
  assert.deepEqual(f.log, []);
});

test("runClaim: losing the race to a row that re-plans as claimable is a deny, not a silent success", async () => {
  // The insert lost to a released row whose hash the token happens to match:
  // nothing was written for this user, so it must not report success.
  const released = record({ ownerId: null, tokenHash: sha(OLD) });
  const f = fakeClaim({ kvOwnerId: null, kvTokenHash: sha(OLD), userId: ME, token: OLD, loseRaceTo: released });
  assert.deepEqual(await f.run(), { ok: false });
});

test("runClaim: a claim verified against a released row's hash fails if the row changed before the write", async () => {
  const released = record({ ownerId: null, tokenHash: sha(NEW) });
  const f = fakeClaim({
    kvOwnerId: null,
    kvTokenHash: sha(OLD),
    row: released,
    rowAfterRead: record({ ownerId: null, tokenHash: sha("at_someone_elses") }),
    userId: OTHER,
    token: NEW,
  });
  assert.deepEqual(await f.run(), { ok: false });
  assert.deepEqual(f.log, ["upsert:held"]);
});
