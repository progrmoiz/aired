import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { assetCacheControl, withAssetCache } from "../src/lib/asset-cache.ts";

const web = new URL("../../web/", import.meta.url);

test("versioned font files are cached for a year; nothing else is", () => {
  assert.equal(assetCacheControl("/fonts/inter-latin-v20.woff2"), "public, max-age=31536000, immutable");
  assert.equal(assetCacheControl("/fonts/jetbrains-mono-latin-v24.woff2"), "public, max-age=31536000, immutable");
  for (const p of ["/fonts/fonts.css", "/fonts/OFL-Inter.txt", "/fonts/inter.woff2", "/style.css", "/", "/fonts/../x-v1.woff2"]) {
    assert.equal(assetCacheControl(p), null, p);
  }
});

test("every font file is versioned (so the year-long cache is safe) and has its license", () => {
  const files = readdirSync(new URL("fonts/", web));
  const fonts = files.filter((f) => f.endsWith(".woff2"));
  assert.deepEqual(fonts.sort(), ["inter-latin-v20.woff2", "jetbrains-mono-latin-v24.woff2"]);
  for (const f of fonts) assert.ok(assetCacheControl(`/fonts/${f}`), f);
  for (const lic of ["OFL-Inter.txt", "OFL-JetBrainsMono.txt"]) {
    assert.match(readFileSync(new URL(`fonts/${lic}`, web), "utf8"), /SIL Open Font License, Version 1\.1/);
  }
  const css = readFileSync(new URL("fonts/fonts.css", web), "utf8");
  for (const f of fonts) assert.ok(css.includes(`/fonts/${f}`), f);
  assert.equal((css.match(/font-display: swap/g) ?? []).length, 2);
});

test("no page loads anything from Google Fonts, and every page that used it links the local fonts", () => {
  for (const f of readdirSync(web).filter((n) => n.endsWith(".html"))) {
    const html = readFileSync(new URL(f, web), "utf8");
    assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/, f);
    if (html.includes("<head")) {
      assert.match(html, /<link rel="stylesheet" href="\/fonts\/fonts\.css" \/>/, f);
    }
  }
});

test("withAssetCache sets the header on a font's 200 and 304, and leaves everything else alone", async () => {
  const FONT = "/fonts/inter-latin-v20.woff2";
  const ok = withAssetCache(new Response("woff2-bytes", { status: 200, headers: { "Content-Type": "font/woff2", ETag: '"e1"' } }), FONT);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  assert.equal(ok.headers.get("ETag"), '"e1"');
  assert.equal(await ok.text(), "woff2-bytes");

  const revalidated = withAssetCache(new Response(null, { status: 304, headers: { ETag: '"e1"' } }), FONT);
  assert.equal(revalidated.status, 304);
  assert.equal(revalidated.headers.get("Cache-Control"), "public, max-age=31536000, immutable");

  const missing = new Response("not found page", { status: 404, headers: { "Cache-Control": "no-store" } });
  assert.equal(withAssetCache(missing, FONT), missing);
  const css = new Response("body{}", { status: 200 });
  assert.equal(withAssetCache(css, "/style.css"), css);
});
