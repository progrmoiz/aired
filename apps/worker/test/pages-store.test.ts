import { test } from "node:test";
import assert from "node:assert/strict";
import type { PageMetadata } from "@aired/core";
import { fakeD1 } from "./helpers/d1.ts";
import {
  claimPageRow,
  decodeCursor,
  ensurePageRow,
  getPageRow,
  insertPageRow,
  insertPageRows,
  isLive,
  listOwnerPages,
  listOwnerProjects,
  livePageIds,
  markPageDeleted,
  metadataFromRow,
  pageRowsFor,
  releaseOwnerPages,
  replacePageToken,
  resolvePage,
  rowFromMetadata,
  updatePageContent,
  claimsFor,
  type PageRow,
} from "../src/lib/pages-store.ts";
import { DELETED_TOKEN_HASH, tombstoneClaim, upsertClaim } from "../src/lib/page-claims.ts";

const NOW = Date.parse("2026-11-27T12:00:00Z");
const HOUR = 60 * 60 * 1000;

function meta(id: string, over: Partial<PageMetadata> = {}): PageMetadata {
  return {
    id,
    title: `Page ${id}`,
    size: 100,
    tokenHash: `h_${id}`,
    pin: null,
    reads: null,
    readCount: 3,
    permanent: false,
    createdAt: new Date(NOW - HOUR).toISOString(),
    expiresAt: new Date(NOW + 24 * HOUR).toISOString(),
    ownerId: null,
    project: null,
    ...over,
  };
}

const row = (id: string, over: Partial<PageRow> = {}): PageRow => ({ ...rowFromMetadata(meta(id), null, NOW), ...over });

test("the migration's table round-trips a row", async () => {
  const { db } = fakeD1();
  const r = row("a", { ownerId: 7, project: "docs", pin: "pbkdf2$x", reads: 5, permanent: true, expiresAt: null });
  assert.equal(await insertPageRow(db, r), true);
  assert.deepEqual(await getPageRow(db, "a"), r);
  assert.equal(await insertPageRow(db, { ...r, title: "other" }), false, "an existing row wins");
  assert.equal((await getPageRow(db, "a"))!.title, "Page a");
});

test("rowFromMetadata: the claim row decides owner and token; a tombstone makes a deleted row", () => {
  const m = meta("p", { ownerId: null, tokenHash: "h_stale" });
  const plain = rowFromMetadata(m, null, NOW);
  assert.equal(plain.tokenHash, "h_stale");
  assert.equal(plain.createdAt, NOW - HOUR);
  assert.equal(plain.expiresAt, NOW + 24 * HOUR);

  const claimed = rowFromMetadata(m, { ownerId: 9, tokenHash: "h_new", prevTokenHash: "h_stale", claimedAt: 5 }, NOW);
  assert.deepEqual([claimed.ownerId, claimed.tokenHash, claimed.prevTokenHash, claimed.claimedAt], [9, "h_new", "h_stale", 5]);

  const released = rowFromMetadata(meta("p", { ownerId: 9 }), { ownerId: null, tokenHash: "h_new", prevTokenHash: "h_old", claimedAt: 5 }, NOW);
  assert.equal(released.ownerId, null, "a released claim beats a stale KV owner");

  const dead = rowFromMetadata(m, { ownerId: null, tokenHash: DELETED_TOKEN_HASH, prevTokenHash: DELETED_TOKEN_HASH, claimedAt: 5 }, NOW);
  assert.equal(dead.deletedAt, NOW);
  assert.equal(isLive(dead, NOW), false);
});

test("metadataFromRow rebuilds a KV record that parses back to the same page", () => {
  const r = row("a", { ownerId: 3, project: "x" });
  const m = metadataFromRow(r, 12);
  assert.equal(m.readCount, 12);
  assert.equal(m.createdAt, new Date(r.createdAt).toISOString());
  assert.deepEqual(rowFromMetadata(m, null, r.updatedAt), r);
});

test("resolvePage creates the row from KV and page_claims once, then reads it", async () => {
  const { db } = fakeD1();
  assert.equal(await resolvePage(db, "a", null, NOW), null);
  await upsertClaim(db, "a", { ownerId: 4, tokenHash: "h_claimed", prevTokenHash: "h_a", claimedAt: 1 }, "h_a");
  const first = await resolvePage(db, "a", meta("a"), NOW);
  assert.deepEqual([first!.ownerId, first!.tokenHash], [4, "h_claimed"]);
  // A stale KV record later on changes nothing.
  const again = await resolvePage(db, "a", meta("a", { tokenHash: "h_a", title: "stale" }), NOW + 1);
  assert.deepEqual(again, first);
  // A mismatched record is ignored.
  assert.equal(await resolvePage(db, "b", meta("other"), NOW), null);
});

test("ensurePageRow returns the winner when another write inserted first", async () => {
  const { db } = fakeD1();
  await insertPageRow(db, row("a", { ownerId: 1 }));
  const got = await ensurePageRow(db, meta("a"), NOW);
  assert.equal(got!.ownerId, 1);
});

test("updatePageContent and markPageDeleted; a deleted page can't be updated", async () => {
  const { db } = fakeD1();
  await insertPageRow(db, row("a"));
  assert.equal(await updatePageContent(db, "a", { title: "T", size: 9, expiresAt: NOW + 5 }, NOW + 1), true);
  const r = (await getPageRow(db, "a"))!;
  assert.deepEqual([r.title, r.size, r.expiresAt, r.updatedAt], ["T", 9, NOW + 5, NOW + 1]);
  await markPageDeleted(db, "a", NOW + 2);
  const d = (await getPageRow(db, "a"))!;
  assert.deepEqual([d.deletedAt, d.tokenHash], [NOW + 2, DELETED_TOKEN_HASH]);
  assert.equal(await updatePageContent(db, "a", { title: "X", size: 1, expiresAt: null }, NOW + 3), false);
});

test("claimPageRow: first claim wins, only on an unowned live page with the checked hash", async () => {
  const { db } = fakeD1();
  await insertPageRow(db, row("a"));
  const claim = (ownerId: number) => ({ ownerId, tokenHash: `h_${ownerId}`, prevTokenHash: "h_a", claimedAt: NOW });
  assert.equal(await claimPageRow(db, "a", claim(1), "h_wrong"), false);
  assert.equal(await claimPageRow(db, "a", claim(1), "h_a"), true);
  assert.equal(await claimPageRow(db, "a", claim(2), "h_a"), false, "already owned");
  const r = (await getPageRow(db, "a"))!;
  assert.deepEqual([r.ownerId, r.tokenHash, r.prevTokenHash, r.claimedAt], [1, "h_1", "h_a", NOW]);

  await insertPageRow(db, row("d"));
  await markPageDeleted(db, "d", NOW);
  assert.equal(await claimPageRow(db, "d", claim(1), DELETED_TOKEN_HASH), false, "a deleted page can't be claimed");

  assert.equal(await replacePageToken(db, "a", 2, "h_x", NOW), false);
  assert.equal(await replacePageToken(db, "a", 1, "h_x", NOW), true);
  assert.equal((await getPageRow(db, "a"))!.tokenHash, "h_x");
});

test("releaseOwnerPages makes every page anonymous and returns the live ones", async () => {
  const { db } = fakeD1();
  await insertPageRow(db, row("a", { ownerId: 1 }));
  await insertPageRow(db, row("b", { ownerId: 1, tokenHash: "h_b2" }));
  await insertPageRow(db, row("c", { ownerId: 2 }));
  await insertPageRow(db, row("d", { ownerId: 1 }));
  await markPageDeleted(db, "d", NOW);
  const released = await releaseOwnerPages(db, 1, NOW);
  assert.deepEqual(
    released.map((r) => [r.id, r.ownerId, r.tokenHash]).sort(),
    [["a", null, "h_a"], ["b", null, "h_b2"]],
  );
  assert.equal((await getPageRow(db, "d"))!.ownerId, null, "deleted pages are unlinked too");
  assert.equal((await getPageRow(db, "c"))!.ownerId, 2);
});

test("listOwnerPages: newest first, live only, filtered, paged by cursor", async () => {
  const { db } = fakeD1();
  const mk = (id: string, minutes: number, over: Partial<PageRow> = {}) =>
    insertPageRow(db, row(id, { ownerId: 1, createdAt: NOW - minutes * 60_000, ...over }));
  await mk("p1", 1, { project: "docs" });
  await mk("p2", 2);
  await mk("p3", 3, { project: "docs" });
  await mk("p4", 4, { expiresAt: NOW - 1 }); // expired
  await mk("p5", 5);
  await mk("p6", 5); // same created_at as p5: id breaks the tie
  await mk("p7", 7, { ownerId: 2 });
  await mk("p8", 8);
  await markPageDeleted(db, "p8", NOW);

  const page1 = await listOwnerPages(db, 1, { kind: "all" }, undefined, 3, NOW);
  assert.deepEqual(page1.rows.map((r) => r.id), ["p1", "p2", "p3"]);
  const page2 = await listOwnerPages(db, 1, { kind: "all" }, page1.cursor!, 3, NOW);
  assert.deepEqual(page2.rows.map((r) => r.id), ["p6", "p5"]);
  assert.equal(page2.cursor, null);

  assert.deepEqual((await listOwnerPages(db, 1, { kind: "project", name: "docs" }, undefined, 20, NOW)).rows.map((r) => r.id), ["p1", "p3"]);
  assert.deepEqual((await listOwnerPages(db, 1, { kind: "unsorted" }, undefined, 20, NOW)).rows.map((r) => r.id), ["p2", "p6", "p5"]);
  assert.deepEqual((await listOwnerPages(db, 1, { kind: "all" }, "not-a-cursor", 2, NOW)).rows.map((r) => r.id), ["p1", "p2"], "a bad cursor starts over");
  assert.deepEqual(decodeCursor("12.ab"), { createdAt: 12, id: "ab" });
  assert.equal(decodeCursor("x.ab"), null);

  assert.deepEqual(await listOwnerProjects(db, 1, NOW), [{ name: "docs", count: 2 }]);
});

test("batch helpers take any number of ids in one query", async () => {
  const { db } = fakeD1();
  const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
  const rows = ids.map((id) => row(id));
  assert.equal(await insertPageRows(db, rows), 250);
  assert.equal(await insertPageRows(db, rows), 0, "idempotent");
  await markPageDeleted(db, "id0", NOW);
  await updatePageContent(db, "id1", { title: null, size: 1, expiresAt: NOW - 1 }, NOW);
  const live = await livePageIds(db, ["id0", "id1", "id2", "nope"], NOW);
  assert.deepEqual([...live], ["id2"]);
  assert.equal((await pageRowsFor(db, ids)).size, 250);
  assert.deepEqual(await getPageRow(db, "id5"), rows[5]);

  await upsertClaim(db, "id3", { ownerId: 1, tokenHash: "n", prevTokenHash: "h_id3", claimedAt: 2 }, "h_id3");
  await tombstoneClaim(db, "id4", 3);
  const claims = await claimsFor(db, ["id3", "id4", "id5"]);
  assert.deepEqual([...claims.keys()].sort(), ["id3", "id4"]);
});
