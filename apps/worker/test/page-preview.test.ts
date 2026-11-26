import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PREVIEW_HEADERS, PREVIEW_MAX_BYTES, previewDecision } from "../src/lib/page-preview.ts";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const page = (over: Partial<{ ownerId: number | null; size: number; permanent: boolean; expiresAt: string | null }> = {}) =>
  ({ ownerId: 7, size: 2000, permanent: true, expiresAt: null, ...over });

test("the owner gets their page's preview", () => {
  assert.deepEqual(previewDecision(page(), 7, false, NOW), { ok: true });
});

test("anyone else gets a 404, the same as a missing page", () => {
  assert.deepEqual(previewDecision(page(), 8, false, NOW), { ok: false, status: 404 });
  assert.deepEqual(previewDecision(null, 7, false, NOW), { ok: false, status: 404 });
  assert.deepEqual(previewDecision(page({ ownerId: null }), 7, false, NOW), { ok: false, status: 404 });
});

test("a page claimed into the account but written back without an owner still previews", () => {
  assert.deepEqual(previewDecision(page({ ownerId: null }), 7, true, NOW), { ok: true });
  // The claim only counts when the KV owner is empty, never over another owner.
  assert.deepEqual(previewDecision(page({ ownerId: 9 }), 7, true, NOW), { ok: false, status: 404 });
});

test("an expired page doesn't preview", () => {
  const past = new Date(NOW - 1000).toISOString();
  const future = new Date(NOW + 3_600_000).toISOString();
  assert.deepEqual(previewDecision(page({ permanent: false, expiresAt: past }), 7, false, NOW), { ok: false, status: 404 });
  assert.deepEqual(previewDecision(page({ permanent: false, expiresAt: future }), 7, false, NOW), { ok: true });
});

test("a page over the size cap answers 204 so the dashboard keeps its cover", () => {
  assert.deepEqual(previewDecision(page({ size: PREVIEW_MAX_BYTES + 1 }), 7, false, NOW), { ok: false, status: 204 });
  assert.deepEqual(previewDecision(page({ size: PREVIEW_MAX_BYTES }), 7, false, NOW), { ok: true });
});

test("the HTML is never served as HTML on aired.sh", () => {
  assert.equal(PREVIEW_HEADERS["Content-Type"], "text/plain; charset=utf-8");
  assert.equal(PREVIEW_HEADERS["X-Content-Type-Options"], "nosniff");
  assert.match(PREVIEW_HEADERS["Content-Security-Policy"], /^sandbox/);
  assert.match(PREVIEW_HEADERS["Cache-Control"], /^private/);
});

test("me.ts: the preview route uses the decision and headers, and never writes the read count", () => {
  const code = readFileSync(new URL("../src/routes/me.ts", import.meta.url), "utf8");
  const start = code.indexOf("me.get('/pages/:id/preview'");
  assert.ok(start > 0, "route exists");
  const body = code.slice(start, code.indexOf("\n});", start));
  assert.match(body, /previewDecision\(/);
  assert.match(body, /PREVIEW_HEADERS/);
  assert.match(body, /PAGES_BUCKET\.get\(`pages\/\$\{id\}\/index\.html`\)/);
  assert.doesNotMatch(body, /readCount|PAGES_KV\.put/);
});
