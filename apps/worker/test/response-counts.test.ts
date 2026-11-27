import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeD1 } from "./helpers/d1.ts";

const { responseCounts } = await import("../src/lib/collect-store.ts");

function addResponse(db: D1Database, id: string, pageId: string) {
  return db
    .prepare("INSERT INTO responses (id, page_id, owner_id, viewer, entry_key, data, size, created_at, updated_at, expires_at) VALUES (?, ?, 1, 'v', NULL, '{}', 2, 1, 1, NULL)")
    .bind(id, pageId)
    .run();
}

test("responseCounts counts each page's stored responses and leaves out pages with none", async () => {
  const { db } = fakeD1();
  await addResponse(db, "r1", "a");
  await addResponse(db, "r2", "a");
  await addResponse(db, "r3", "b");
  const counts = await responseCounts(db, ["a", "b", "c"]);
  assert.equal(counts.get("a"), 2);
  assert.equal(counts.get("b"), 1);
  assert.equal(counts.has("c"), false);
});

test("responseCounts splits long lists under D1's 100-parameter cap", async () => {
  const { db } = fakeD1();
  await addResponse(db, "r1", "p149");
  const ids = Array.from({ length: 150 }, (_, i) => `p${i}`);
  const counts = await responseCounts(db, ids);
  assert.equal(counts.get("p149"), 1);
  assert.equal(counts.size, 1);
});

test("responseCounts with no pages makes no query", async () => {
  const d1 = fakeD1();
  d1.fail(/./);
  const db = d1.db;
  assert.equal((await responseCounts(db, [])).size, 0);
});

test("me.ts: the page list carries a response count and survives a failed lookup", () => {
  const code = readFileSync(new URL("../src/routes/me.ts", import.meta.url), "utf8");
  const start = code.indexOf("me.get('/pages',");
  assert.ok(start > 0, "route exists");
  const body = code.slice(start, code.indexOf("\n});", start));
  assert.match(body, /responses: 0,/);
  assert.match(body, /responseCounts\(c\.env\.DB/);
  // Best-effort: the read is wrapped so a D1 error can't fail the list.
  assert.match(body, /try \{\s*const counts = await responseCounts/);
});
