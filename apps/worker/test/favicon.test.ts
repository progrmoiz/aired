import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import {
  ICON_MAX_BYTES, MISSING_TTL_MS, findIcon, iconHost, iconLinks, iconSig, iconUrls, readCapped, sanitizeSvg, sniffIcon, validIconHost,
  type Fetcher,
} from "../src/lib/favicon.ts";
import { favicon } from "../src/routes/favicon.ts";

const SECRET = "test-secret-for-favicons-0123456789";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const ICO = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle r="8"/></svg>';

// ─── Hosts ───

test("only public DNS names are fetched: no IPs, localhost or private names", () => {
  for (const ok of ["slack.com", "mail.google.com", "blog.example.co.uk", "xn--bcher-kva.de", "a-b.io"]) assert.equal(validIconHost(ok), true, ok);
  for (const bad of [
    "127.0.0.1", "10.0.0.8", "192.168.1.1", "169.254.169.254", "8.8.8.8", "0x7f.1", "[::1]", "::1", "localhost", "app.localhost",
    "printer.local", "metadata.google.internal", "router.lan", "nas.home.arpa", "site.test", "x.example", "x.invalid", "abc.onion",
    "com", "Slack.com", "a..b.com", "-bad.com", "bad-.com", "has space.com", "evil.com:8080", "evil.com/path", "",
  ]) assert.equal(validIconHost(bad), false, bad);
});

test("redirectors and app ids point at the site people know", () => {
  assert.equal(iconHost("t.co"), "x.com");
  assert.equal(iconHost("lnkd.in"), "linkedin.com");
  assert.equal(iconHost("l.facebook.com"), "facebook.com");
  assert.equal(iconHost("slack-redir.net"), "slack.com");
  assert.equal(iconHost("acme.slack.com"), "slack.com");
  assert.equal(iconHost("com.google.android.gm"), "mail.google.com");
  assert.equal(iconHost("mail.google.com"), "mail.google.com");
  assert.equal(iconHost("chatgpt.com"), "openai.com");
  assert.equal(iconHost("stackoverflow.com"), "stackoverflow.com");
});

test("icon URLs are signed per host, skip direct and anything unfetchable", async () => {
  const urls = await iconUrls(SECRET, ["", "t.co", "x.com", "10.0.0.1", "stackoverflow.com"]);
  assert.deepEqual(Object.keys(urls).sort(), ["stackoverflow.com", "t.co", "x.com"]);
  assert.equal(urls["t.co"], `/api/favicon/x.com?s=${await iconSig(SECRET, "x.com")}`);
  assert.equal(urls["t.co"], urls["x.com"]);
  assert.notEqual(await iconSig(SECRET, "a.com"), await iconSig(SECRET, "b.com"));
  assert.notEqual(await iconSig("other-secret", "a.com"), await iconSig(SECRET, "a.com"));
});

// ─── Bytes ───

test("only real image bytes count, whatever the Content-Type says", () => {
  assert.equal(sniffIcon(PNG), "image/png");
  assert.equal(sniffIcon(ICO), "image/x-icon");
  assert.equal(sniffIcon(new TextEncoder().encode("GIF89a......")), "image/gif");
  assert.equal(sniffIcon(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(sniffIcon(new TextEncoder().encode(SVG)), "image/svg+xml");
  assert.equal(sniffIcon(new TextEncoder().encode('<?xml version="1.0"?><svg/>')), "image/svg+xml");
  assert.equal(sniffIcon(new TextEncoder().encode('<!-- from a repo -->\n<svg xmlns="http://www.w3.org/2000/svg"/>')), "image/svg+xml");
  assert.equal(sniffIcon(new TextEncoder().encode('<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x"><svg/>')), "image/svg+xml");
  assert.equal(sniffIcon(new TextEncoder().encode("<!-- hi --><html><svg></svg></html>")), null);
  assert.equal(sniffIcon(new TextEncoder().encode("<!doctype html><html><svg></svg>")), null);
  assert.equal(sniffIcon(new TextEncoder().encode("%PDF-1.7")), null);
  assert.equal(sniffIcon(new Uint8Array()), null);
});

test("SVGs lose scripts, event handlers and outside links", () => {
  const dirty = '<svg onload="alert(1)"><script>alert(2)</script><a href="https://evil.example/x"><circle r="1" onclick=\'x()\'/></a><use href="#ok"/><image href="data:image/png;base64,AA"/><foreignObject><div/></foreignObject></svg>';
  const clean = sanitizeSvg(dirty);
  assert.doesNotMatch(clean, /script|onload|onclick|evil\.example|foreignObject/i);
  assert.match(clean, /href="#ok"/);
  assert.match(clean, /href="data:image\/png;base64,AA"/);
});

test("the size cap holds whether or not the server says how big it is", async () => {
  const big = new Uint8Array(ICON_MAX_BYTES + 1);
  assert.equal(await readCapped(new Response(big, { headers: { "content-length": String(big.length) } }), ICON_MAX_BYTES), null);
  const stream = new ReadableStream({ start(ctl) { for (let i = 0; i < 11; i++) ctl.enqueue(new Uint8Array(10 * 1024)); ctl.close(); } });
  assert.equal(await readCapped(new Response(stream), ICON_MAX_BYTES), null, "no content-length, too big when streamed");
  assert.equal((await readCapped(new Response(PNG), ICON_MAX_BYTES))!.length, PNG.length);
});

test("icon links: SVG first, then the biggest icon, then Apple touch icons; https only", () => {
  const html = `<head>
    <link rel="apple-touch-icon" href="/apple.png" sizes="180x180">
    <link rel="icon" href="/16.png" sizes="16x16"><link rel="icon" href="/32.png" sizes="32x32">
    <link rel="shortcut icon" href="http://insecure.example/x.ico">
    <link rel="icon" type="image/svg+xml" href="/icon.svg"><link rel="stylesheet" href="/a.css">
    <link rel="icon" href="data:image/png;base64,AA"></head>`;
  assert.deepEqual(iconLinks(html, "https://site.com/"), [
    "https://site.com/icon.svg", "https://site.com/32.png", "https://site.com/16.png", "https://site.com/apple.png",
  ]);
});

/** A fake web: URL → response factory. Records every URL asked for. */
function fakeWeb(pages: Record<string, () => Response>) {
  const asked: string[] = [];
  const fetcher: Fetcher = async (url) => {
    asked.push(url);
    const page = pages[url];
    return page ? page() : new Response("nope", { status: 404 });
  };
  return { asked, fetcher };
}

test("findIcon uses the home page's best icon, then falls back to /favicon.ico", async () => {
  const web = fakeWeb({
    "https://site.com/": () => new Response('<link rel="icon" href="/i.svg" type="image/svg+xml">', { headers: { "content-type": "text/html" } }),
    "https://site.com/i.svg": () => new Response(SVG.replace("<circle", '<circle onclick="x()"')),
  });
  const icon = await findIcon(web.fetcher, "site.com");
  assert.equal(icon!.type, "image/svg+xml");
  assert.doesNotMatch(new TextDecoder().decode(icon!.bytes), /onclick/);

  const ico = fakeWeb({
    "https://plain.com/": () => new Response("<html></html>", { headers: { "content-type": "text/html" } }),
    "https://plain.com/favicon.ico": () => new Response(ICO),
  });
  assert.equal((await findIcon(ico.fetcher, "plain.com"))!.type, "image/x-icon");

  // A big home page: its <head> is still read.
  const bigPage = fakeWeb({
    "https://big.com/": () => new Response('<head><link rel="icon" href="https://cdn.big.com/i.png"></head>' + "x".repeat(800 * 1024), { headers: { "content-type": "text/html" } }),
    "https://cdn.big.com/i.png": () => new Response(PNG),
  });
  assert.equal((await findIcon(bigPage.fetcher, "big.com"))!.type, "image/png");

  const html = fakeWeb({ "https://fake.com/favicon.ico": () => new Response("<!doctype html><p>not an icon</p>") });
  assert.equal(await findIcon(html.fetcher, "fake.com"), null);

  const huge = fakeWeb({ "https://huge.com/favicon.ico": () => new Response(new Uint8Array(ICON_MAX_BYTES + 10).fill(0x89)) });
  assert.equal(await findIcon(huge.fetcher, "huge.com"), null);

  const ip = fakeWeb({});
  assert.equal(await findIcon(ip.fetcher, "127.0.0.1"), null);
  assert.equal(ip.asked.length, 0, "never fetched");
});

// ─── The route ───

type Stored = { bytes: Uint8Array; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> };

function fakeR2() {
  const objects = new Map<string, Stored>();
  return {
    objects,
    async get(key: string) {
      const o = objects.get(key);
      if (!o) return null;
      return { body: new Response(o.bytes).body, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata };
    },
    async put(key: string, bytes: Uint8Array, opts: Omit<Stored, "bytes"> = {}) {
      objects.set(key, { bytes, ...opts });
    },
  };
}

function appFor(uid: number | null) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user" as never, (uid === null ? null : { id: uid, login: "x", email: null, name: null }) as never);
    await next();
  });
  app.route("/api/favicon", favicon as never);
  return app;
}

/** Run with a context whose waitUntil work finishes before we look at R2. */
async function call(app: Hono, path: string, env: Record<string, unknown>) {
  const pending: Promise<unknown>[] = [];
  const res = await app.request(path, {}, env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} } as never);
  await Promise.all(pending);
  return res;
}

function stubFetch(pages: Record<string, () => Response>) {
  const asked: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    asked.push(String(url));
    const page = pages[String(url)];
    return page ? page() : new Response("nope", { status: 404 });
  }) as typeof fetch;
  return { asked, restore: () => { globalThis.fetch = real; } };
}

const url = async (host: string, secret = SECRET) => `/api/favicon/${host}?s=${await iconSig(secret, host)}`;

test("signed out is 401, and a host the caller's report didn't sign is 404 without fetching", async () => {
  const r2 = fakeR2();
  const env = { PAGES_BUCKET: r2, SESSION_SECRET: SECRET };
  const f = stubFetch({});
  try {
    assert.equal((await call(appFor(null), await url("site.com"), env)).status, 401);
    assert.equal((await call(appFor(1), "/api/favicon/site.com", env)).status, 404, "no signature");
    assert.equal((await call(appFor(1), "/api/favicon/site.com?s=AAAAAAAAAAAAAAAAAAAAAA", env)).status, 404, "forged");
    assert.equal((await call(appFor(1), await url("site.com", "someone-elses-secret"), env)).status, 404, "other secret");
    assert.equal((await call(appFor(1), await url("10.0.0.1"), env)).status, 404, "signed but private");
    assert.equal((await call(appFor(1), await url("localhost"), env)).status, 404);
    assert.equal(f.asked.length, 0);
  } finally {
    f.restore();
  }
});

test("a miss fetches once, stores the icon, and serves it as an image only", async () => {
  const r2 = fakeR2();
  const env = { PAGES_BUCKET: r2, SESSION_SECRET: SECRET };
  const f = stubFetch({ "https://site.com/favicon.ico": () => new Response(PNG, { headers: { "content-type": "text/html" } }) });
  try {
    const res = await call(appFor(1), await url("site.com"), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png", "sniffed, not the server's label");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("content-security-policy")!, /default-src 'none'.*sandbox/);
    assert.match(res.headers.get("cache-control")!, /max-age=604800/);
    assert.equal(r2.objects.get("favicons/site.com")!.httpMetadata!.contentType, "image/png");
    const asked = f.asked.length;
    const again = await call(appFor(2), await url("site.com"), env);
    assert.equal(again.status, 200);
    assert.deepEqual(new Uint8Array(await again.arrayBuffer()), PNG);
    assert.equal(f.asked.length, asked, "served from R2, not fetched again");
  } finally {
    f.restore();
  }
});

test("a site with no icon is remembered for 7 days, then asked again", async () => {
  const r2 = fakeR2();
  const env = { PAGES_BUCKET: r2, SESSION_SECRET: SECRET };
  const f = stubFetch({});
  try {
    assert.equal((await call(appFor(1), await url("bare.com"), env)).status, 404);
    const marker = r2.objects.get("favicons/bare.com")!;
    assert.ok(Number(marker.customMetadata!.missing) > 0);
    const asked = f.asked.length;
    assert.ok(asked > 0);
    assert.equal((await call(appFor(1), await url("bare.com"), env)).status, 404);
    assert.equal(f.asked.length, asked, "the marker stops a second fetch");
    marker.customMetadata!.missing = String(Date.now() - MISSING_TTL_MS - 1000);
    await call(appFor(1), await url("bare.com"), env);
    assert.ok(f.asked.length > asked, "after 7 days it tries again");
  } finally {
    f.restore();
  }
});

test("misses are rate-limited per account", async () => {
  const r2 = fakeR2();
  const keys: string[] = [];
  const env = { PAGES_BUCKET: r2, SESSION_SECRET: SECRET, FAVICON_BURST: { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: false }; } } };
  const f = stubFetch({ "https://site.com/favicon.ico": () => new Response(PNG) });
  try {
    const res = await call(appFor(7), await url("site.com"), env);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(keys, ["7"]);
    assert.equal(f.asked.length, 0);
    assert.equal(r2.objects.size, 0, "nothing stored, so it's tried again later");
  } finally {
    f.restore();
  }
});

test("the burst limit is bound, and the dashboard never asks a favicon service", () => {
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /name = "FAVICON_BURST"\s*\nnamespace_id = "1007"\s*\nsimple = \{ limit = 30, period = 60 \}/);
  const lib = readFileSync(new URL("../src/lib/favicon.ts", import.meta.url), "utf8");
  assert.doesNotMatch(lib, /google\.com\/s2|gstatic|icons\.duckduckgo|favicone|icon\.horse/i);
});
