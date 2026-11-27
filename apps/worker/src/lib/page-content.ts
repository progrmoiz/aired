import { htmlIsDeck, injectDeckRuntime, parseHtmlDeck } from "./deck.ts";
import { renderMarkdownPage } from "./doc-render.ts";

/**
 * What a publish or update turns into before it's stored (routes/api.ts,
 * routes/mcp.ts): the public HTML, plus — for Markdown and decks — a
 * sidecar kept beside it in R2 at `pages/<id>/doc.json`.
 *
 * - Plain HTML: stored as sent, no sidecar.
 * - Markdown: rendered to a doc or a deck (lib/doc-render.ts). The sidecar
 *   keeps the Markdown, so get_page and the page resource can return it.
 * - An HTML deck: its notes asides are cut out and the deck viewer is added.
 *   The sidecar keeps the HTML as sent, notes and all.
 *
 * The sidecar is the owner's: speaker notes and the source are read only by
 * owner routes (GET /api/pages/:id/source, /p/:id/presenter). The public
 * page never has them.
 */

export type PageKind = "page" | "doc" | "deck";

export type DocSidecar = {
  v: 1;
  kind: "doc" | "deck";
  format: "markdown" | "html";
  /** What was published, before rendering: Markdown, or the deck's HTML with its notes. */
  source: string;
  slides: number;
  /** Deck only: speaker notes and titles, one per slide. */
  notes: string[];
  titles: Array<string | null>;
};

export type PageContent = {
  /** The HTML to store and serve. Never holds speaker notes. */
  html: string;
  /** The title the content gives itself, if any (front matter, first heading, <title>). */
  title: string | null;
  kind: PageKind;
  sidecar: DocSidecar | null;
};

export type ContentInput = { html?: string; markdown?: string; deck?: boolean };

export const sidecarKey = (id: string): string => `pages/${id}/doc.json`;

/** The publish body's content as a page. Markdown wins when both are sent. */
export function buildContent(input: ContentInput): PageContent {
  if (typeof input.markdown === "string") {
    const r = renderMarkdownPage(input.markdown, { deck: input.deck === true });
    return {
      html: r.html,
      title: r.title,
      kind: r.kind,
      sidecar: { v: 1, kind: r.kind, format: "markdown", source: input.markdown, slides: r.kind === "deck" ? r.notes.length : 0, notes: r.notes, titles: r.titles },
    };
  }
  const html = input.html ?? "";
  if (input.deck === true || htmlIsDeck(html)) {
    const deck = parseHtmlDeck(html);
    if (deck.notes.length > 0) {
      return {
        html: injectDeckRuntime(deck.html),
        title: null,
        kind: "deck",
        sidecar: { v: 1, kind: "deck", format: "html", source: html, slides: deck.notes.length, notes: deck.notes, titles: deck.titles },
      };
    }
    // Asked for a deck but no <section> slides: an ordinary page, but still no notes.
    return { html: deck.html, title: null, kind: "page", sidecar: null };
  }
  return { html, title: null, kind: "page", sidecar: null };
}

/** A stored sidecar, or null when there is none or it can't be read. */
export function parseSidecar(text: string | null): DocSidecar | null {
  if (text === null) return null;
  try {
    const v = JSON.parse(text) as Partial<DocSidecar>;
    if (v.v !== 1 || (v.kind !== "doc" && v.kind !== "deck") || (v.format !== "markdown" && v.format !== "html") || typeof v.source !== "string") return null;
    return {
      v: 1,
      kind: v.kind,
      format: v.format,
      source: v.source,
      slides: typeof v.slides === "number" ? v.slides : 0,
      notes: Array.isArray(v.notes) ? v.notes.map((n) => (typeof n === "string" ? n : "")) : [],
      titles: Array.isArray(v.titles) ? v.titles.map((t) => (typeof t === "string" ? t : null)) : [],
    };
  } catch {
    return null;
  }
}

/** The sidecar of a page, from R2. */
export async function readSidecar(bucket: R2Bucket, id: string): Promise<DocSidecar | null> {
  const obj = await bucket.get(sidecarKey(id));
  return obj === null ? null : parseSidecar(await obj.text());
}

/**
 * Store a page's sidecar, or remove the old one when the new content has
 * none (a deck updated with plain HTML is a plain page again).
 */
export async function writeSidecar(bucket: R2Bucket, id: string, sidecar: DocSidecar | null): Promise<void> {
  if (sidecar === null) {
    await bucket.delete(sidecarKey(id));
    return;
  }
  await bucket.put(sidecarKey(id), JSON.stringify(sidecar), { httpMetadata: { contentType: "application/json; charset=utf-8" } });
}

/** The speaker view of a deck: notes and slide titles, for its signed-in owner only. */
export const presenterUrl = (origin: string, id: string): string => `${origin}/p/${id}/presenter`;

/**
 * Extra fields for a publish or update answer: nothing for a plain page;
 * the kind for a doc; for a deck also its slide count, how many slides have
 * notes, and the speaker view's link. Never the notes themselves.
 */
export function contentFields(origin: string, id: string, sidecar: DocSidecar | null): Record<string, unknown> {
  if (sidecar === null) return {};
  if (sidecar.kind === "doc") return { kind: "doc" };
  return { kind: "deck", slides: sidecar.slides, slides_with_notes: sidecar.notes.filter((n) => n !== "").length, presenter_url: presenterUrl(origin, id) };
}

/** The kind of a page, from its sidecar. */
export const kindOf = (sidecar: DocSidecar | null): PageKind => sidecar?.kind ?? "page";
