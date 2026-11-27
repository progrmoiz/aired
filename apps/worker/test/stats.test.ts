import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStats, publicStats } from "../src/lib/stats.ts";
import { mergeViewTotals } from "../src/lib/view-counts.ts";

test("public views are the frozen stats:live totals plus D1's per-country counts", () => {
  const frozen = parseStats(JSON.stringify({ publishes: 4, views: 10, geo: { DE: 6, US: 4 } }));
  assert.deepEqual(mergeViewTotals(frozen, { DE: 1, FR: 2 }), { publishes: 4, views: 13, geo: { DE: 7, US: 4, FR: 2 } });
  assert.deepEqual(mergeViewTotals(frozen, {}), { publishes: 4, views: 10, geo: { DE: 6, US: 4 } });
  // The frozen blob isn't changed.
  assert.deepEqual(frozen.geo, { DE: 6, US: 4 });
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
  // Saving the parsed blob (a publish does) writes it back without the titles.
  assert.ok(!JSON.stringify(stats).includes("Acme"));
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
  parseStats(null).geo.GB = 1;
  assert.deepEqual(parseStats(null), { publishes: 0, views: 0, geo: {} });
});
