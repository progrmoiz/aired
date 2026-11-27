import { Hono } from "hono";
import type { AppBindings } from "../types.js";
import { loadPage } from "../lib/page-write.ts";
import { readSidecar } from "../lib/page-content.ts";
import { notFoundPage } from "../lib/not-found.js";
import { siteOrigin } from "../lib/origin.ts";
import { presenterPage, speakerRefusedPage } from "../lib/presenter-page.ts";

/**
 * GET /p/:id/presenter — a deck's speaker view: each slide's notes, the next
 * slide's title, a timer, and buttons that move the slides in the deck's own
 * window. Only the signed-in owner gets it (session cookie, or an API key);
 * everyone else gets the same refusal, whether or not the page is a deck or
 * has notes, so nothing about the notes leaks.
 *
 * This is its own route, apart from the viewer (routes/viewer.ts): the
 * public page never holds the notes, and this one is never cached or shared.
 */
const presenter = new Hono<AppBindings>();

const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function privateHeaders(nonce: string): Headers {
  return new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
}

function newNonce(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, "");
}

presenter.get("/p/:id/presenter", async (c) => {
  const id = c.req.param("id");
  if (!PAGE_ID.test(id)) return notFoundPage(c.env.ASSETS, c.req.url);
  let page;
  try {
    page = await loadPage(c.env, id);
  } catch (err) {
    console.error("presenter lookup failed", { id, err });
    return c.text("Could not load this deck. Please try again.", 503, { "Cache-Control": "no-store" });
  }
  if (page === null) return notFoundPage(c.env.ASSETS, c.req.url);

  const nonce = newNonce();
  const user = c.get("user");
  const owner = user !== null && page.row.ownerId !== null && page.row.ownerId === user.id;
  if (!owner) {
    return new Response(speakerRefusedPage({ id, signedIn: user !== null, origin: siteOrigin(c.env) }), { status: 403, headers: privateHeaders(nonce) });
  }

  const sidecar = await readSidecar(c.env.PAGES_BUCKET, id).catch(() => null);
  return new Response(
    presenterPage({ id, title: page.row.title, nonce, deck: sidecar?.kind === "deck" ? sidecar : null }),
    { status: 200, headers: privateHeaders(nonce) },
  );
});

export { presenter };
