import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { guideMarkdown, GUIDES } from "../scripts/guide-md.ts";
import {
  SITE_EVENT_ITEMS,
  SITE_EVENT_PAGES,
  parseSiteEvent,
  siteEventPoint,
  siteEventQuery,
} from "../src/lib/site-event.ts";

const web = (f: string) => readFileSync(new URL(`../../web/${f}`, import.meta.url), "utf8");

test("every guide's Markdown copy matches its page (run node --experimental-strip-types apps/worker/scripts/guide-md.ts)", () => {
  for (const slug of GUIDES) {
    assert.equal(web(`${slug}.md`), guideMarkdown(web(`${slug}.html`), slug), `${slug}.md is out of date`);
  }
});

test("a guide's Markdown keeps its headings, steps, tables, code and FAQ, with absolute links", () => {
  const md = guideMarkdown(web("password-protect-html.html"), "password-protect-html");
  assert.match(md, /^# Password-protect an HTML page\n/);
  assert.match(md, /\nSource: https:\/\/aired\.sh\/password-protect-html\n/);
  assert.match(md, /\n## How to put a password on an HTML page\n/);
  assert.match(md, /\n1\. \*\*Add the page\.\*\* /);
  assert.match(md, /\n\| Method \| Really hides the page \| Setup \| Cost \|\n\| --- \| --- \| --- \| --- \|\n/);
  assert.match(md, /\n## Questions\n\n### [^\n]+\?\n\n[^\n]+/);
  assert.doesNotMatch(md, /<[a-z][^>]*>/i, "no HTML tags left");
  assert.doesNotMatch(md, /\]\(\//, "links are absolute");
  const vite = guideMarkdown(web("share-vite-app.html"), "share-vite-app");
  assert.match(vite, /\n```\n[\s\S]+?\n```\n/, "code blocks are fenced");
});

test("every guide and the docs carry the agent menu, and guides point at their Markdown copy", () => {
  for (const slug of GUIDES) {
    const html = web(`${slug}.html`);
    assert.match(html, new RegExp(`data-agent="${slug}"`), `${slug} has no agent menu`);
    assert.match(html, /data-task="[^"]{10,}"/, `${slug} menu has no task`);
    assert.ok(html.includes(`<link rel="alternate" type="text/markdown" href="/${slug}.md" />`), `${slug} has no Markdown link`);
  }
  assert.match(web("docs.html"), /data-agent="docs" data-md="\/llms-full\.txt"/);
  assert.deepEqual([...SITE_EVENT_PAGES].sort(), [...GUIDES, "docs"].sort());
});

test("the menu only reports items the endpoint accepts", () => {
  const js = web("app.js");
  const used = [...js.matchAll(/(?:item: |track\(page, )"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(used.length >= 8, "app.js names its menu items");
  for (const item of used) assert.ok((SITE_EVENT_ITEMS as readonly string[]).includes(item), item);
});

test("a site event is a known page and a known item, nothing else", () => {
  assert.deepEqual(parseSiteEvent({ page: "share-slides", item: "codex" }), { ok: true, page: "share-slides", item: "codex" });
  for (const bad of [null, "x", {}, { page: "share-slides" }, { page: "nope", item: "codex" }, { page: "docs", item: "rm -rf" }, { page: 1, item: 2 }]) {
    assert.equal(parseSiteEvent(bad).ok, false, JSON.stringify(bad));
  }
});

test("the data point holds the page, the item and the day only", () => {
  const p = siteEventPoint("docs", "cursor", Date.parse("2026-11-27T23:59:00Z"));
  assert.deepEqual(p, { indexes: ["docs"], blobs: ["docs", "cursor", "2026-11-27"], doubles: [1] });
});

test("the count query reads the site events dataset for a bounded number of days", () => {
  const sql = siteEventQuery(30);
  assert.match(sql, /FROM aired_site_events/);
  assert.match(sql, /INTERVAL '30' DAY/);
  assert.match(sql, /GROUP BY page, item/);
  assert.throws(() => siteEventQuery(0));
  assert.throws(() => siteEventQuery(91));
});

test("POST /api/site-event writes one data point for a known click and refuses the rest", async () => {
  await import("./helpers/worker-loader.ts");
  const { Hono } = await import("hono");
  const { siteEvent } = await import("../src/routes/site-event.ts");
  const points: unknown[] = [];
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("user" as never, null as never); await next(); });
  app.route("/api", siteEvent);
  const env = { SITE_EVENTS: { writeDataPoint: (p: unknown) => points.push(p) } };
  const post = (body: string) =>
    app.fetch(new Request("https://aired.sh/api/site-event", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" }, body }), env as never);

  const ok = await post(JSON.stringify({ page: "share-vite-app", item: "codex" }));
  assert.equal(ok.status, 204);
  assert.equal(points.length, 1);
  assert.deepEqual((points[0] as { blobs: string[] }).blobs.slice(0, 2), ["share-vite-app", "codex"]);

  assert.equal((await post(JSON.stringify({ page: "share-vite-app", item: "steal" }))).status, 400);
  assert.equal((await post("not json")).status, 400);
  assert.equal(points.length, 1, "refused clicks write nothing");
});
