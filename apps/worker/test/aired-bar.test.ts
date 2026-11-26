import { test } from "node:test";
import assert from "node:assert/strict";
import { injectAiredBar, badgeHref, OG_DESCRIPTION } from "../src/lib/aired-bar.ts";

const opts = { origin: "https://aired.sh", id: "abc123", title: "Q3 report", readCount: 1284 };
const BADGE_HREF = badgeHref(opts.origin);

test("badge says Shared with aired and links home with a ref tag", () => {
  const out = injectAiredBar("<html><head></head><body><p>hi</p></body></html>", opts);
  assert.match(out, /Shared with <b>aired<\/b>/);
  assert.ok(out.includes(`href="${BADGE_HREF}"`));
  assert.ok(BADGE_HREF.includes("ref=badge"));
  assert.ok(out.includes("1,284 views"));
  assert.ok(out.includes("https://aired.sh/abuse?id=abc123"));
});

test("badge goes before </body> and OG tags before </head>", () => {
  const out = injectAiredBar("<html><head><title>x</title></head><body><p>hi</p></body></html>", opts);
  assert.ok(out.indexOf("aired OG tags") < out.indexOf("</head>"));
  assert.ok(out.indexOf('id="__aired-bar"') > out.indexOf("<p>hi</p>"));
  assert.ok(out.indexOf('id="__aired-bar"') < out.indexOf("</body>"));
  assert.ok(out.includes(`content="${OG_DESCRIPTION}"`));
});

test("works on fragments with no head or body", () => {
  const out = injectAiredBar("<h1>Hello</h1>", opts);
  assert.ok(out.startsWith("\n  <!-- aired OG tags -->"));
  assert.ok(out.trimEnd().endsWith("</script>"));
});

test("title and id are escaped", () => {
  const out = injectAiredBar("<head></head><body></body>", { origin: "https://aired.sh", id: 'a"b', title: '"><script>x</script>', readCount: 1 });
  assert.ok(!out.includes('"><script>x</script>'));
  assert.ok(out.includes("1 view<"));
  assert.ok(out.includes("og/a%22b"));
});

test("badge adapts to light pages", () => {
  const out = injectAiredBar("<body></body>", opts);
  assert.ok(out.includes("#__aired-bar.is-light"));
  assert.ok(out.includes("classList.toggle('is-light'"));
  // the regex inside the script must survive the template literal
  assert.ok(out.includes("rgba?\\(([^)]+)\\)"));
});

test("badge: false keeps the OG tags but drops all badge markup", () => {
  const out = injectAiredBar("<html><head></head><body><p>hi</p></body></html>", { ...opts, badge: false });
  assert.ok(out.includes("og:title"));
  assert.ok(out.includes('content="Q3 report"'));
  assert.ok(!out.includes("__aired-bar"));
  assert.ok(!out.includes("aired badge"));
  assert.ok(!out.includes("<script>"));
  assert.ok(!out.includes("<style>"));
  assert.ok(out.endsWith("<p>hi</p></body></html>"));
});

test("badge shows by default and with badge: true", () => {
  const html = "<html><head></head><body></body></html>";
  assert.ok(injectAiredBar(html, opts).includes('id="__aired-bar"'));
  assert.ok(injectAiredBar(html, { ...opts, badge: true }).includes('id="__aired-bar"'));
});

test("the badge, report link and OG image follow the deploy's origin", () => {
  const out = injectAiredBar("<head></head><body></body>", { ...opts, origin: "https://staging.aired.sh" });
  assert.ok(out.includes('href="https://staging.aired.sh/?ref=badge"'));
  assert.ok(out.includes("https://staging.aired.sh/abuse?id=abc123"));
  assert.ok(out.includes('content="https://staging.aired.sh/og/abc123"'));
  assert.ok(!out.includes("https://aired.sh"));
});
