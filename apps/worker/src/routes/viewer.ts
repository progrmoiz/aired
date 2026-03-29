import { Hono } from "hono";
import type { AppBindings } from "../types.js";
import { parseMetadata, serializeMetadata } from "@aired/core";
import { applyPageHeaders } from "../middleware/security.js";

const viewer = new Hono<AppBindings>();

// GET /p/:id — serve the published HTML page
viewer.get("/p/:id", async (c) => {
  const id = c.req.param("id");

  const raw = await c.env.PAGES_KV.get(`page:${id}`);
  if (raw === null) {
    return c.text("Page not found", 404);
  }

  const metadata = parseMetadata(raw);
  if (metadata === null) {
    return c.text("Page metadata is corrupted", 500);
  }

  // Check read limit
  if (metadata.reads !== null && metadata.readCount >= metadata.reads) {
    return new Response(
      `<!DOCTYPE html><html><head><title>Gone</title></head><body>
      <h1>410 Gone</h1>
      <p>This page has reached its maximum view limit and is no longer available.</p>
      </body></html>`,
      {
        status: 410,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }

  // Check PIN protection
  if (metadata.pin !== null) {
    const pinCookie = getCookie(c.req.header("Cookie"), `pin_${id}`);
    if (pinCookie !== metadata.pin) {
      return new Response(renderPinPage(id), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  }

  // Fetch HTML from R2
  const obj = await c.env.PAGES_BUCKET.get(`pages/${id}/index.html`);
  if (obj === null) {
    return c.text("Page content not found", 404);
  }

  const html = await obj.text();

  // Increment read count (eventually consistent — slight inaccuracy is acceptable)
  const newReadCount = metadata.readCount + 1;
  const updated = { ...metadata, readCount: newReadCount };
  const kvOptions: KVNamespacePutOptions = {};
  if (!metadata.permanent && metadata.expiresAt !== null) {
    const remaining = Math.floor(
      (new Date(metadata.expiresAt).getTime() - Date.now()) / 1000,
    );
    if (remaining > 0) {
      kvOptions.expirationTtl = remaining;
    }
  }
  // Fire-and-forget — don't block response
  const country = c.req.header("CF-IPCountry") ?? "XX";
  c.executionCtx.waitUntil(
    Promise.all([
      // Update read count
      c.env.PAGES_KV.put(`page:${id}`, serializeMetadata(updated), kvOptions),
      // Increment total views counter
      (async () => {
        const v = parseInt(await c.env.PAGES_KV.get("stats:views") ?? "0", 10);
        await c.env.PAGES_KV.put("stats:views", String(v + 1));
      })(),
      // Increment country counter
      (async () => {
        const cc = country.toUpperCase();
        const key = `stats:geo:${cc}`;
        const v = parseInt(await c.env.PAGES_KV.get(key) ?? "0", 10);
        await c.env.PAGES_KV.put(key, String(v + 1));
      })(),
      // Push to recent views list (keep last 20)
      (async () => {
        const key = "stats:recent-views";
        const raw2 = await c.env.PAGES_KV.get(key);
        const list: { title: string; country: string; ts: number }[] = raw2
          ? JSON.parse(raw2)
          : [];
        list.unshift({
          title: metadata.title ?? "Untitled",
          country: country.toUpperCase(),
          ts: Date.now(),
        });
        if (list.length > 20) list.length = 20;
        await c.env.PAGES_KV.put(key, JSON.stringify(list));
      })(),
    ]).catch(() => {}),
  );

  const headers = new Headers();
  applyPageHeaders(headers);

  // Extract title from HTML for OG tags
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const pageTitle = titleMatch?.[1]?.trim() || metadata.title || "Shared page";

  const wrappedHtml = injectAiredBar(html, {
    id,
    title: pageTitle,
    readCount: newReadCount,
  });

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

  if (pin !== metadata.pin) {
    return c.json({ error: "Incorrect PIN" }, 403);
  }

  // Set a cookie and return success — client handles redirect
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  // HttpOnly so JS can't read it; SameSite=Strict for security
  headers.set(
    "Set-Cookie",
    `pin_${id}=${metadata.pin}; Path=/p/${id}; HttpOnly; SameSite=Strict; Max-Age=3600`,
  );

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
});

// --- Helpers ---

/**
 * Injects OG meta tags into <head> and appends a floating "Aired bar" before </body>.
 * The bar is minimal: "Powered by aired · Report · Views: N"
 */
function injectAiredBar(
  html: string,
  opts: { id: string; title: string; readCount: number },
): string {
  const { id, title, readCount } = opts;

  const ogTags = `
  <!-- aired OG tags -->
  <meta property="og:title" content="${escapeAttr(title)}" />
  <meta property="og:description" content="Shared via aired.sh — publish HTML artifacts instantly." />
  <meta property="og:type" content="website" />`;

  // Inject OG tags before </head>
  let out = html.replace(/<\/head>/i, `${ogTags}\n</head>`);
  // If no </head>, prepend at the top (best-effort)
  if (out === html) {
    out = ogTags + "\n" + html;
  }

  const bar = `
<!-- aired bar -->
<style>
  #__aired-bar {
    position: fixed;
    bottom: 14px;
    right: 14px;
    display: inline-flex;
    align-items: center;
    gap: 0;
    padding: 5px 10px;
    background: rgba(10, 10, 10, 0.8);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: rgba(255,255,255,0.4);
    z-index: 2147483647;
    white-space: nowrap;
    pointer-events: auto;
    line-height: 1;
    transition: color 180ms ease, background 180ms ease, border-color 180ms ease;
  }
  #__aired-bar:hover {
    color: rgba(255,255,255,0.7);
    background: rgba(10, 10, 10, 0.9);
    border-color: rgba(255,255,255,0.15);
  }
  #__aired-bar a {
    color: inherit;
    text-decoration: none;
  }
  #__aired-bar .__aired-meta {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 0;
    overflow: hidden;
    opacity: 0;
    transition: max-width 250ms cubic-bezier(0.25, 0.1, 0.25, 1),
                opacity 200ms ease,
                margin 250ms ease;
    margin-left: 0;
  }
  #__aired-bar:hover .__aired-meta {
    max-width: 200px;
    opacity: 1;
    margin-left: 8px;
  }
  #__aired-bar .__aired-dot {
    width: 2px;
    height: 2px;
    border-radius: 50%;
    background: rgba(255,255,255,0.2);
    flex-shrink: 0;
  }
</style>
<div id="__aired-bar" role="complementary" aria-label="aired attribution">
  <a href="https://aired.sh" target="_blank" rel="noopener">aired</a>
  <span class="__aired-meta">
    <span class="__aired-dot"></span>
    <span>${readCount} view${readCount !== 1 ? 's' : ''}</span>
    <span class="__aired-dot"></span>
    <a href="#" onclick="(function(e){e.preventDefault();if(confirm('Report this page as inappropriate?')){fetch('/api/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'${id}',reason:'reported via viewer bar'})}).then(function(){alert('Reported. Thank you.')}).catch(function(){alert('Failed to report. Try again.')})}})(event);return false">report</a>
  </span>
</div>`;

  // Inject bar before </body>
  const barOut = out.replace(/<\/body>/i, `${bar}\n</body>`);
  // If no </body>, append at end
  return barOut === out ? out + bar : barOut;
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";");
  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.trim().split("=");
    if (key?.trim() === name) {
      return valueParts.join("=").trim() || null;
    }
  }
  return null;
}

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
