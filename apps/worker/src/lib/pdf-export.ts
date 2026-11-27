import { dailyBudgetMs, versionFromEtag } from "./og-shot.ts";
import { laneCapMs, type BudgetLane } from "./browser-budget.ts";
import { SLIDE_HEIGHT, SLIDE_WIDTH, topLevelSections } from "./deck.ts";

/**
 * PDF export: the rules, kept apart from the browser work (renderPdf in
 * og-render.ts) and the routes (routes/pdf.ts). Its imports are og-shot.ts,
 * browser-budget.ts and deck.ts, which import nothing else, so tests load it
 * directly.
 *
 * What a PDF looks like:
 *   - A deck: one slide per page at the slide's own size (1280×720, so
 *     landscape), from the deck's print CSS (DECK_RUNTIME_CSS). The "with
 *     notes" version adds a page of speaker notes after each slide that has
 *     some; only the signed-in owner can ask for it (as for the speaker view).
 *   - A doc or a page: A4 or Letter with margins and page numbers. A page's
 *     own @page rules win.
 *   - Free accounts and anonymous pages get a small "Made with aired" line
 *     (the footer on docs and pages, a mark in the corner of each slide);
 *     Pro owners' PDFs have none, as their pages have no badge.
 *
 * Who may download (routes/pdf.ts): the page's owner always; a viewer only
 * when the owner turned on allow_pdf, the page has no view limit, and the
 * viewer could open the page right now (its PIN cookie, or the email-code
 * cookie of someone still on the list). A locked page answers the same
 * refusal whether or not a PDF exists.
 *
 * Each PDF is kept in R2 under the page's HTML version
 * (`pages/<id>/pdf/<version>/<variant>.pdf`), so asking again costs no
 * browser time. An update or delete removes them (forgetShots), and a new
 * version never finds an old one.
 */

export type PdfKind = "page" | "doc" | "deck";
export type Paper = "a4" | "letter";

/** Where Letter is the usual paper size; everywhere else gets A4. */
const LETTER_COUNTRIES = new Set(["US", "CA", "MX", "PH", "CL", "CO", "VE", "GT", "CR", "PR", "DO", "SV", "NI", "PA", "BZ", "BO"]);

/** The paper size for a viewer's country (CF-IPCountry), A4 when unknown. */
export function paperFor(country: string | null | undefined): Paper {
  return country !== null && country !== undefined && LETTER_COUNTRIES.has(country.toUpperCase()) ? "letter" : "a4";
}

/** A paper size from user input: null means "pick for me", undefined means refused. */
export function parsePaper(v: unknown): Paper | null | undefined {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return undefined;
  const p = v.toLowerCase();
  return p === "a4" || p === "letter" ? p : undefined;
}

/** What one PDF of a page version is: the cache key's last part. */
export type PdfVariant = { kind: PdfKind; paper: Paper; notes: boolean; footer: boolean };

/** The variant as a name: `deck-mark-notes`, `doc-a4-clean`. A deck's paper is its slide size. */
export function variantName(v: PdfVariant): string {
  const mark = v.footer ? "mark" : "clean";
  if (v.kind === "deck") return `deck-${mark}${v.notes ? "-notes" : ""}`;
  return `${v.kind}-${v.paper}-${mark}`;
}

const VARIANT = /^(?:deck-(?:mark|clean)(?:-notes)?|(?:page|doc)-(?:a4|letter)-(?:mark|clean))$/;

/** A variant name back as a variant, or null when it isn't one. */
export function parseVariant(name: string): PdfVariant | null {
  if (!VARIANT.test(name)) return null;
  const parts = name.split("-");
  if (parts[0] === "deck") return { kind: "deck", paper: "a4", footer: parts[1] === "mark", notes: parts[2] === "notes" };
  return { kind: parts[0] as PdfKind, paper: parts[1] as Paper, footer: parts[2] === "mark", notes: false };
}

export const pdfPrefix = (id: string): string => `pages/${id}/pdf/`;

/** The R2 key of one PDF of one version of a page. */
export function pdfKey(id: string, htmlEtag: string, variant: PdfVariant): string {
  return `${pdfPrefix(id)}${versionFromEtag(htmlEtag)}/${variantName(variant)}.pdf`;
}

// --- Budget -------------------------------------------------------------------

export const PDF_BUDGET_ROW = "pdf";
/**
 * Default daily browser time for PDFs: 20 of the 40 minutes all browser work
 * may use. A fresh PDF took about 10 seconds of browser time in testing
 * (launch included), so about 120 new PDFs a day across everyone.
 */
export const DEFAULT_PDF_BUDGET_MS = 20 * 60 * 1000;
/**
 * Each caller's daily share of the PDFs' time. Cached PDFs cost nothing, so
 * this only counts new renders (about 10 seconds each): a viewer about 6, a
 * free account about 18, Pro about 60.
 */
export const PDF_CALLER_BUDGET_MS = { viewer: 60_000, free: 180_000, pro: 600_000 } as const;
export type PdfCallerTier = keyof typeof PDF_CALLER_BUDGET_MS;

/** Longest a render may hold a browser, and how long to wait for the page's load event. */
export const PDF_TIMEOUT_MS = 30_000;
export const PDF_LOAD_TIMEOUT_MS = 10_000;
/** Charged before the browser starts, settled to the real time after. */
export const PDF_RESERVE_MS = PDF_TIMEOUT_MS + 5_000;
/** Pages bigger than this (bytes of HTML) aren't exported: slow, and the browser may not finish. */
export const PDF_MAX_HTML_BYTES = 5 * 1024 * 1024;

export type PdfBudgetVars = { OG_SHOT_DAILY_SECONDS?: string; PDF_DAILY_SECONDS?: string };

export function pdfLane(vars: PdfBudgetVars, tier: PdfCallerTier): BudgetLane {
  const totalMs = dailyBudgetMs(vars.OG_SHOT_DAILY_SECONDS);
  return { row: PDF_BUDGET_ROW, totalMs, capMs: laneCapMs(vars.PDF_DAILY_SECONDS, DEFAULT_PDF_BUDGET_MS, totalMs), callerCapMs: PDF_CALLER_BUDGET_MS[tier] };
}

// --- Who may download -----------------------------------------------------------

/** The page facts the viewer's rule needs (KV record or D1 row). */
export type PdfPage = { allowPdf: boolean; reads: number | null };

/**
 * Whether a viewer (not the owner) may download a PDF of a page they can
 * open: the owner turned it on, and there's no view limit (a file would
 * outlive it). The PIN and the people list are checked by the route.
 */
export function viewerPdfAllowed(page: PdfPage): boolean {
  return page.allowPdf && page.reads === null;
}

// --- Download links ---------------------------------------------------------------

/** How long a download link from POST /api/pages/:id/pdf works. */
export const PDF_LINK_TTL_SECONDS = 15 * 60;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function linkMac(secret: string, id: string, version: string, variant: string, expSec: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  // A purpose label keeps this MAC apart from anything else signed with the secret.
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`aired-pdf-link:v1:${id}:${version}:${variant}:${expSec}`))));
}

/**
 * A download link's `t`: `<variant>.<version>.<expiry seconds>.<HMAC>`. It
 * names one cached PDF of one version, so it never starts a browser, and
 * an update (a new version) ends it.
 */
export async function pdfLinkToken(secret: string, id: string, htmlEtag: string, variant: PdfVariant, expSec: number): Promise<string> {
  const version = versionFromEtag(htmlEtag);
  const name = variantName(variant);
  return `${name}.${version}.${expSec}.${await linkMac(secret, id, version, name, expSec)}`;
}

/** The PDF a link token names, or null when it's malformed, expired or not signed by us. */
export async function readPdfLinkToken(secret: string, id: string, token: string, nowSec: number): Promise<{ variant: PdfVariant; version: string } | null> {
  if (token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [name, version, expPart, sig] = parts as [string, string, string, string];
  const variant = parseVariant(name);
  if (variant === null || !/^[A-Za-z0-9]{1,12}$/.test(version) || !/^\d{1,12}$/.test(expPart)) return null;
  const expSec = Number(expPart);
  if (expSec <= nowSec) return null;
  const want = await linkMac(secret, id, version, name, expSec);
  if (want.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? { variant, version } : null;
}

/**
 * The viewer's grant on a PIN page's button. The PIN cookie is
 * SameSite=Strict and the page runs in a sandbox (an opaque origin), so a
 * click from the page doesn't carry it: the viewer, who just unlocked the
 * page, gets the proof in the link instead. It's tied to the PIN as stored
 * (a new PIN ends it) and lasts as long as the cookie (an hour).
 */
export const PDF_GRANT_TTL_SECONDS = 3600;

async function grantMac(secret: string, id: string, pinHash: string, expSec: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`aired-pdf-grant:v1:${id}:${expSec}:${pinHash}`))));
}

export async function pdfViewerGrant(secret: string, id: string, pinHash: string, expSec: number): Promise<string> {
  return `${expSec}.${await grantMac(secret, id, pinHash, expSec)}`;
}

export async function verifyPdfViewerGrant(secret: string, id: string, pinHash: string | null, grant: string | undefined, nowSec: number): Promise<boolean> {
  if (pinHash === null || grant === undefined || grant.length > 100) return false;
  const dot = grant.indexOf(".");
  const expPart = grant.slice(0, dot);
  if (dot <= 0 || !/^\d{1,12}$/.test(expPart) || Number(expPart) <= nowSec) return false;
  const want = await grantMac(secret, id, pinHash, Number(expPart));
  const sig = grant.slice(dot + 1);
  if (want.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

/**
 * The viewer's "Download PDF" link, or null when viewers can't download
 * this page. A PIN page's link carries the grant above; an "only these
 * people" page's email-code cookie is SameSite=Lax, so it comes along.
 */
export async function viewerPdfHref(
  origin: string,
  page: PdfPage & { id: string; pin: string | null },
  secret: string | undefined,
  nowSec: number,
): Promise<string | null> {
  if (!viewerPdfAllowed(page)) return null;
  const base = `${origin}/p/${encodeURIComponent(page.id)}/pdf`;
  if (page.pin === null) return base;
  if (!secret) return null;
  return `${base}?g=${encodeURIComponent(await pdfViewerGrant(secret, page.id, page.pin, nowSec + PDF_GRANT_TTL_SECONDS))}`;
}

// --- What the browser prints -----------------------------------------------------------

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const FOOTER_TEXT = "Made with aired · aired.sh";

/** Print CSS for docs and pages: colours as on screen, no figure or row cut in half, headings kept with what follows. */
const PAGE_PRINT_CSS = `@media print{
html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
img,svg,canvas,video,figure,pre,blockquote,tr,li{break-inside:avoid}
h1,h2,h3,h4,h5,h6{break-after:avoid}
#__aired-bar,.aired-deck-ui,.aired-toast{display:none!important}
}`;

/**
 * Decks: the notes pages and the corner mark (hidden on screen; the deck's
 * own print CSS lays out the slides). Each page starts a new sheet rather
 * than ending one, so the last slide doesn't leave a blank page behind it.
 */
const DECK_PRINT_CSS = `.aired-pdf-notes,.aired-pdf-mark{display:none}
@media print{
html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
html.aired-deck [data-aired-slide],.aired-pdf-notes{break-after:auto!important;page-break-after:auto!important;break-before:page;page-break-before:always}
html.aired-deck [data-aired-slide="1"]{break-before:auto;page-break-before:auto}
.aired-pdf-notes{display:flex;flex-direction:column;width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;box-sizing:border-box;padding:72px 96px;margin:0;overflow:hidden;background:#fff;color:#16161a;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,sans-serif}
.aired-pdf-notes-head{font-size:16px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#6b6b73;margin:0 0 10px}
.aired-pdf-notes-title{font-size:40px;font-weight:650;line-height:1.15;margin:0 0 32px;color:#16161a}
.aired-pdf-notes-body{white-space:pre-wrap;line-height:1.5;margin:0;overflow:hidden}
.aired-pdf-mark{display:block;position:fixed;right:16px;bottom:12px;z-index:2147483647;padding:5px 9px;border-radius:6px;background:rgba(255,255,255,.82);color:#55555c;font:500 12px/1 -apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif}
}`;

/** The note's type size: big for a line or two, smaller as it grows, so most notes fit their page. */
export function noteFontPx(text: string): number {
  const n = text.length;
  if (n <= 300) return 32;
  if (n <= 700) return 26;
  if (n <= 1500) return 20;
  if (n <= 3000) return 16;
  return 13;
}

function notesPage(slide: number, total: number, title: string | null, text: string): string {
  return (
    `<div class="aired-pdf-notes" data-aired-notes="${slide}">` +
    `<p class="aired-pdf-notes-head">Speaker notes · slide ${slide} of ${total}</p>` +
    (title ? `<p class="aired-pdf-notes-title">${escapeHtml(title)}</p>` : "") +
    `<p class="aired-pdf-notes-body" style="font-size:${noteFontPx(text)}px">${escapeHtml(text)}</p>` +
    `</div>`
  );
}

function intoHead(html: string, tag: string): string {
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${tag}</head>`) : tag + html;
}

function beforeBodyEnd(html: string, markup: string): string {
  return /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${markup}</body>`) : html + markup;
}

/**
 * The page's stored HTML as the browser should print it: the print CSS,
 * and for a deck its notes pages (when asked for) and the corner mark (on
 * free PDFs). Notes come from the owner's sidecar; the public HTML never
 * holds them.
 */
export function printHtml(html: string, opts: { kind: PdfKind; footer: boolean; notes?: { notes: string[]; titles: Array<string | null> } | null }): string {
  if (opts.kind !== "deck") return intoHead(html, `<style id="aired-pdf-css">${PAGE_PRINT_CSS}</style>`);
  let out = html;
  if (opts.notes) {
    const sections = topLevelSections(out);
    const total = sections.length;
    // From the last slide back, so earlier offsets stay right.
    for (let i = sections.length - 1; i >= 0; i--) {
      const text = (opts.notes.notes[i] ?? "").trim();
      if (text === "") continue;
      const end = sections[i]![1];
      out = out.slice(0, end) + notesPage(i + 1, total, opts.notes.titles[i] ?? null, text) + out.slice(end);
    }
  }
  out = intoHead(out, `<style id="aired-pdf-css">${DECK_PRINT_CSS}</style>`);
  if (opts.footer) out = beforeBodyEnd(out, `<div class="aired-pdf-mark">${escapeHtml(FOOTER_TEXT)}</div>`);
  return out;
}

/** Margins for docs and pages; decks print edge to edge at the slide size. */
export const PAGE_MARGINS = {
  doc: { top: "16mm", right: "16mm", bottom: "18mm", left: "16mm" },
  page: { top: "12mm", right: "12mm", bottom: "16mm", left: "12mm" },
} as const;

/** The page-number footer for docs and pages, with the aired line on free PDFs. Chrome needs every style inline here. */
export function footerTemplate(footer: boolean): string {
  return (
    `<div style="width:100%;box-sizing:border-box;padding:0 12mm;display:flex;justify-content:space-between;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:8px;color:#8a8a90">` +
    `<span>${footer ? escapeHtml(FOOTER_TEXT) : ""}</span>` +
    `<span><span class="pageNumber"></span> / <span class="totalPages"></span></span>` +
    `</div>`
  );
}

/** What page.pdf() is given for a variant. */
export function pdfOptions(v: PdfVariant): Record<string, unknown> {
  if (v.kind === "deck") {
    return { printBackground: true, preferCSSPageSize: true, width: `${SLIDE_WIDTH}px`, height: `${SLIDE_HEIGHT}px`, margin: { top: "0", right: "0", bottom: "0", left: "0" } };
  }
  return {
    printBackground: true,
    preferCSSPageSize: true,
    format: v.paper === "letter" ? "Letter" : "A4",
    margin: PAGE_MARGINS[v.kind],
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: footerTemplate(v.footer),
  };
}

// --- The download ---------------------------------------------------------------

/** A file name from the page's title: `q3-client-report.pdf`, `-notes` for the notes version. */
export function pdfFilename(title: string | null, id: string, notes: boolean): string {
  const slug = (title ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${slug === "" ? id : slug}${notes ? "-notes" : ""}.pdf`;
}

/** Content-Disposition for a download, with a UTF-8-safe fallback. */
export function contentDisposition(filename: string): string {
  return `attachment; filename="${filename.replace(/[^\x20-\x7e]|"/g, "_")}"`;
}

/** How many pages a PDF Chrome wrote has (each page is one `/Type /Page` object). */
export function countPdfPages(bytes: Uint8Array): number {
  // Latin-1, so every byte is one character and binary streams can't break the match.
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
}

/** A PDF's first bytes, so a broken render is never cached or served. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length > 8 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}
