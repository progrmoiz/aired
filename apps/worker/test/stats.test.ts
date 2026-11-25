import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStats, publicStats, recordView } from "../src/lib/stats.ts";

test("a view records the count and country, nothing about the page", () => {
  const stats = recordView(parseStats(null), "DE");
  assert.deepEqual(stats, { publishes: 0, views: 1, geo: { DE: 1 } });
  recordView(stats, "DE");
  assert.deepEqual(stats.geo, { DE: 2 });
});

test("titles left in an old stats blob are dropped on load", () => {
  const old = JSON.stringify({
    publishes: 5,
    views: 9,
    geo: { US: 9 },
    recent: [{ title: "Acme Corp proposal (PIN)", country: "US", ts: 1 }],
  });
  const stats = parseStats(old);
  assert.deepEqual(stats, { publishes: 5, views: 9, geo: { US: 9 } });
  // Saving the parsed blob writes it back without the titles.
  assert.ok(!JSON.stringify(recordView(stats, "US")).includes("Acme"));
});

test("the public stats body has no page list", () => {
  const body = publicStats(parseStats(JSON.stringify({
    publishes: 1,
    views: 2,
    geo: { FR: 2 },
    recent: [{ title: "Private client deck", country: "FR", ts: 1 }],
  })));
  assert.deepEqual(Object.keys(body).sort(), ["geo", "publishes", "views"]);
  assert.ok(!JSON.stringify(body).includes("Private client deck"));
});

test("an empty blob starts fresh each time instead of sharing state", () => {
  recordView(parseStats(null), "GB");
  assert.deepEqual(parseStats(null), { publishes: 0, views: 0, geo: {} });
});
