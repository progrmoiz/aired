import { test } from "node:test";
import assert from "node:assert/strict";
import { notFoundPage } from "../src/lib/not-found.ts";

function fakeAssets(handler: (url: string) => Response | Promise<Response>): Fetcher {
  return { fetch: (input: RequestInfo | URL) => Promise.resolve(handler(String(input))) } as unknown as Fetcher;
}

test("notFoundPage serves the site 404 page with a 404 status", async () => {
  let asked = "";
  const assets = fakeAssets((url) => {
    asked = url;
    return new Response("<h1>This page isn't here</h1>", { status: 200 });
  });
  const res = await notFoundPage(assets, "https://aired.sh/p/gone123");
  assert.equal(asked, "https://aired.sh/404");
  assert.equal(res.status, 404);
  assert.match(res.headers.get("Content-Type") ?? "", /text\/html/);
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex");
  assert.match(await res.text(), /This page isn't here/);
});

test("notFoundPage keeps the body when assets answer 404 themselves", async () => {
  const assets = fakeAssets(() => new Response("<h1>404 page</h1>", { status: 404 }));
  const res = await notFoundPage(assets, "https://aired.sh/p/x");
  assert.equal(res.status, 404);
  assert.match(await res.text(), /404 page/);
});

test("notFoundPage falls back to text without assets or when they fail", async () => {
  const none = await notFoundPage(undefined, "https://aired.sh/p/x");
  assert.equal(none.status, 404);
  assert.equal(await none.text(), "Page not found");

  const broken = fakeAssets(() => { throw new Error("down"); });
  const res = await notFoundPage(broken, "https://aired.sh/p/x", "Page content not found");
  assert.equal(res.status, 404);
  assert.equal(await res.text(), "Page content not found");

  const redirect = fakeAssets(() => new Response(null, { status: 307, headers: { Location: "/" } }));
  const r2 = await notFoundPage(redirect, "https://aired.sh/p/x");
  assert.equal(r2.status, 404);
  assert.equal(await r2.text(), "Page not found");
});
