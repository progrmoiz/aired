import { Hono } from "hono";
import type { AppBindings } from "../types.js";
import { parseMetadata } from "@aired/core";

const og = new Hono<AppBindings>();

// GET /og/:id — dynamic OG image as SVG (served as PNG via resvg or as SVG directly)
og.get("/og/:id", async (c) => {
  const id = c.req.param("id");

  const raw = await c.env.PAGES_KV.get(`page:${id}`);

  let title = "Untitled";
  let views = 0;
  let expiryText = "";

  if (raw !== null) {
    const metadata = parseMetadata(raw);
    if (metadata) {
      title = metadata.title ?? "Untitled";
      views = metadata.readCount;
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
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
});

function renderOgSvg(opts: {
  title: string;
  views: number;
  expiryText: string;
  id: string;
}): string {
  const { title, views, expiryText, id } = opts;
  const viewsText = `${views} view${views !== 1 ? "s" : ""}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="75%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#7c6aef" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#0a0a0b" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="1200" height="630" fill="#0a0a0b"/>
  <rect width="1200" height="630" fill="url(#glow)"/>

  <!-- Broadcast beacon -->
  <g transform="translate(880, 160) scale(5.5)">
    <circle cx="9" cy="23" r="3.5" fill="#7c6aef" opacity="0.25"/>
    <path d="M9 13 A10 10 0 0 1 19 23" fill="none" stroke="#7c6aef" stroke-width="3" stroke-linecap="round" opacity="0.15"/>
    <path d="M9 6 A17 17 0 0 1 26 23" fill="none" stroke="#7c6aef" stroke-width="3" stroke-linecap="round" opacity="0.08"/>
  </g>

  <!-- Page title -->
  <text x="100" y="260" font-family="system-ui, -apple-system, sans-serif" font-size="56" font-weight="600" fill="#ededef" letter-spacing="-0.03em">${title}</text>

  <!-- Meta row -->
  <text x="100" y="320" font-family="system-ui, -apple-system, sans-serif" font-size="24" fill="#8a8a8e">
    <tspan>${viewsText}</tspan>
    <tspan dx="16" fill="#56565a">·</tspan>
    <tspan dx="16">${expiryText}</tspan>
  </text>

  <!-- URL bar -->
  <rect x="100" y="380" width="440" height="48" rx="8" fill="#111113" stroke="#222225" stroke-width="1"/>
  <text x="124" y="411" font-family="monospace" font-size="18" fill="#56565a">aired.sh/p/</text>
  <text x="292" y="411" font-family="monospace" font-size="18" fill="#7c6aef">${id}</text>

  <!-- Bottom branding -->
  <text x="100" y="560" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="500" fill="#7c6aef">aired</text>
  <text x="170" y="560" font-family="system-ui, -apple-system, sans-serif" font-size="16" fill="#56565a">Publish HTML artifacts instantly</text>
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
