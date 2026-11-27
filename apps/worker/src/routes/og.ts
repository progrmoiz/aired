import { Hono } from "hono";
import type { AppBindings } from "../types.js";
import { parseMetadata } from "@aired/core";
import { pageViewCounts, viewCountOf } from "../lib/view-counts.ts";
import { cardTitle } from "../lib/public-meta.ts";
import { SHOT_CONTENT_TYPE, ogCacheControl, shotAllowed, shotKey, versionFromEtag } from "../lib/og-shot.js";

const og = new Hono<AppBindings>();

// GET /og/:id — the page's link-preview image: its screenshot when there is
// one (lib/og-shot.ts), else a title card drawn as SVG.
og.get("/og/:id", async (c) => {
  const id = c.req.param("id");

  const raw = await c.env.PAGES_KV.get(`page:${id}`);
  const metadata = raw === null ? null : parseMetadata(raw);

  // Only a live page that may have one gets its screenshot: a deleted or
  // expired page's file can outlive it in R2 until the sweep.
  if (metadata !== null && shotAllowed(metadata, Date.now())) {
    const shot = await c.env.PAGES_BUCKET.get(shotKey(id));
    if (shot !== null) {
      const shotVersion = shot.customMetadata?.html ? versionFromEtag(shot.customMetadata.html) : null;
      const asked = c.req.query("v");
      return new Response(shot.body, {
        headers: {
          "Content-Type": SHOT_CONTENT_TYPE,
          "Cache-Control": ogCacheControl("shot", asked !== undefined && asked === shotVersion),
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
  }

  let title = "Untitled";
  let views: number | null = 0;
  let expiryText = "";

  if (metadata) {
    // A PIN-protected page's card shows neither its title nor its views
    // (lib/public-meta.ts).
    title = cardTitle(metadata);
    views = metadata.pin !== null ? null : metadata.readCount;
    if (views !== null) {
      try {
        views = viewCountOf(await pageViewCounts(c.env.DB, [id]), id, metadata.readCount);
      } catch {
        // The card still draws, with the count frozen in KV.
      }
    }
    if (metadata.permanent) {
      expiryText = "Permanent";
    } else if (metadata.expiresAt) {
      const remaining = Math.max(
        0,
        Math.floor(
          (new Date(metadata.expiresAt).getTime() - Date.now()) / 86400000,
        ),
      );
      expiryText =
        remaining > 0 ? `Expires in ${remaining}d` : "Expired";
    }
  }

  // Truncate title
  const maxLen = 40;
  const displayTitle =
    title.length > maxLen ? title.slice(0, maxLen - 1) + "..." : title;

  const svg = renderOgSvg({
    title: escapeXml(displayTitle),
    views,
    expiryText,
    id,
  });

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": ogCacheControl("card", false),
    },
  });
});

function renderOgSvg(opts: {
  title: string;
  /** null: a PIN-protected page, whose views aren't shown. */
  views: number | null;
  expiryText: string;
  id: string;
}): string {
  const { title, views, expiryText, id } = opts;
  const viewsText = views === null ? "PIN required" : `${views} view${views !== 1 ? "s" : ""}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="80%" cy="45%" r="45%">
      <stop offset="0%" stop-color="#7c6aef" stop-opacity="0.12"/>
      <stop offset="60%" stop-color="#7c6aef" stop-opacity="0.03"/>
      <stop offset="100%" stop-color="#0a0a0b" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="1200" height="630" fill="#0a0a0b"/>
  <rect width="1200" height="630" fill="url(#glow)"/>

  <!-- Broadcast beacon -->
  <g transform="translate(820, 100) scale(8)">
    <circle cx="9" cy="23" r="3.5" fill="#7c6aef" opacity="0.4"/>
    <path d="M9 13 A10 10 0 0 1 19 23" fill="none" stroke="#7c6aef" stroke-width="2.5" stroke-linecap="round" opacity="0.3"/>
    <path d="M9 6 A17 17 0 0 1 26 23" fill="none" stroke="#7c6aef" stroke-width="2.5" stroke-linecap="round" opacity="0.18"/>
  </g>

  <!-- Page title — large and bold -->
  <text x="100" y="220" font-family="system-ui, -apple-system, sans-serif" font-size="80" font-weight="600" fill="#ededef" letter-spacing="-0.03em">${title}</text>

  <!-- Meta row -->
  <text x="104" y="280" font-family="system-ui, -apple-system, sans-serif" font-size="28" fill="#8a8a8e">
    <tspan>${viewsText}</tspan>
    <tspan dx="16" fill="#56565a">·</tspan>
    <tspan dx="16">${expiryText}</tspan>
  </text>

  <!-- URL bar -->
  <rect x="100" y="340" width="560" height="62" rx="10" fill="#111113" stroke="#222225" stroke-width="1.5"/>
  <text x="132" y="380" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="22" fill="#56565a">aired.sh/p/</text>
  <text x="350" y="380" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="22" fill="#7c6aef">${id}</text>

  <!-- Branding bottom right -->
  <text x="1100" y="580" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="500" fill="#7c6aef" text-anchor="end">aired.sh</text>
</svg>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export { og };
