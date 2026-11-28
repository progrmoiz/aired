import { setupApi } from "./helpers/api-app.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { apiRoutes } = await import("../src/routes/api-table.ts");
const { specRoutes, INTERNAL_ROUTES, openApiDocument } = await import("../src/lib/openapi.ts");

const routeKeys = () => apiRoutes().map((r) => `${r.method} ${r.path}`);

test("every /api route has an OpenAPI entry or is listed as internal, with a reason", () => {
  const spec = new Set(specRoutes());
  const missing = routeKeys().filter((k) => !spec.has(k) && !(k in INTERNAL_ROUTES));
  assert.deepEqual(missing, [], "add these to lib/openapi.ts (OPERATIONS), or to INTERNAL_ROUTES with why");
  for (const [k, why] of Object.entries(INTERNAL_ROUTES)) {
    assert.ok(why.length > 10, `${k} needs a reason`);
    assert.ok(!spec.has(k), `${k} is both in the spec and internal`);
  }
});

test("every OpenAPI entry, and every internal one, is a real route", () => {
  const routes = new Set(routeKeys());
  const stale = [...specRoutes(), ...Object.keys(INTERNAL_ROUTES)].filter((k) => !routes.has(k));
  assert.deepEqual(stale, [], "these have no route any more: remove them from lib/openapi.ts");
});

test("index.ts mounts /api routers only through the route table", () => {
  const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(index, /app\.route\(\s*["'`]\/api/);
  assert.doesNotMatch(index, /app\.(get|post|put|patch|delete|on|all)\(\s*(\[[^\]]*\],\s*)?["'`]\/api/);
  assert.match(index, /^mountApi\(app\);$/m);
  assert.match(index, /^mountMixed\(app\);$/m);
});

test("GET /api/openapi.json serves an OpenAPI 3.1 document whose references resolve", async () => {
  const s = setupApi();
  const res = await s.call("/api/openapi.json");
  assert.equal(res.status, 200);
  const doc = (await res.json()) as Record<string, any>;
  assert.equal(doc.openapi, "3.1.0");
  assert.equal(doc.servers[0].url, "https://aired.sh");
  assert.ok(doc.paths["/api/publish"].post);
  assert.ok(doc.paths["/api/pages/{id}"].put);
  assert.ok(doc.paths["/api/pages/{id}/versions/{n}/restore"].post.parameters.some((p: { name: string }) => p.name === "n"));
  const params = doc.paths["/api/publish"].post.parameters as Array<{ name: string; in: string }>;
  assert.ok(params.some((p) => p.name === "Idempotency-Key" && p.in === "header"));
  // Every $ref points at something, and operation ids are unique.
  const text = JSON.stringify(doc);
  for (const [, refPath] of text.matchAll(/"\$ref":"#\/([^"]+)"/g)) {
    let node: any = doc;
    for (const part of refPath!.split("/")) node = node?.[part];
    assert.ok(node !== undefined, refPath);
  }
  const ids = Object.values(doc.paths).flatMap((p: any) => Object.values(p).map((o: any) => o.operationId));
  assert.equal(new Set(ids).size, ids.length);
  // The error schema is the shape the API answers.
  assert.deepEqual(doc.components.schemas.Error.required, ["error"]);
  assert.deepEqual(doc.components.schemas.Error.properties.error.required, ["code", "message"]);
});

test("the docs link the OpenAPI document", () => {
  const docs = readFileSync(new URL("../../web/docs.html", import.meta.url), "utf8");
  assert.match(docs, /href="\/api\/openapi\.json"/);
  assert.equal(openApiDocument("https://x.test").servers instanceof Array, true);
});
