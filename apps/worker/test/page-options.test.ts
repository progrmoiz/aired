import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PageMetadata } from "@aired/core";
import { fakeD1 } from "./helpers/d1.ts";
import {
  applyOptions,
  changedSettings,
  pageAccess,
  pageDetails,
  parseOptions,
  PIN_MAX,
  READS_MAX,
  TITLE_MAX,
  TTL_MAX,
  type OptionsChange,
} from "../src/lib/page-options.ts";
import { getPageRow, insertPageRow, markPageDeleted, rowFromMetadata, updatePageOptions } from "../src/lib/pages-store.ts";

const NOW = Date.parse("2026-11-27T12:00:00Z");
const HOUR = 3600_000;

const change = (body: unknown): OptionsChange => {
  const r = parseOptions(body);
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.change;
};
const refused = (body: unknown, re: RegExp) => {
  const r = parseOptions(body);
  assert.equal(r.ok, false, `accepted ${JSON.stringify(body)}`);
  if (!r.ok) assert.match(r.error, re);
};

// --- Who may read or change a page ------------------------------------------

test("another account's page is refused, signed in or with a wrong token", () => {
  const theirs = { ownerId: 7, userId: 8 };
  assert.deepEqual(pageAccess({ ...theirs, tokenSent: false, tokenMatches: false }), {
    ok: false,
    status: 403,
    error: "This page isn't yours. Send its update token to change it.",
  });
  assert.deepEqual(pageAccess({ ...theirs, tokenSent: true, tokenMatches: false }), { ok: false, status: 403, error: "Invalid update token" });
  // Being signed in never opens an anonymous page.
  assert.equal(pageAccess({ ownerId: null, userId: 8, tokenSent: false, tokenMatches: false }).ok, false);
  // No credentials at all: 401, so the agent knows to sign in.
  const anon = pageAccess({ ownerId: 7, userId: null, tokenSent: false, tokenMatches: false });
  assert.equal(anon.ok, false);
  if (!anon.ok) assert.equal(anon.status, 401);
});

test("the owner, or anyone with the page's token, gets in", () => {
  assert.deepEqual(pageAccess({ ownerId: 7, userId: 7, tokenSent: false, tokenMatches: false }), { ok: true, viaToken: false });
  // The owner with a stale token still gets in (as PUT allows).
  assert.deepEqual(pageAccess({ ownerId: 7, userId: 7, tokenSent: true, tokenMatches: false }), { ok: true, viaToken: false });
  assert.deepEqual(pageAccess({ ownerId: null, userId: null, tokenSent: true, tokenMatches: true }), { ok: true, viaToken: true });
  assert.deepEqual(pageAccess({ ownerId: 7, userId: 8, tokenSent: true, tokenMatches: true }), { ok: true, viaToken: true });
});

test("wiring: details and PATCH go through pageFor and ownerAccess before anything is read or written", () => {
  const api = readFileSync(new URL("../src/routes/api.ts", import.meta.url), "utf8");
  const details = api.slice(api.indexOf('api.get("/pages/:id/details"'), api.indexOf('api.patch("/pages/:id"'));
  assert.match(details, /rateLimit\(TIERS\.page_options\)/);
  assert.match(details, /const access = await ownerAccess\(c, page, sentUpdateToken\(c\)\);\s*if \(!access\.ok\) return c\.json\(\{ error: access\.error \}, access\.status\);\s*return c\.json\(pageDetails\(/);
  const patch = api.slice(api.indexOf('api.patch("/pages/:id"'), api.indexOf('api.post("/feedback"'));
  assert.match(patch, /requireCsrfHeader, rateLimit\(TIERS\.page_options\)/);
  assert.ok(patch.indexOf("if (!access.ok)") < patch.indexOf("setPageOptions("), "access is checked before the write");
  assert.ok(patch.indexOf("parseOptions(body)") < patch.indexOf("pageFor(c, id"), "input is validated before the lookup");
  // The write goes through the page-write module, never straight to KV or D1.
  assert.doesNotMatch(patch, /PAGES_KV\.put|DB\.prepare/);
  // Anonymous pages' new titles are screened.
  assert.match(patch, /page\.row\.ownerId === null && typeof change\.title === "string"[\s\S]*detectSpam/);
});

// --- Validation -------------------------------------------------------------

test("each setting can be set or cleared", () => {
  assert.deepEqual(change({ title: "  Q4 report " }), { title: "Q4 report" });
  assert.deepEqual(change({ title: null }), { title: null });
  assert.deepEqual(change({ pin: "4821" }), { pin: "4821" });
  assert.deepEqual(change({ pin: null }), { pin: null });
  assert.deepEqual(change({ ttl: 3600 }), { expiry: { ttlSeconds: 3600 } });
  assert.deepEqual(change({ permanent: true }), { expiry: { permanent: true } });
  assert.deepEqual(change({ permanent: false }), { expiry: { ttlSeconds: 604800 } });
  assert.deepEqual(change({ permanent: false, ttl: 120 }), { expiry: { ttlSeconds: 120 } });
  assert.deepEqual(change({ reads: 5 }), { reads: 5 });
  assert.deepEqual(change({ reads: null }), { reads: null });
  // The token rides along and isn't a setting.
  assert.deepEqual(change({ update_token: "at_x", pin: null }), { pin: null });
});

test("titles: capped, never empty, no control characters", () => {
  assert.deepEqual(change({ title: "x".repeat(TITLE_MAX) }), { title: "x".repeat(TITLE_MAX) });
  refused({ title: "x".repeat(TITLE_MAX + 1) }, /at most 200/);
  refused({ title: "   " }, /send null to clear/);
  refused({ title: "line\nbreak" }, /control characters/);
  refused({ title: 42 }, /must be a string/);
});

test("PINs: 4 to 64 characters, strings only", () => {
  refused({ pin: "123" }, /4 to 64/);
  refused({ pin: "x".repeat(PIN_MAX + 1) }, /4 to 64/);
  refused({ pin: 1234 }, /must be a string/);
  refused({ pin: "" }, /4 to 64/);
  refused({ pin: " 1234" }, /spaces/);
  assert.deepEqual(change({ pin: "x".repeat(PIN_MAX) }), { pin: "x".repeat(PIN_MAX) });
});

test("TTLs: whole seconds from a minute to a year, and not with permanent", () => {
  refused({ ttl: 59 }, /between 60 seconds/);
  refused({ ttl: TTL_MAX + 1 }, /use permanent for longer/);
  refused({ ttl: 0 }, /between/);
  refused({ ttl: -5 }, /between/);
  refused({ ttl: 90.5 }, /whole number/);
  refused({ ttl: "7d" }, /whole number/);
  refused({ ttl: 3600, permanent: true }, /not both/);
  refused({ permanent: "yes" }, /true or false/);
  assert.deepEqual(change({ ttl: TTL_MAX }), { expiry: { ttlSeconds: TTL_MAX } });
});

test("view limits: 1 to a million, or null", () => {
  refused({ reads: 0 }, /1 to 1000000/);
  refused({ reads: READS_MAX + 1 }, /1 to 1000000/);
  refused({ reads: 2.5 }, /whole number/);
  refused({ reads: "5" }, /whole number/);
});

test("bodies that change nothing, or name unknown fields, are refused", () => {
  refused({}, /Nothing to change/);
  refused({ update_token: "at_x" }, /Nothing to change/);
  refused({ ttl_seconds: 3600 }, /Unknown field: ttl_seconds/);
  refused({ html: "<p>hi</p>", title: "x" }, /Unknown field: html/);
  refused(null, /JSON object/);
  refused([1], /JSON object/);
  refused("pin", /JSON object/);
});

// --- Applying a change --------------------------------------------------------

test("a change moves only the settings it names", () => {
  const current = { title: "Old", pin: "pbkdf2$old", reads: 3, permanent: false, expiresAt: NOW + HOUR };
  assert.deepEqual(applyOptions(current, { title: "New" }, null, NOW), { ...current, title: "New" });
  assert.deepEqual(applyOptions(current, { pin: "9999" }, "pbkdf2$new", NOW), { ...current, pin: "pbkdf2$new" });
  assert.deepEqual(applyOptions(current, { pin: null }, null, NOW), { ...current, pin: null });
  assert.deepEqual(applyOptions(current, { expiry: { permanent: true } }, null, NOW), { ...current, permanent: true, expiresAt: null });
  const perm = { ...current, permanent: true, expiresAt: null };
  assert.deepEqual(applyOptions(perm, { expiry: { ttlSeconds: 60 } }, null, NOW), { ...perm, permanent: false, expiresAt: NOW + 60_000 });
  assert.deepEqual(applyOptions(current, { reads: null }, null, NOW), { ...current, reads: null });
  assert.deepEqual(changedSettings({ title: null, expiry: { permanent: true }, reads: 2, pin: "1234" }), ["title", "pin", "expiry", "reads"]);
});

test("details never include the PIN or token, only whether a PIN is on", () => {
  const row = { ...rowFromMetadata(meta("p1", { pin: "pbkdf2$secret", reads: 10, project: "q4" }), null, NOW) };
  const d = pageDetails(row, 4, "https://aired.sh");
  assert.deepEqual(d, {
    id: "p1",
    url: "https://aired.sh/p/p1",
    title: "Page p1",
    size: 100,
    readCount: 4,
    reads: 10,
    hasPin: true,
    permanent: false,
    createdAt: new Date(NOW - HOUR).toISOString(),
    expiresAt: new Date(NOW + 24 * HOUR).toISOString(),
    project: "q4",
  });
  assert.ok(!JSON.stringify(d).includes("pbkdf2"));
  assert.ok(!JSON.stringify(d).includes("h_p1"));
});

// --- The D1 write -------------------------------------------------------------

function meta(id: string, over: Partial<PageMetadata> = {}): PageMetadata {
  return {
    id,
    title: `Page ${id}`,
    size: 100,
    tokenHash: `h_${id}`,
    pin: null,
    reads: null,
    readCount: 0,
    permanent: false,
    createdAt: new Date(NOW - HOUR).toISOString(),
    expiresAt: new Date(NOW + 24 * HOUR).toISOString(),
    ownerId: 7,
    project: null,
    ...over,
  };
}

test("updatePageOptions writes the settings of a live page", async () => {
  const { db } = fakeD1();
  await insertPageRow(db, rowFromMetadata(meta("a"), null, NOW));
  const settings = { title: "New", pin: "pbkdf2$x", reads: 9, permanent: true, expiresAt: null };
  assert.equal(await updatePageOptions(db, "a", settings, NOW + 1), true);
  const row = (await getPageRow(db, "a"))!;
  assert.deepEqual(
    { title: row.title, pin: row.pin, reads: row.reads, permanent: row.permanent, expiresAt: row.expiresAt, updatedAt: row.updatedAt },
    { ...settings, updatedAt: NOW + 1 },
  );
  // Owner and token are never touched.
  assert.equal(row.ownerId, 7);
  assert.equal(row.tokenHash, "h_a");
});

test("updatePageOptions can't bring back a deleted or expired page", async () => {
  const { db } = fakeD1();
  await insertPageRow(db, rowFromMetadata(meta("gone"), null, NOW));
  await markPageDeleted(db, "gone", NOW);
  const forever = { title: "x", pin: null, reads: null, permanent: true, expiresAt: null };
  assert.equal(await updatePageOptions(db, "gone", forever, NOW), false);
  assert.equal((await getPageRow(db, "gone"))!.permanent, false);

  await insertPageRow(db, rowFromMetadata(meta("old", { expiresAt: new Date(NOW - 1000).toISOString() }), null, NOW));
  assert.equal(await updatePageOptions(db, "old", forever, NOW), false, "an expired page stays expired");
  assert.equal(await updatePageOptions(db, "missing", forever, NOW), false);
});

test("page-write: setPageOptions writes D1 first, rebuilds KV from the row and re-checks for a delete", () => {
  const code = readFileSync(new URL("../src/lib/page-write.ts", import.meta.url), "utf8");
  const fn = code.slice(code.indexOf("export async function setPageOptions"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.ok(body.indexOf("updatePageOptions(env.DB") < body.indexOf("PAGES_KV.put"), "D1 before KV");
  assert.match(body, /if \(!\(await updatePageOptions\(env\.DB, row\.id, settings, now\)\)\) throw new PageGone/);
  assert.match(body, /const metadata: PageMetadata = pinChanged \? \{ \.\.\.base, pin: settings\.pin \} : base;/);
  assert.match(body, /kvOptions\(updated\.expiresAt, now\)/);
  assert.match(body, /if \(after === null \|\| after\.deletedAt !== null\) \{\s*await env\.PAGES_KV\.delete/);
  assert.doesNotMatch(body, /PAGES_BUCKET/, "the HTML is left alone");
});
