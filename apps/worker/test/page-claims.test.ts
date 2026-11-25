import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  claimedIds,
  DELETED_TOKEN_HASH,
  getClaim,
  releaseClaimsForOwner,
  replaceClaimToken,
  tombstoneClaim,
  upsertClaim,
} from "../src/lib/page-claims.ts";

const MIGRATION = readFileSync(new URL("../migrations/0003_page_claims.sql", import.meta.url), "utf8");

/** Just enough of D1's API over node:sqlite to run the real SQL. */
function d1(withTable = true): D1Database {
  const db = new DatabaseSync(":memory:");
  if (withTable) db.exec(MIGRATION);
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) {
        // D1 refuses more than 100 bound parameters; node:sqlite allows far more.
        if (a.length > 100) throw new Error("D1_ERROR: too many SQL variables");
        args = a;
        return stmt;
      },
      async first() { return (db.prepare(sql).get(...(args as never[])) as unknown) ?? null; },
      async run() { const r = db.prepare(sql).run(...(args as never[])); return { meta: { changes: Number(r.changes) } }; },
      async all() { return { results: db.prepare(sql).all(...(args as never[])) }; },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}

const rec = (ownerId: number, tokenHash = "h_new", prevTokenHash = "h_old") => ({ ownerId, tokenHash, prevTokenHash, claimedAt: 1000 });

test("the first claim wins; a second insert for the same page changes nothing", async () => {
  const db = d1();
  assert.equal(await upsertClaim(db, "p1", rec(1), "h_old"), true);
  assert.equal(await upsertClaim(db, "p1", rec(2, "h_other"), "h_old"), false);
  assert.deepEqual(await getClaim(db, "p1"), { ownerId: 1, tokenHash: "h_new", prevTokenHash: "h_old", claimedAt: 1000 });
});

test("only the owner can replace the token", async () => {
  const db = d1();
  await upsertClaim(db, "p1", rec(1), "h_old");
  assert.equal(await replaceClaimToken(db, "p1", 2, "h_evil"), false);
  assert.equal(await replaceClaimToken(db, "p1", 1, "h_2"), true);
  assert.equal((await getClaim(db, "p1"))?.tokenHash, "h_2");
});

test("account deletion releases rows, keeps the rotated hash, and lets the page be claimed again", async () => {
  const db = d1();
  await upsertClaim(db, "p1", rec(1, "h_a"), "h_old");
  await upsertClaim(db, "p2", rec(1, "h_b"), "h_old");
  await upsertClaim(db, "p3", rec(2, "h_c"), "h_old");
  const released = await releaseClaimsForOwner(db, 1);
  assert.deepEqual([...released].sort(), [["p1", "h_a"], ["p2", "h_b"]]);
  assert.deepEqual(await getClaim(db, "p1"), { ownerId: null, tokenHash: "h_a", prevTokenHash: "h_old", claimedAt: 1000 });
  assert.equal((await getClaim(db, "p3"))?.ownerId, 2);
  // A released row is taken over only by a claim verified against its current hash.
  assert.equal(await upsertClaim(db, "p1", { ownerId: 5, tokenHash: "h_5", prevTokenHash: "h_old", claimedAt: 2000 }, "h_old"), false);
  assert.equal(await upsertClaim(db, "p1", { ownerId: 5, tokenHash: "h_5", prevTokenHash: "h_a", claimedAt: 2000 }, "h_a"), true);
  assert.equal((await getClaim(db, "p1"))?.ownerId, 5);
});

test("a deleted page keeps a tombstone that can't be claimed or matched", async () => {
  const db = d1();
  await upsertClaim(db, "p1", rec(1), "h_old");
  await tombstoneClaim(db, "p1", 5000);
  assert.deepEqual(await getClaim(db, "p1"), { ownerId: null, tokenHash: DELETED_TOKEN_HASH, prevTokenHash: DELETED_TOKEN_HASH, claimedAt: 1000 });
  assert.equal(await upsertClaim(db, "p1", rec(2), "h_new"), false);
  assert.equal(await upsertClaim(db, "p1", rec(2), DELETED_TOKEN_HASH), false);
  assert.equal(await replaceClaimToken(db, "p1", 1, "h_x"), false);
});

test("claimedIds finds this owner's rows across more ids than one query can bind", async () => {
  const db = d1();
  const ids = Array.from({ length: 200 }, (_, i) => `p${i}`);
  for (const id of ["p3", "p150", "p199"]) await upsertClaim(db, id, rec(1), "h_old");
  await upsertClaim(db, "p4", rec(2), "h_old");
  assert.deepEqual([...(await claimedIds(db, 1, ids))].sort(), ["p150", "p199", "p3"]);
  assert.deepEqual([...(await claimedIds(db, 1, []))], []);
});

test("a page deleted without ever being claimed still gets a tombstone", async () => {
  const db = d1();
  await tombstoneClaim(db, "p9", 5000);
  assert.deepEqual(await getClaim(db, "p9"), { ownerId: null, tokenHash: DELETED_TOKEN_HASH, prevTokenHash: DELETED_TOKEN_HASH, claimedAt: 5000 });
  // A stale KV copy's token (verified against the KV hash) can't claim it.
  assert.equal(await upsertClaim(db, "p9", rec(1), "h_old"), false);
});

test("before the migration every query fails, so token checks fail closed", async () => {
  const db = d1(false);
  await assert.rejects(getClaim(db, "p1"), /no such table/);
  await assert.rejects(claimedIds(db, 1, ["p1"]), /no such table/);
  await assert.rejects(releaseClaimsForOwner(db, 1), /no such table/);
  await assert.rejects(tombstoneClaim(db, "p1", 1), /no such table/);
  await assert.rejects(upsertClaim(db, "p1", rec(1), "h_old"), /no such table/);
});
