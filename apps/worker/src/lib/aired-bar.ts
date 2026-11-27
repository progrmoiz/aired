/**
 * The "Shared with aired" badge added to every published page, plus the
 * OG tags that go in <head>.
 *
 * The badge sits bottom-right. A small script looks at what is painted
 * behind it and switches between a dark glass style (on dark pages, the
 * default) and a light one (on light pages), so it never looks pasted on.
 * Hover (or tap, on touch screens) reveals the view count and a report link.
 * Pages owned by a Pro account get the OG tags only (badge: false).
 *
 * When the owner lets viewers download a PDF (allow_pdf, lib/pdf-export.ts),
 * the badge gets a "PDF" button, always visible; a Pro page, which has no
 * badge, gets a small "Download PDF" button of its own in the same corner.
 * Neither is printed.
 */

export interface AiredBarOptions {
  /** siteOrigin(env): where the badge, report link and OG image point. */
  origin: string;
  id: string;
  title: string;
  readCount: number;
  /** Show the badge. Defaults to true; false for pages owned by a Pro account. */
  badge?: boolean;
  /** Added to the og:image URL as ?v= (og-shot.ts versionFromEtag). */
  imageVersion?: string;
  /** The viewer's PDF download link (lib/pdf-export.ts viewerPdfHref), or null for none. */
  pdfHref?: string | null;
}

export const badgeHref = (origin: string): string => `${origin}/?ref=badge`;
export const OG_DESCRIPTION = "Shared with aired. Turn HTML into a link anyone can open.";

export function injectAiredBar(html: string, opts: AiredBarOptions): string {
  const ogTags = renderOgTags(opts);
  let out = html.replace(/<\/head>/i, `${ogTags}\n</head>`);
  if (out === html) out = ogTags + "\n" + html;
  const bar = opts.badge === false ? (opts.pdfHref ? renderPdfButton(opts.pdfHref) : "") : renderAiredBar(opts);
  if (bar === "") return out;
  const barOut = out.replace(/<\/body>/i, `${bar}\n</body>`);
  return barOut === out ? out + bar : barOut;
}

export function renderOgTags({ origin, id, title, imageVersion }: AiredBarOptions): string {
  const ogImageUrl =
    `${origin}/og/${encodeURIComponent(id)}` +
    (imageVersion ? `?v=${encodeURIComponent(imageVersion)}` : "");
  return `
  <!-- aired OG tags -->
  <meta property="og:title" content="${escapeAttr(title)}" />
  <meta property="og:description" content="${OG_DESCRIPTION}" />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="${ogImageUrl}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="${ogImageUrl}" />`;
}

const PDF_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/></svg>`;

/** The download button on a page with no badge (Pro owners). */
export function renderPdfButton(href: string): string {
  return `
<!-- aired pdf -->
<style>
  #__aired-pdf { all: initial; position: fixed; bottom: 14px; right: 14px; z-index: 2147483647; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 8px; box-sizing: border-box; cursor: pointer;
    font: 500 12px/1 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; -webkit-font-smoothing: antialiased; white-space: nowrap;
    background: rgba(255, 255, 255, 0.9); color: rgba(10, 10, 11, 0.78); border: 1px solid rgba(10, 10, 11, 0.12);
    box-shadow: 0 1px 2px rgba(10, 10, 11, 0.06), 0 6px 20px rgba(10, 10, 11, 0.08); backdrop-filter: saturate(160%) blur(14px); -webkit-backdrop-filter: saturate(160%) blur(14px); }
  #__aired-pdf:hover { color: #0a0a0b; }
  #__aired-pdf:focus-visible { outline: 2px solid #7c6aef; outline-offset: 2px; }
  #__aired-pdf svg { width: 13px; height: 13px; flex: none; }
  @media print { #__aired-pdf { display: none; } }
</style>
<a id="__aired-pdf" href="${escapeAttr(href)}" rel="nofollow" aria-label="Download this page as a PDF">${PDF_ICON}<span>Download PDF</span></a>`;
}

export function renderAiredBar({ origin, id, readCount, pdfHref }: AiredBarOptions): string {
  const views = `${readCount.toLocaleString("en-US")} view${readCount !== 1 ? "s" : ""}`;
  return `
<!-- aired badge -->
<style>
  #__aired-bar {
    all: initial;
    position: fixed;
    bottom: 14px;
    right: 14px;
    z-index: 2147483647;
    display: inline-flex;
    align-items: center;
    height: 28px;
    padding: 0 10px 0 8px;
    border-radius: 8px;
    font: 500 12px/1 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    letter-spacing: 0;
    white-space: nowrap;
    -webkit-font-smoothing: antialiased;
    background: rgba(22, 22, 26, 0.82);
    color: rgba(237, 237, 239, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25), 0 6px 20px rgba(0, 0, 0, 0.22);
    backdrop-filter: saturate(160%) blur(14px);
    -webkit-backdrop-filter: saturate(160%) blur(14px);
    transition: background 180ms ease, color 180ms ease, border-color 180ms ease, transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  #__aired-bar.is-light {
    background: rgba(255, 255, 255, 0.86);
    color: rgba(10, 10, 11, 0.62);
    border-color: rgba(10, 10, 11, 0.1);
    box-shadow: 0 1px 2px rgba(10, 10, 11, 0.06), 0 6px 20px rgba(10, 10, 11, 0.08);
  }
  #__aired-bar:hover, #__aired-bar:focus-within, #__aired-bar.is-open { transform: translateY(-1px); color: rgba(237, 237, 239, 0.92); }
  #__aired-bar.is-light:hover, #__aired-bar.is-light:focus-within, #__aired-bar.is-light.is-open { color: rgba(10, 10, 11, 0.85); }
  #__aired-bar a { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; color: inherit; }
  #__aired-bar a:focus-visible { outline: 2px solid #7c6aef; outline-offset: 3px; border-radius: 4px; }
  #__aired-bar svg { width: 12px; height: 12px; flex: none; color: #9d8ff5; }
  #__aired-bar.is-light svg { color: #6d5ce0; }
  #__aired-bar b { font-weight: 600; color: #ededef; }
  #__aired-bar.is-light b { color: #0a0a0b; }
  #__aired-bar .__aired-meta {
    display: inline-flex; align-items: center; gap: 8px;
    max-width: 0; overflow: hidden; opacity: 0; margin-left: 0;
    transition: max-width 260ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 180ms ease, margin 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  #__aired-bar:hover .__aired-meta, #__aired-bar:focus-within .__aired-meta, #__aired-bar.is-open .__aired-meta { max-width: 200px; opacity: 1; margin-left: 8px; }
  #__aired-bar .__aired-sep { width: 1px; height: 10px; background: currentColor; opacity: 0.25; flex: none; }
  #__aired-bar .__aired-views { font-variant-numeric: tabular-nums; }
  #__aired-bar .__aired-report { opacity: 0.8; }
  #__aired-bar .__aired-report:hover { opacity: 1; text-decoration: underline; }
  #__aired-bar .__aired-pdf { gap: 5px; margin-left: 8px; padding-left: 8px; border-left: 1px solid currentColor; border-left-color: rgba(127, 127, 127, 0.35); font-weight: 600; }
  #__aired-bar .__aired-pdf svg { color: inherit; }
  #__aired-bar .__aired-pdf:hover { color: #ededef; }
  #__aired-bar.is-light .__aired-pdf:hover { color: #0a0a0b; }
  @media (prefers-reduced-motion: reduce) { #__aired-bar, #__aired-bar .__aired-meta { transition: none; } }
  @media print { #__aired-bar { display: none; } }
</style>
<div id="__aired-bar" role="complementary" aria-label="Shared with aired">
  <a href="${badgeHref(origin)}" target="_blank" rel="noopener" class="__aired-brand"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="9" cy="23" r="3.5" fill="currentColor"/><path d="M9 13a10 10 0 0 1 10 10M9 6a17 17 0 0 1 17 17" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg><span>Shared with <b>aired</b></span></a>${pdfHref ? `
  <a href="${escapeAttr(pdfHref)}" rel="nofollow" class="__aired-pdf" aria-label="Download this page as a PDF">${PDF_ICON}<span>PDF</span></a>` : ""}
  <span class="__aired-meta">
    <span class="__aired-sep"></span>
    <span class="__aired-views">${views}</span>
    <span class="__aired-sep"></span>
    <a href="${origin}/abuse?id=${encodeURIComponent(id)}" target="_blank" rel="noopener" class="__aired-report">Report</a>
  </span>
</div>
<script>
(function(){
  var bar = document.getElementById('__aired-bar');
  if (!bar) return;

  // Tap to open on touch screens, where there is no hover.
  if (!(window.matchMedia && window.matchMedia('(hover: hover)').matches)) {
    bar.addEventListener('click', function(e){ if (!e.target.closest('a')) bar.classList.toggle('is-open'); });
    document.addEventListener('click', function(e){ if (!bar.contains(e.target)) bar.classList.remove('is-open'); });
  }

  // Match the page behind the badge: light glass on light pages, dark on dark.
  function bgOf(el){
    for (; el && el.nodeType === 1; el = el.parentElement) {
      var c = getComputedStyle(el).backgroundColor;
      var m = c && c.match(/rgba?\\(([^)]+)\\)/);
      if (!m) continue;
      var p = m[1].split(',').map(parseFloat);
      if (p.length < 4 || p[3] > 0.5) return p;
    }
    return null;
  }
  function luminance(p){
    var v = p.slice(0, 3).map(function(x){ x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function check(){
    var r = bar.getBoundingClientRect();
    var x = Math.max(0, r.left - 8), y = Math.min(innerHeight - 1, r.top + r.height / 2);
    var under = null;
    if (document.elementsFromPoint) {
      var hits = document.elementsFromPoint(x, y);
      for (var i = 0; i < hits.length; i++) { if (!bar.contains(hits[i])) { under = hits[i]; break; } }
    }
    var p = bgOf(under) || bgOf(document.body) || bgOf(document.documentElement) || [255, 255, 255];
    bar.classList.toggle('is-light', luminance(p) > 0.4);
  }
  var queued = false;
  function soon(){ if (queued) return; queued = true; requestAnimationFrame(function(){ queued = false; check(); }); }
  check();
  addEventListener('load', soon);
  addEventListener('scroll', soon, { passive: true });
  addEventListener('resize', soon);
})();
</script>`;
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
