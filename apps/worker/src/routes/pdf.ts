import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import type { AppBindings } from "../types.js";
import { hashToHex } from "@aired/core";
import { rateLimit } from "../middleware/rate-limit.js";
import { requireCsrfHeader } from "../middleware/csrf.js";
import { TIERS } from "../lib/rate-limit-tiers.js";
import { underBurstLimit } from "../lib/burst-limit.js";
import { siteOrigin } from "../lib/origin.ts";
import { apiError } from "../lib/errors.ts";
import { loadPage, type LoadedPage } from "../lib/page-write.ts";
import { readSidecar, type DocSidecar } from "../lib/page-content.ts";
import { getEntitlements } from "../lib/entitlements.js";
import { verifyPinCookie } from "../lib/pin-hash.js";
import { visitorNetwork } from "../lib/pin-guess.js";
import { renderPdf } from "../lib/og-render.js";
import { BrowserUnavailable } from "../lib/browser-budget.ts";
import { versionFromEtag } from "../lib/og-shot.ts";
import {
  PDF_LINK_TTL_SECONDS,
  PDF_MAX_HTML_BYTES,
  contentDisposition,
  countPdfPages,
  looksLikePdf,
  paperFor,
  parsePaper,
  pdfFilename,
  pdfKey,
  pdfLinkToken,
  printHtml,
  readPdfLinkToken,
  variantName,
  verifyPdfViewerGrant,
  viewerPdfAllowed,
  type Paper,
  type PdfCallerTier,
  type PdfKind,
  type PdfVariant,
} from "../lib/pdf-export.ts";
import { accessGate } from "./access.ts";
import { ownerAccess, pageFor, sentUpdateToken } from "../lib/pages-service.ts";

/**
 * PDF export (rules in lib/pdf-export.ts, the browser in lib/og-render.ts):
 *
 *   GET  /p/:id/pdf               the download, in a browser: the signed-in
 *                                 owner, or a viewer who could open the page
 *                                 now when the owner allows it.
 *                                 ?paper=a4|letter, ?notes=1 (owner only).
 *   GET  /p/:id/pdf?t=…           a download link from the route below:
 *                                 one cached PDF of one version, for 15 minutes.
 *   POST /api/pages/:id/pdf       the owner (update token or signed in) gets
 *                                 a download link (CLI `aired pdf`, export_pdf).
 *
 * Under /p/:id so the PIN and email-code cookies (Path=/p/<id>) come along.
 * A locked page answers one refusal whatever the request, so nothing about
 * it leaks; a PDF never counts a view.
 */
const pdf = new Hono<AppBindings>();

const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

type Caller = { key: string; tier: PdfCallerTier };

const UNAVAILABLE: Record<BrowserUnavailable["reason"], { status: 429 | 503; code: string; error: string }> = {
  budget: { status: 429, code: "pdf_budget", error: "PDF export has used today's browser time (yours or everyone's). PDFs already made still download; new ones start again at 00:00 UTC." },
  busy: { status: 503, code: "pdf_busy", error: "The browser is busy. Try again after Retry-After seconds." },
  storage: { status: 503, code: "pdf_unavailable", error: "Couldn't read the PDF budget. Try again shortly." },
  no_browser: { status: 503, code: "pdf_unavailable", error: "PDF export isn't available on this server." },
};

export const LOCKED_MESSAGE = "Open the page and unlock it first, then download the PDF.";
export const NOT_ALLOWED_MESSAGE = "The owner of this page hasn't turned on PDF downloads.";
export const NOTES_MESSAGE = "Speaker notes are only for the deck's owner, signed in.";

class PdfFailed extends Error {}
class PdfTooBig extends Error {}

/** Who a render counts against: the account, else the network (hashed, IPv6 by /64). */
async function callerOf(c: Context<AppBindings>, fallbackTier: PdfCallerTier): Promise<Caller> {
  const user = c.get("user");
  if (user) {
    const plan = await getEntitlements(c.env, user.id).then((e) => e.plan).catch(() => "free" as const);
    return { key: `u:${user.id}`, tier: plan === "pro" ? "pro" : "free" };
  }
  return { key: `ip:${await hashToHex(visitorNetwork(c.req.header("CF-Connecting-IP") ?? "unknown"), 16)}`, tier: fallbackTier };
}

/** Free and anonymous pages carry the small aired line; Pro owners' don't. A failed lookup keeps it. */
async function footerFor(c: Context<AppBindings>, ownerId: number | null): Promise<boolean> {
  if (ownerId === null) return true;
  try {
    return (await getEntitlements(c.env, ownerId)).badge;
  } catch {
    return true;
  }
}

type Made = { bytes: Uint8Array; cached: boolean; htmlEtag: string; variant: PdfVariant; pages: number };

/**
 * The PDF of the page's live version in this variant: from R2 when it was
 * made before, else rendered (within the budget) and kept for next time.
 */
async function makePdf(c: Context<AppBindings>, page: LoadedPage, sidecar: DocSidecar | null, want: { paper: Paper; notes: boolean }, caller: Caller): Promise<Made> {
  const id = page.row.id;
  const kind: PdfKind = sidecar?.kind ?? "page";
  const variant: PdfVariant = { kind, paper: want.paper, notes: kind === "deck" && want.notes, footer: await footerFor(c, page.row.ownerId) };
  const head = await c.env.PAGES_BUCKET.head(`pages/${id}/index.html`);
  if (head === null) throw new PdfFailed("no html");
  const hit = await c.env.PAGES_BUCKET.get(pdfKey(id, head.etag, variant));
  if (hit !== null) {
    const bytes = new Uint8Array(await hit.arrayBuffer());
    if (looksLikePdf(bytes)) return { bytes, cached: true, htmlEtag: head.etag, variant, pages: Number(hit.customMetadata?.pages ?? countPdfPages(bytes)) };
  }

  const obj = await c.env.PAGES_BUCKET.get(`pages/${id}/index.html`);
  if (obj === null) throw new PdfFailed("no html");
  const key = pdfKey(id, obj.etag, variant);
  const html = await obj.text();
  if (new TextEncoder().encode(html).byteLength > PDF_MAX_HTML_BYTES) throw new PdfTooBig("too big");
  // A new render, so the per-minute guard counts it (cached downloads don't).
  if (!(await underBurstLimit(c.env.PDF_BURST, caller.key))) throw new BrowserUnavailable("busy", 60);
  const printable = printHtml(html, { kind, footer: variant.footer, notes: variant.notes && sidecar !== null ? { notes: sidecar.notes, titles: sidecar.titles } : null });
  const t0 = Date.now();
  const bytes = await renderPdf(c.env, id, printable, variant, caller);
  if (!looksLikePdf(bytes)) throw new PdfFailed("not a pdf");
  const pages = countPdfPages(bytes);
  console.log({ event: "pdf", id, variant: variantName(variant), ms: Date.now() - t0, bytes: bytes.byteLength, pages });
  try {
    // The page may have been updated while the browser ran: keep only a PDF of the live version.
    const current = await c.env.PAGES_BUCKET.head(`pages/${id}/index.html`);
    if (current !== null && current.etag === obj.etag) {
      await c.env.PAGES_BUCKET.put(key, bytes, { httpMetadata: { contentType: "application/pdf" }, customMetadata: { html: obj.etag, pages: String(pages) } });
    }
  } catch (err) {
    console.error("pdf cache write failed", { id, err: String(err) });
  }
  return { bytes, cached: false, htmlEtag: obj.etag, variant, pages };
}

function download(bytes: Uint8Array, filename: string): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(filename),
      "Content-Length": String(bytes.byteLength),
      // Owner-only variants exist, and a locked page's copy must never sit in a shared cache.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/** A short plain-text answer for someone who clicked a link in a browser. */
function refuse(status: 400 | 403 | 404 | 410 | 413 | 429 | 502 | 503, message: string, retryAfter?: number): Response {
  const headers: Record<string, string> = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  if (retryAfter !== undefined) headers["Retry-After"] = String(retryAfter);
  return new Response(message, { status, headers });
}

function unavailable(err: BrowserUnavailable): Response {
  const u = UNAVAILABLE[err.reason];
  return refuse(u.status, u.error, err.waitSeconds ?? undefined);
}

/**
 * Whether this browser could open the page right now, as the viewer
 * decides (routes/viewer.ts): the PIN cookie (or the grant the unlocked
 * page's button carries), and the email-code cookie of someone still on the list. Not for the owner, who is let in before this.
 */
async function viewerUnlocked(c: Context<AppBindings>, page: LoadedPage): Promise<boolean | Response> {
  const { row } = page;
  const nowSec = Math.floor(Date.now() / 1000);
  if (
    row.pin !== null &&
    !(await verifyPinCookie(c.env.SESSION_SECRET, row.id, getCookie(c, `pin_${row.id}`), nowSec)) &&
    !(await verifyPdfViewerGrant(c.env.SESSION_SECRET, row.id, row.pin, c.req.query("g"), nowSec))
  ) {
    return false;
  }
  if (row.access === "people") {
    const gate = await accessGate(c, row.id, row.ownerId);
    if (gate instanceof Response) return gate.status === 503 ? gate : false;
  }
  return true;
}

// GET /p/:id/pdf — download the page as a PDF.
pdf.get("/p/:id/pdf", rateLimit(TIERS.pdf), async (c) => {
  const id = c.req.param("id") ?? "";
  if (!PAGE_ID.test(id)) return refuse(404, "Page not found");
  let page: LoadedPage | null;
  try {
    page = await loadPage(c.env, id);
  } catch (err) {
    console.error("pdf page lookup failed", { id, err: String(err) });
    return refuse(503, "Could not load this page. Try again in a minute.", 30);
  }
  if (page === null) return refuse(404, "Page not found");

  // A download link: one cached PDF of the version it was made for, never a new render.
  const t = c.req.query("t");
  if (t !== undefined) {
    const link = await readPdfLinkToken(c.env.SESSION_SECRET, id, t, Math.floor(Date.now() / 1000));
    if (link === null) return refuse(410, "This download link has expired. Ask for a new one.");
    const head = await c.env.PAGES_BUCKET.head(`pages/${id}/index.html`);
    if (head === null || versionFromEtag(head.etag) !== link.version) return refuse(410, "The page has changed since this link was made. Ask for a new one.");
    const obj = await c.env.PAGES_BUCKET.get(pdfKey(id, head.etag, link.variant));
    if (obj === null) return refuse(410, "This download link has expired. Ask for a new one.");
    return download(new Uint8Array(await obj.arrayBuffer()), pdfFilename(page.row.title, id, link.variant.notes));
  }

  const user = c.get("user");
  const isOwner = user !== null && user !== undefined && page.row.ownerId !== null && user.id === page.row.ownerId;
  const notes = c.req.query("notes") === "1" || c.req.query("notes") === "true";
  if (!isOwner) {
    const unlocked = await viewerUnlocked(c, page);
    if (unlocked instanceof Response) return unlocked;
    if (!unlocked) return refuse(403, LOCKED_MESSAGE);
    if (notes) return refuse(403, NOTES_MESSAGE);
    if (!viewerPdfAllowed(page.row)) return refuse(403, NOT_ALLOWED_MESSAGE);
  }
  const paper = parsePaper(c.req.query("paper"));
  if (paper === undefined) return refuse(400, 'paper must be "a4" or "letter"');

  let sidecar: DocSidecar | null;
  try {
    sidecar = await readSidecar(c.env.PAGES_BUCKET, id);
  } catch (err) {
    console.error("pdf sidecar read failed", { id, err: String(err) });
    return refuse(503, "Could not load this page. Try again in a minute.", 30);
  }
  const caller = await callerOf(c, "viewer");
  try {
    const made = await makePdf(c, page, sidecar, { paper: paper ?? paperFor(c.req.header("CF-IPCountry")), notes }, caller);
    return download(made.bytes, pdfFilename(page.row.title, id, made.variant.notes));
  } catch (err) {
    if (err instanceof BrowserUnavailable) return unavailable(err);
    if (err instanceof PdfTooBig) return refuse(413, "This page is too big to turn into a PDF.");
    console.error("pdf failed", { id, err: String(err) });
    return refuse(502, "The PDF didn't finish. Try again; if it keeps failing, the page may hang the browser.");
  }
});

// POST /api/pages/:id/pdf — make (or reuse) the PDF and answer a download
// link that works for 15 minutes. Body: { update_token?, notes?: boolean,
// paper?: "a4" | "letter" }. Notes need the signed-in owner.
pdf.post("/api/pages/:id/pdf", requireCsrfHeader, rateLimit(TIERS.pdf), async (c) => {
  const id = c.req.param("id") ?? "";
  if (!PAGE_ID.test(id)) return apiError(c, 404, "not_found", "Page not found");
  let body: Record<string, unknown> = {};
  const raw = await c.req.text();
  if (raw.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return apiError(c, 400, "invalid_input", "Request body must be a JSON object");
      body = parsed as Record<string, unknown>;
    } catch {
      return apiError(c, 400, "invalid_json", "Invalid JSON body");
    }
  }
  if (body.notes !== undefined && typeof body.notes !== "boolean") return apiError(c, 400, "invalid_input", "notes must be true or false", { field: "notes" });
  const paper = parsePaper(body.paper);
  if (paper === undefined) return apiError(c, 400, "invalid_input", 'paper must be "a4" or "letter"', { field: "paper" });

  const page = await pageFor(c, id, "pdf");
  if (page instanceof Response) return page;
  const access = await ownerAccess(c, page, sentUpdateToken(c, body.update_token));
  if (!access.ok) return apiError(c, access.status, access.code, access.error);
  const user = c.get("user");
  const signedInOwner = user !== null && user !== undefined && page.row.ownerId !== null && user.id === page.row.ownerId;
  if (body.notes === true && !signedInOwner) return apiError(c, 403, "owner_required", `${NOTES_MESSAGE} An update token isn't enough.`);

  let sidecar: DocSidecar | null;
  try {
    sidecar = await readSidecar(c.env.PAGES_BUCKET, id);
  } catch (err) {
    console.error("pdf sidecar read failed", { id, err: String(err) });
    return apiError(c, 503, "unavailable", "Could not load this page. Try again shortly.");
  }
  const caller = await callerOf(c, "free");
  let made: Made;
  try {
    made = await makePdf(c, page, sidecar, { paper: paper ?? paperFor(c.req.header("CF-IPCountry")), notes: body.notes === true }, caller);
  } catch (err) {
    if (err instanceof BrowserUnavailable) {
      if (err.waitSeconds !== null) c.header("Retry-After", String(err.waitSeconds));
      const u = UNAVAILABLE[err.reason];
      return apiError(c, u.status, u.code, u.error);
    }
    if (err instanceof PdfTooBig) return apiError(c, 413, "too_large", "This page is too big to turn into a PDF.");
    console.error("pdf failed", { id, err: String(err) });
    return apiError(c, 502, "pdf_failed", "The PDF didn't finish. Try again; if it keeps failing, run check_page: the page may hang the browser.");
  }

  const origin = siteOrigin(c.env);
  const expSec = Math.floor(Date.now() / 1000) + PDF_LINK_TTL_SECONDS;
  const token = await pdfLinkToken(c.env.SESSION_SECRET, id, made.htmlEtag, made.variant, expSec);
  return c.json({
    id,
    url: `${origin}/p/${id}`,
    download_url: `${origin}/p/${encodeURIComponent(id)}/pdf?t=${encodeURIComponent(token)}`,
    expires_at: new Date(expSec * 1000).toISOString(),
    filename: pdfFilename(page.row.title, id, made.variant.notes),
    bytes: made.bytes.byteLength,
    pages: made.pages,
    kind: made.variant.kind,
    paper: made.variant.kind === "deck" ? null : made.variant.paper,
    notes: made.variant.notes,
    footer: made.variant.footer,
    cached: made.cached,
  });
});

export { pdf };
