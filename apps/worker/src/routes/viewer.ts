import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { AppBindings } from "../types.js";
import { parseMetadata, serializeMetadata } from "@aired/core";
import { updatePagePin } from "../lib/pages-store.ts";
import { applyPageHeaders } from "../middleware/security.js";
import { countCountryView, countPageView } from "../lib/view-counts.ts";
import { viewEvent, viewerCountry } from "../lib/view-event.ts";
import { SANDBOX_SHIM, injectEarlyScript } from "../lib/sandbox-shim.js";
import { injectAiredBar } from "../lib/aired-bar.js";
import { siteOrigin } from "../lib/origin.ts";
import { versionFromEtag } from "../lib/og-shot.js";
import { getEntitlements } from "../lib/entitlements.js";
import { notFoundPage } from "../lib/not-found.js";
import { viewWrite } from "../lib/view-write.js";
import { hashPin, isPinHash, pinCookieValue, verifyPin, verifyPinCookie } from "../lib/pin-hash.js";
import { underBurstLimit } from "../lib/burst-limit.js";
import { pinGuessKeys, visitorNetwork } from "../lib/pin-guess.js";
import { releasePinAttempt, reservePinAttempt } from "../lib/pin-failures.js";
import { hashToHex } from "@aired/core";
import { dataLayerFor, VIEWER_COOKIE } from "../lib/collect-page.ts";

/** A page that has used up its view limit. */
function viewLimitReached(): Response {
  return new Response(
    `<!DOCTYPE html><html><head><title>Gone</title></head><body>
      <h1>410 Gone</h1>
      <p>This page has reached its maximum view limit and is no longer available.</p>
      </body></html>`,
    { status: 410, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/** How long a correct PIN entry lets the browser in. */
const PIN_COOKIE_SECONDS = 3600;

const viewer = new Hono<AppBindings>();

// GET /p/:id — serve the published HTML page
viewer.get("/p/:id", async (c) => {
  const id = c.req.param("id");

  const raw = await c.env.PAGES_KV.get(`page:${id}`);
  if (raw === null) {
    return notFoundPage(c.env.ASSETS, c.req.url);
  }

  const metadata = parseMetadata(raw);
  if (metadata === null) {
    return c.text("Page metadata is corrupted", 500);
  }

  // An expired page KV still hands out for a moment is gone, like a missing one.
  const write = viewWrite(metadata, Date.now());
  if (write.expired) {
    return notFoundPage(c.env.ASSETS, c.req.url);
  }

  // View limit, from the count frozen in the KV record. The D1 count below
  // is the one that decides; this only skips the work for a page long gone.
  if (metadata.reads !== null && metadata.readCount >= metadata.reads) {
    return viewLimitReached();
  }

  // Check PIN protection
  if (metadata.pin !== null) {
    // The cookie is an HMAC token from verify-pin, never the PIN itself.
    const allowed = await verifyPinCookie(
      c.env.SESSION_SECRET,
      id,
      getCookie(c, `pin_${id}`),
      Math.floor(Date.now() / 1000),
    );
    if (!allowed) {
      return new Response(renderPinPage(id), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  }

  // Count the view while R2 fetches the HTML: one D1 write (lib/view-counts.ts),
  // atomic, so a view limit holds. No KV write. If D1 fails, the page still
  // opens and the view goes uncounted.
  const counting = countPageView(c.env.DB, id, metadata.readCount, metadata.reads).catch((err) => {
    console.error("view count failed", { id, err });
    return null;
  });
  const obj = await c.env.PAGES_BUCKET.get(`pages/${id}/index.html`);
  const counted = await counting;
  if (obj === null) {
    return notFoundPage(c.env.ASSETS, c.req.url, "Page content not found");
  }
  if (counted !== null && !counted.counted) {
    return viewLimitReached();
  }
  const newReadCount = counted !== null ? counted.count : metadata.readCount + 1;

  const html = await obj.text();

  // The details Pro owners see (lib/view-event.ts): page, owner, country,
  // referrer host and day. Never the IP. writeDataPoint doesn't block.
  const now = Date.now();
  try {
    c.env.VIEWS?.writeDataPoint(
      viewEvent({ pageId: id, ownerId: metadata.ownerId, headers: c.req.raw.headers, siteHost: new URL(siteOrigin(c.env)).host, nowMs: now }),
    );
  } catch (err) {
    console.error("view event write failed", { id, err });
  }
  // The public per-country totals (GET /api/stats), in the background.
  if (counted !== null) {
    const country = viewerCountry(c.req.raw.headers);
    c.executionCtx.waitUntil(
      countCountryView(c.env.DB, country).catch((err) => console.error("country view count failed", { id, err })),
    );
  }

  const headers = new Headers();
  applyPageHeaders(headers, { indexable: metadata.ownerId !== null });

  // Extract title from HTML for OG tags
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const pageTitle = titleMatch?.[1]?.trim() || metadata.title || "Shared page";

  // Pro owners get no badge. Anonymous pages skip the lookup; if it fails,
  // show the badge rather than break the page.
  let badge = true;
  if (metadata.ownerId !== null) {
    try {
      badge = (await getEntitlements(c.env, metadata.ownerId)).badge;
    } catch {
      badge = true;
    }
  }

  // window.aired for pages that use the data layer (lib/collect-page.ts):
  // a per-viewer token, so the response is never cached.
  const dataLayer = await dataLayerFor({
    secret: c.env.SESSION_SECRET, origin: siteOrigin(c.env), id, ownerId: metadata.ownerId, html, cookie: getCookie(c, VIEWER_COOKIE), nowMs: now,
  });
  if (dataLayer !== null) {
    headers.set("Cache-Control", "private, no-store");
    if (dataLayer.setCookie !== null) headers.append("Set-Cookie", dataLayer.setCookie);
  }

  // The shim must run before page scripts, so it goes in after the bar's
  // own <head> injection.
  const wrappedHtml = injectEarlyScript(
    injectAiredBar(html, {
      origin: siteOrigin(c.env),
      id,
      title: pageTitle,
      readCount: newReadCount,
      badge,
      // Changes with every update, so previews fetch the new screenshot.
      imageVersion: versionFromEtag(obj.etag),
    }),
    SANDBOX_SHIM + (dataLayer?.script ?? ""),
  );

  return new Response(wrappedHtml, { status: 200, headers });
});

// POST /p/:id/verify-pin — verify PIN, set cookie, redirect
viewer.post("/p/:id/verify-pin", async (c) => {
  const id = c.req.param("id");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    // Try form data fallback
    try {
      const form = await c.req.formData();
      body = { pin: form.get("pin") };
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }
  }

  if (typeof body !== "object" || body === null) {
    return c.json({ error: "Request body must be a JSON object" }, 400);
  }

  const { pin } = body as Record<string, unknown>;
  if (typeof pin !== "string") {
    return c.json({ error: "pin is required" }, 400);
  }

  // Limit guesses per page and visitor, and per page in all (lib/pin-guess.ts).
  // The address is only hashed into the key, never stored.
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const keys = pinGuessKeys(id, await hashToHex(visitorNetwork(ip), 16));
  if (
    !(await underBurstLimit(c.env.PIN_GUESS, keys.visitor)) ||
    !(await underBurstLimit(c.env.PIN_GUESS_PAGE, keys.page))
  ) {
    return c.json({ error: "Too many tries. Wait a minute and try again." }, 429);
  }

  const raw = await c.env.PAGES_KV.get(`page:${id}`);
  if (raw === null) {
    return c.json({ error: "Page not found" }, 404);
  }

  const metadata = parseMetadata(raw);
  if (metadata === null) {
    return c.json({ error: "Page metadata is corrupted" }, 500);
  }

  if (metadata.pin === null) {
    return c.json({ error: "Page is not PIN protected" }, 400);
  }

  // The global cap (lib/pin-failures.ts): reserve the attempt atomically
  // before checking, so parallel guesses can't slip past. If D1 fails, the
  // per-location limits above still apply.
  let reserved = false;
  try {
    if (!(await reservePinAttempt(c.env.DB, id, Date.now()))) {
      return c.json({ error: "Too many wrong PINs for this page. Try again in 15 minutes." }, 429);
    }
    reserved = true;
  } catch (err) {
    console.error("pin attempt reservation failed", { id, err });
  }

  const check = await verifyPin(pin, metadata.pin);
  if (!check.ok) {
    return c.json({ error: "Incorrect PIN" }, 403);
  }
  // Only wrong PINs use up the page's budget.
  if (reserved) {
    c.executionCtx.waitUntil(
      releasePinAttempt(c.env.DB, id).catch((err) => console.error("pin attempt release failed", { id, err })),
    );
  }

  // A page from before hashing holds the PIN as typed: store it hashed now.
  // Keeps the page's expiry; skipped if it's about to expire (view-write.ts).
  if (check.needsRehash) {
    const hashed = await hashPin(pin);
    c.executionCtx.waitUntil(
      (async () => {
        // Re-read right before writing: skip a page that's gone, already
        // rehashed, or whose PIN changed, and keep everything else as it is now.
        const freshRaw = await c.env.PAGES_KV.get(`page:${id}`);
        const fresh = freshRaw === null ? null : parseMetadata(freshRaw);
        if (fresh === null || fresh.pin !== metadata.pin || fresh.pin === null || isPinHash(fresh.pin)) return;
        const write = viewWrite(fresh, Date.now());
        if (write.expired || write.options === null) return;
        await c.env.PAGES_KV.put(`page:${id}`, serializeMetadata({ ...fresh, pin: hashed }), write.options);
        // The D1 row holds the PIN too (lib/pages-store.ts).
        await updatePagePin(c.env.DB, id, fresh.pin, hashed, Date.now());
      })().catch((err) => {
        console.error("pin rehash failed", { id, err });
      }),
    );
  }

  // Set a cookie and return success — client handles redirect
  const expSec = Math.floor(Date.now() / 1000) + PIN_COOKIE_SECONDS;
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  // HttpOnly so JS can't read it; SameSite=Strict for security. An HMAC token,
  // not the PIN, so the cookie reveals nothing.
  headers.set(
    "Set-Cookie",
    `pin_${id}=${await pinCookieValue(c.env.SESSION_SECRET, id, expSec)}; Path=/p/${id}; HttpOnly; Secure; SameSite=Strict; Max-Age=${PIN_COOKIE_SECONDS}`,
  );

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
});

// --- Helpers ---

function renderPinPage(id: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PIN Required — aired.sh</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      text-align: center;
      padding: 2rem;
      max-width: 360px;
      width: 100%;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    p {
      color: #888;
      font-size: 0.875rem;
      margin-bottom: 1.5rem;
    }
    input {
      width: 100%;
      padding: 0.75rem 1rem;
      font-size: 1rem;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 6px;
      color: #e5e5e5;
      text-align: center;
      letter-spacing: 0.25em;
      outline: none;
      margin-bottom: 1rem;
    }
    input:focus { border-color: #555; }
    button {
      width: 100%;
      padding: 0.75rem;
      font-size: 0.9rem;
      font-weight: 500;
      background: #e5e5e5;
      color: #0a0a0a;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }
    button:hover { background: #fff; }
    .error {
      color: #f87171;
      font-size: 0.8rem;
      margin-top: 0.5rem;
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>PIN Required</h1>
    <p>This page is protected. Enter the PIN to view it.</p>
    <form id="pin-form">
      <input
        type="password"
        id="pin-input"
        name="pin"
        inputmode="numeric"
        placeholder="Enter PIN"
        autocomplete="off"
        maxlength="20"
        autofocus
      />
      <button type="submit">Unlock</button>
      <p class="error" id="error-msg">Incorrect PIN. Try again.</p>
    </form>
  </div>
  <script>
    const form = document.getElementById('pin-form');
    const input = document.getElementById('pin-input');
    const errorMsg = document.getElementById('error-msg');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorMsg.style.display = 'none';
      const pin = input.value.trim();
      if (!pin) return;

      const res = await fetch('/p/${id}/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
        credentials: 'same-origin',
      });

      if (res.ok) {
        window.location.reload();
      } else {
        errorMsg.style.display = 'block';
        input.value = '';
        input.focus();
      }
    });
  </script>
</body>
</html>`;
}

export { viewer };
