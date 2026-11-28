import { setupApi, errorOf } from "./helpers/api-app.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

const { BODY_LIMIT_BYTES } = await import("../src/lib/input-limits.ts");
const { legacyErrorClient } = await import("../src/lib/errors.ts");

const legacyRoutes = (app: { get: (p: string, h: (c: any) => Response) => void }) => {
  app.get("/api/legacy-conflict", (c) => c.json({ error: "Already there" }, 409));
  app.get("/api/legacy-pending", (c) => c.json({ error: "authorization_pending" }, 400));
};

test("an unknown /api path answers a JSON 404 in the error shape", async () => {
  const s = setupApi();
  const res = await s.call("/api/nope");
  assert.equal(res.status, 404);
  assert.match(res.headers.get("Content-Type") ?? "", /application\/json/);
  assert.deepEqual(await res.json(), { error: { code: "not_found", message: "No API route matches GET /api/nope." } });
  // Deeper unknown paths and /api itself too; site paths keep the HTML 404.
  assert.equal((await errorOf(await s.call("/api/pages/x/y/z"))).code, "not_found");
  assert.equal((await errorOf(await s.call("/api"))).code, "not_found");
  assert.equal(await (await s.call("/elsewhere")).text(), "site 404");
});

test("a known /api path with the wrong method is a JSON 405 naming the methods it takes", async () => {
  const s = setupApi();
  const res = await s.call("/api/publish");
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("Allow"), "POST");
  assert.deepEqual(await errorOf(res), { code: "method_not_allowed", message: "GET isn't allowed on /api/publish. Use POST." });
  const page = await s.call("/api/pages/abc", { method: "POST" });
  assert.equal(page.status, 405);
  assert.deepEqual(page.headers.get("Allow")?.split(", ").sort(), ["DELETE", "GET", "PATCH", "PUT"]);
});

test("route errors, auth errors and older { error } answers all come out as { error: { code, message } }", async () => {
  const s = setupApi({ routes: legacyRoutes });
  assert.deepEqual(await (await s.call("/api/stats", { headers: { "X-Test-Bad-Key": "1" } })).json(), {
    error: { code: "unauthorized", message: "Invalid or revoked API key" },
  });
  assert.deepEqual(await (await s.call("/api/legacy-conflict")).json(), { error: { code: "conflict", message: "Already there" } });
  assert.deepEqual(await (await s.call("/api/legacy-pending")).json(), { error: { code: "authorization_pending", message: "authorization_pending" } });
  // Extra fields go inside the error object.
  const noHtml = await s.post("/api/publish", { title: "x" });
  assert.equal(noHtml.status, 400);
  assert.deepEqual(await noHtml.json(), { error: { code: "invalid_input", message: "html is required and must be a string", field: "html" } });
  const bad = await s.post("/api/publish", "{nope");
  assert.deepEqual(await errorOf(bad), { code: "invalid_json", message: "The request body isn't valid JSON." });
});

test("CLI and stdio MCP builds up to 1.10.0 keep getting the flat { error, code } they read", async () => {
  const s = setupApi();
  for (const ua of ["aired/1.2.0", "aired/1.10.0", "aired-mcp/1.4.0", "aired/0.0.0-dev"]) {
    const res = await s.post("/api/publish", { title: "x" }, { "User-Agent": ua });
    assert.equal(res.status, 400, ua);
    assert.deepEqual(await res.json(), { error: "html is required and must be a string", code: "invalid_input", field: "html" }, ua);
  }
  const notFound = await s.call("/api/nope", { headers: { "User-Agent": "aired/1.9.3" } });
  assert.deepEqual(await notFound.json(), { error: "No API route matches GET /api/nope.", code: "not_found" });
  // Newer builds, browsers, curl and the in-process MCP get the new shape.
  for (const ua of ["aired/1.10.1", "aired/1.11.0", "aired-mcp/2.0.0", "aired-mcp", "curl/8.4.0", "Mozilla/5.0"]) {
    const res = await s.post("/api/publish", { title: "x" }, { "User-Agent": ua });
    assert.equal(typeof ((await res.json()) as { error: unknown }).error, "object", ua);
  }
});

test("legacyErrorClient reads the version out of the User-Agent", () => {
  assert.equal(legacyErrorClient("aired/1.2.0"), true);
  assert.equal(legacyErrorClient("aired/1.10.0 (darwin)"), true);
  assert.equal(legacyErrorClient("aired-mcp/1.10.0"), true);
  assert.equal(legacyErrorClient("aired/1.10.1"), false);
  assert.equal(legacyErrorClient("aired/2.0.0"), false);
  assert.equal(legacyErrorClient("aired-mcp"), false);
  assert.equal(legacyErrorClient("aired-mcp/dev"), false);
  assert.equal(legacyErrorClient("airedx/1.0.0"), false);
  assert.equal(legacyErrorClient(undefined), false);
});

test("bodies over the limit are a 413 in the error shape, with or without Content-Length", async () => {
  const s = setupApi();
  const big = JSON.stringify({ message: "x".repeat(BODY_LIMIT_BYTES) });
  const declared = await s.post("/api/feedback", big, { "Content-Length": String(big.length) });
  assert.equal(declared.status, 413);
  assert.deepEqual(await declared.json(), { error: { code: "payload_too_large", message: "Request body too large: the limit is 1 MB." } });
  const streamed = await s.post("/api/feedback", big);
  assert.equal(streamed.status, 413);
  assert.equal((await errorOf(streamed)).code, "payload_too_large");
  // Every write route under /api is capped, the account routes included.
  for (const [method, path] of [["POST", "/api/me/claim"], ["DELETE", "/api/me/keys/k1"], ["PATCH", "/api/pages/abc/responses"], ["POST", "/api/site-event"]] as const) {
    const res = await s.post(path, big, { "X-Test-User": "4", "Content-Length": String(big.length) }, method);
    assert.equal(res.status, 413, `${method} ${path}`);
  }
});

test("writes outside /api are capped too (the PIN form, the sign-in consent form)", async () => {
  const s = setupApi({
    routes: (app) => {
      app.post("/p/:id", async (c: any) => c.json({ length: (await c.req.text()).length }));
      app.post("/authorize", async (c: any) => c.json({ length: (await c.req.text()).length }));
    },
  });
  const big = "x".repeat(BODY_LIMIT_BYTES + 1);
  for (const path of ["/p/abc", "/authorize"]) {
    const res = await s.call(path, { method: "POST", body: big, headers: { "Content-Length": String(big.length) } });
    assert.equal(res.status, 413, path);
  }
  assert.equal((await s.call("/p/abc", { method: "POST", body: "pin=1234" })).status, 200);
});
