import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PDF_BUDGET_MS,
  PDF_CALLER_BUDGET_MS,
  contentDisposition,
  countPdfPages,
  looksLikePdf,
  noteFontPx,
  paperFor,
  parsePaper,
  parseVariant,
  pdfFilename,
  pdfKey,
  pdfLane,
  pdfLinkToken,
  pdfOptions,
  pdfViewerGrant,
  printHtml,
  readPdfLinkToken,
  variantName,
  verifyPdfViewerGrant,
  viewerPdfAllowed,
  viewerPdfHref,
  type PdfVariant,
} from "../src/lib/pdf-export.ts";
import { DEFAULT_DAILY_BUDGET_MS } from "../src/lib/og-shot.ts";
import { pageIdFromKey } from "../src/lib/expired-sweep.ts";
import { injectAiredBar } from "../src/lib/aired-bar.ts";
import { buildContent } from "../src/lib/page-content.ts";

const SECRET = "s3cret-for-tests";
const NOW_SEC = 1_800_000_000;

test("variants: every name parses back to itself, and nothing else parses", () => {
  const all: PdfVariant[] = [];
  for (const footer of [true, false]) {
    for (const notes of [true, false]) all.push({ kind: "deck", paper: "a4", notes, footer });
    for (const kind of ["page", "doc"] as const) for (const paper of ["a4", "letter"] as const) all.push({ kind, paper, notes: false, footer });
  }
  const names = new Set(all.map(variantName));
  assert.equal(names.size, all.length, "every variant has its own cache file");
  for (const v of all) assert.equal(variantName(parseVariant(variantName(v))!), variantName(v));
  for (const bad of ["", "deck", "page-a5-mark", "doc-a4-mark-notes", "../x", "deck-mark-notes.pdf"]) assert.equal(parseVariant(bad), null, bad);
  assert.equal(variantName({ kind: "deck", paper: "letter", notes: false, footer: true }), "deck-mark", "a deck's paper is its slide size");
});

test("cache keys sit under the page and its HTML version, and the expired-page sweep knows them", () => {
  const key = pdfKey("abc_-1", '"0a1b2c3d4e5f6a7b8c"', { kind: "doc", paper: "letter", notes: false, footer: false });
  assert.equal(key, "pages/abc_-1/pdf/0a1b2c3d4e5f/doc-letter-clean.pdf");
  assert.notEqual(key, pdfKey("abc_-1", '"ffffffffffff"', { kind: "doc", paper: "letter", notes: false, footer: false }), "a new version is a new file");
  assert.equal(pageIdFromKey(key), "abc_-1");
  assert.equal(pageIdFromKey("pages/abc/pdf/0a1b/deck-mark-notes.pdf"), "abc");
  assert.equal(pageIdFromKey("pages/abc/pdf/0a1b/other.pdf"), null);
});

test("paper: Letter where it's the usual size, A4 elsewhere; only a4 or letter accepted", () => {
  assert.equal(paperFor("US"), "letter");
  assert.equal(paperFor("ca"), "letter");
  assert.equal(paperFor("GB"), "a4");
  assert.equal(paperFor(null), "a4");
  assert.equal(parsePaper(undefined), null);
  assert.equal(parsePaper("Letter"), "letter");
  assert.equal(parsePaper("A5"), undefined);
  assert.equal(parsePaper(4), undefined);
});

test("download links: name one variant of one version, expire, and can't be altered", async () => {
  const v: PdfVariant = { kind: "deck", paper: "a4", notes: true, footer: false };
  const t = await pdfLinkToken(SECRET, "abc", '"aaaabbbbcccc"', v, NOW_SEC + 900);
  assert.deepEqual(await readPdfLinkToken(SECRET, "abc", t, NOW_SEC), { variant: v, version: "aaaabbbbcccc" });
  assert.equal(await readPdfLinkToken(SECRET, "abc", t, NOW_SEC + 900), null, "expired");
  assert.equal(await readPdfLinkToken(SECRET, "xyz", t, NOW_SEC), null, "another page");
  assert.equal(await readPdfLinkToken("other-secret", "abc", t, NOW_SEC), null);
  // Turning a plain link into a notes one (or moving its expiry) breaks the signature.
  const plain = await pdfLinkToken(SECRET, "abc", '"aaaabbbbcccc"', { ...v, notes: false }, NOW_SEC + 900);
  assert.equal(await readPdfLinkToken(SECRET, "abc", plain.replace("deck-clean.", "deck-clean-notes."), NOW_SEC), null);
  assert.equal(await readPdfLinkToken(SECRET, "abc", plain.replace(String(NOW_SEC + 900), String(NOW_SEC + 99999)), NOW_SEC), null);
  assert.equal(await readPdfLinkToken(SECRET, "abc", "junk", NOW_SEC), null);
  assert.equal(await readPdfLinkToken(SECRET, "abc", "x".repeat(500), NOW_SEC), null);
});

test("viewers: only with allow_pdf and no view limit; a PIN page's link carries a grant tied to its PIN", async () => {
  assert.equal(viewerPdfAllowed({ allowPdf: true, reads: null }), true);
  assert.equal(viewerPdfAllowed({ allowPdf: false, reads: null }), false);
  assert.equal(viewerPdfAllowed({ allowPdf: true, reads: 10 }), false);
  const origin = "https://aired.sh";
  assert.equal(await viewerPdfHref(origin, { id: "abc", pin: null, allowPdf: true, reads: null }, SECRET, NOW_SEC), "https://aired.sh/p/abc/pdf");
  assert.equal(await viewerPdfHref(origin, { id: "abc", pin: null, allowPdf: false, reads: null }, SECRET, NOW_SEC), null);
  const href = await viewerPdfHref(origin, { id: "abc", pin: "pbkdf2$hash", allowPdf: true, reads: null }, SECRET, NOW_SEC);
  const g = new URL(href!).searchParams.get("g")!;
  assert.equal(await verifyPdfViewerGrant(SECRET, "abc", "pbkdf2$hash", g, NOW_SEC), true);
  assert.equal(await verifyPdfViewerGrant(SECRET, "abc", "pbkdf2$new", g, NOW_SEC), false, "a new PIN ends it");
  assert.equal(await verifyPdfViewerGrant(SECRET, "abc", "pbkdf2$hash", g, NOW_SEC + 3600), false, "an hour, like the PIN cookie");
  assert.equal(await verifyPdfViewerGrant(SECRET, "abc", null, g, NOW_SEC), false);
  assert.equal(await verifyPdfViewerGrant(SECRET, "abc", "pbkdf2$hash", undefined, NOW_SEC), false);
  assert.equal(await viewerPdfHref(origin, { id: "abc", pin: "pbkdf2$hash", allowPdf: true, reads: null }, undefined, NOW_SEC), null, "no secret, no grant");
  assert.ok((await pdfViewerGrant(SECRET, "abc", "h", NOW_SEC)).startsWith(`${NOW_SEC}.`));
});

test("decks: a notes page goes after each slide that has notes, escaped, and the public deck still has none", () => {
  const deck = buildContent({
    html: `<html><head></head><body><section><h1>One</h1><aside class="notes">Say <b>hi</b> & smile</aside></section><section><h1>Two</h1></section><section><h1>Three</h1><aside class="notes"><script>alert(1)</script>Wrap up</aside></section></body></html>`,
    deck: true,
  });
  assert.ok(!deck.html.includes("smile"));
  const plain = printHtml(deck.html, { kind: "deck", footer: false });
  assert.ok(!plain.includes("aired-pdf-notes\""), "no notes pages without notes");
  assert.ok(!plain.includes('class="aired-pdf-mark"'), "Pro: no mark");
  const sidecar = deck.sidecar!;
  const printed = printHtml(deck.html, { kind: "deck", footer: true, notes: { notes: sidecar.notes, titles: sidecar.titles } });
  const order = ["<h1>One</h1>", "Say hi &amp; smile", "<h1>Two</h1>", "<h1>Three</h1>", "Wrap up"].map((s) => printed.indexOf(s));
  assert.ok(order.every((i) => i >= 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "each notes page follows its own slide");
  assert.equal((printed.match(/data-aired-notes=/g) ?? []).length, 2);
  assert.match(printed, /Speaker notes · slide 3 of 3/);
  assert.ok(!printed.includes("<script>alert"), "notes are text, never markup");
  assert.match(printed, /class="aired-pdf-mark">Made with aired · aired\.sh</);
  assert.match(printed, /<style id="aired-pdf-css">/);
  assert.equal(noteFontPx("short"), 32);
  assert.ok(noteFontPx("x".repeat(3000)) < noteFontPx("x".repeat(800)));
});

test("docs and pages: print CSS in the head, margins, page numbers, and the aired line only when asked", () => {
  const printed = printHtml("<html><head><title>T</title></head><body><p>x</p></body></html>", { kind: "doc", footer: true });
  assert.match(printed, /<style id="aired-pdf-css">@media print\{[\s\S]*break-inside:avoid[\s\S]*<\/style><\/head>/);
  assert.match(printHtml("<p>no head</p>", { kind: "page", footer: false }), /^<style id="aired-pdf-css">/);
  const doc = pdfOptions({ kind: "doc", paper: "letter", notes: false, footer: true });
  assert.equal(doc.format, "Letter");
  assert.equal(doc.displayHeaderFooter, true);
  assert.equal(doc.printBackground, true);
  assert.equal(doc.preferCSSPageSize, true, "a page's own @page wins");
  assert.match(String(doc.footerTemplate), /Made with aired[\s\S]*pageNumber[\s\S]*totalPages/);
  const pro = pdfOptions({ kind: "page", paper: "a4", notes: false, footer: false });
  assert.equal(pro.format, "A4");
  assert.doesNotMatch(String(pro.footerTemplate), /aired/);
  const deck = pdfOptions({ kind: "deck", paper: "a4", notes: false, footer: true });
  assert.deepEqual([deck.width, deck.height, deck.displayHeaderFooter], ["1280px", "720px", undefined]);
});

test("file names come from the title, safe for a header", () => {
  assert.equal(pdfFilename("Q3 Client Report — Acme, Inc.", "abc", false), "q3-client-report-acme-inc.pdf");
  assert.equal(pdfFilename("Café déjà vu", "abc", true), "cafe-deja-vu-notes.pdf");
  assert.equal(pdfFilename(null, "abc", false), "abc.pdf");
  assert.equal(pdfFilename("!!!", "abc", false), "abc.pdf");
  assert.ok(pdfFilename("x".repeat(200), "abc", false).length <= 64);
  assert.equal(contentDisposition('a"b.pdf'), 'attachment; filename="a_b.pdf"');
});

test("a PDF is recognised and its pages counted; anything else is never cached", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\n<< /Type /Page >>\n<</Type/Page/Parent 2 0 R>>\n<< /Type /Pages /Count 2 >>\n%%EOF");
  assert.equal(looksLikePdf(pdf), true);
  assert.equal(countPdfPages(pdf), 2, "/Pages is the tree, not a page");
  assert.equal(looksLikePdf(new TextEncoder().encode("<html>error</html>")), false);
  assert.equal(looksLikePdf(new Uint8Array()), false);
});

test("budget: PDFs get 20 of the 40 daily minutes, never more than all browser time; callers get shares", () => {
  assert.equal(DEFAULT_PDF_BUDGET_MS, 20 * 60 * 1000);
  const lane = pdfLane({}, "viewer");
  assert.deepEqual([lane.row, lane.totalMs, lane.capMs, lane.callerCapMs], ["pdf", DEFAULT_DAILY_BUDGET_MS, DEFAULT_PDF_BUDGET_MS, PDF_CALLER_BUDGET_MS.viewer]);
  assert.equal(pdfLane({ PDF_DAILY_SECONDS: "0" }, "pro").capMs, 0, "0 turns new PDFs off");
  assert.equal(pdfLane({ OG_SHOT_DAILY_SECONDS: "60", PDF_DAILY_SECONDS: "900" }, "pro").capMs, 60_000, "never more than all browser time");
  assert.ok(PDF_CALLER_BUDGET_MS.viewer < PDF_CALLER_BUDGET_MS.free && PDF_CALLER_BUDGET_MS.free < PDF_CALLER_BUDGET_MS.pro);
});

test("the badge gets a PDF button when viewers may download; Pro pages get a button of their own; neither prints", () => {
  const html = "<html><head></head><body><p>x</p></body></html>";
  const base = { origin: "https://aired.sh", id: "abc", title: "T", readCount: 3 };
  const free = injectAiredBar(html, { ...base, pdfHref: "https://aired.sh/p/abc/pdf?g=1.x" });
  assert.match(free, /<a href="https:\/\/aired\.sh\/p\/abc\/pdf\?g=1\.x" rel="nofollow" class="__aired-pdf"/);
  assert.match(free, /Shared with <b>aired<\/b>/);
  assert.doesNotMatch(injectAiredBar(html, base), /class="__aired-pdf"/);
  const pro = injectAiredBar(html, { ...base, badge: false, pdfHref: "https://aired.sh/p/abc/pdf" });
  assert.match(pro, /id="__aired-pdf" href="https:\/\/aired\.sh\/p\/abc\/pdf"[^>]*>[\s\S]*Download PDF/);
  assert.doesNotMatch(pro, /aired badge/);
  assert.match(pro, /@media print \{ #__aired-pdf \{ display: none; \} \}/);
  assert.doesNotMatch(injectAiredBar(html, { ...base, badge: false }), /id="__aired-pdf"|aired badge/);
  assert.match(injectAiredBar(html, { ...base, pdfHref: 'x"><script>' }), /href="x&quot;&gt;&lt;script&gt;"/);
});

test("allow_pdf: a boolean set_options field, stored on the row and copied into the KV record", async () => {
  const { parseOptions, settingsChange, changedSettings } = await import("../src/lib/page-options.ts");
  const { fakeD1 } = await import("./helpers/d1.ts");
  const { getPageRow, insertPageRow, metadataFromRow, rowFromMetadata, updatePageOptions } = await import("../src/lib/pages-store.ts");
  const { parseMetadata, serializeMetadata } = await import("../../../packages/core/src/metadata.ts");
  const on = parseOptions({ allow_pdf: true });
  assert.ok(on.ok);
  assert.equal(on.change.allowPdf, true);
  assert.deepEqual(settingsChange(on.change, null, 0), { allowPdf: true });
  assert.deepEqual(changedSettings(on.change), ["allow_pdf"]);
  const bad = parseOptions({ allow_pdf: "yes" });
  assert.ok(!bad.ok && /allow_pdf must be true or false/.test(bad.error));

  const { db } = fakeD1();
  const now = Date.now();
  const meta = { id: "p1", title: null, size: 1, tokenHash: "h", pin: null, reads: null, readCount: 0, permanent: true, createdAt: new Date(now).toISOString(), expiresAt: null, ownerId: 7, project: null };
  await insertPageRow(db, rowFromMetadata(meta, null, now));
  assert.equal((await getPageRow(db, "p1"))!.allowPdf, false, "off by default");
  assert.equal(await updatePageOptions(db, "p1", { allowPdf: true }, now + 1), true);
  const row = (await getPageRow(db, "p1"))!;
  assert.equal(row.allowPdf, true);
  const record = parseMetadata(serializeMetadata(metadataFromRow(row, 0)))!;
  assert.equal(record.allowPdf, true, "the viewer reads it from KV");
  assert.equal(parseMetadata(JSON.stringify({ ...meta, allowPdf: "true" }))!.allowPdf, false);
});
