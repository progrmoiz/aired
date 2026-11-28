import { setupApi as setup, errorOf } from "./helpers/api-app.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

// Error shape, JSON 404s and 413s: api-errors.test.ts.

const publish = async (s: ReturnType<typeof setup>, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) => {
  const res = await s.post("/api/publish", { html: "<h1>Hello</h1>", ...body }, headers);
  return { res, body: (await res.json()) as Record<string, unknown> };
};

test("publish: bad JSON, no html and a non-object body are 400s with codes", async () => {
  const s = setup();
  const bad = await s.post("/api/publish", "{nope");
  assert.equal(bad.status, 400);
  assert.equal((await errorOf(bad)).code, "invalid_json");

  const noHtml = await s.post("/api/publish", { title: "x" });
  assert.equal(noHtml.status, 400);
  assert.deepEqual(await errorOf(noHtml), { code: "invalid_input", message: "html is required and must be a string", field: "html" });

  const arr = await s.post("/api/publish", [1]);
  assert.deepEqual(await errorOf(arr), { code: "invalid_input", message: "Request body must be a JSON object" });
});

test("publish: ttl 1e20 or Infinity is a 400, not a 500", async () => {
  const s = setup();
  const huge = await s.post("/api/publish", { html: "<p>x</p>", ttl: 1e20 });
  assert.equal(huge.status, 400);
  const body = await errorOf(huge);
  assert.equal(body.code, "invalid_input");
  assert.equal(body.field, "ttl");
  // JSON.parse turns 1e400 into Infinity.
  const inf = await s.post("/api/publish", '{"html":"<p>x</p>","ttl":1e400}');
  assert.equal(inf.status, 400);
  // A year is still fine.
  const year = await publish(s, { ttl: 365 * 24 * 3600 });
  assert.equal(year.res.status, 200);
});

test("publish: a PIN over 64 characters and a view limit over a million are refused", async () => {
  const s = setup();
  const pin = await s.post("/api/publish", { html: "<p>x</p>", pin: "1".repeat(65) });
  assert.equal(pin.status, 400);
  assert.equal((await errorOf(pin)).field, "pin");
  const reads = await s.post("/api/publish", { html: "<p>x</p>", reads: 1e9 });
  assert.equal(reads.status, 400);
});

test("publish: a wrong-typed field is still ignored, as before", async () => {
  const s = setup();
  const { res, body } = await publish(s, { title: 5, pin: 1234, ttl: "soon" });
  assert.equal(res.status, 200);
  const meta = (await (await s.call(`/api/pages/${body.id}`)).json()) as Record<string, unknown>;
  assert.equal(meta.pinProtected, false);
  assert.equal(meta.title, null);
});

test("publish: a long title is cut to 200 characters", async () => {
  const s = setup();
  const { body } = await publish(s, { title: "t".repeat(500) });
  const meta = (await (await s.call(`/api/pages/${body.id}`)).json()) as { title: string };
  assert.equal(meta.title.length, 200);
  // A <title> from the HTML is cut the same way.
  const fromHtml = await publish(s, { html: `<title>${"h".repeat(300)}</title>` });
  const meta2 = (await (await s.call(`/api/pages/${fromHtml.body.id}`)).json()) as { title: string };
  assert.equal(meta2.title.length, 200);
});

test("PUT and DELETE agree: no credential is 401, someone else's page is 403, a wrong token is 403", async () => {
  const s = setup();
  const { body: page } = await publish(s);
  const id = String(page.id);
  const put = (headers: Record<string, string> = {}, extra: Record<string, unknown> = {}) =>
    s.post(`/api/pages/${id}`, { html: "<p>new</p>", ...extra }, headers, "PUT");
  const del = (headers: Record<string, string> = {}) => s.call(`/api/pages/${id}`, { method: "DELETE", headers });
  const codeOf = async (r: Response) => [r.status, (await errorOf(r)).code];

  assert.deepEqual(await codeOf(await put()), [401, "token_required"]);
  assert.deepEqual(await codeOf(await del()), [401, "token_required"]);
  assert.deepEqual(await codeOf(await put({ "X-Test-User": "8" })), [403, "not_owner"]);
  assert.deepEqual(await codeOf(await del({ "X-Test-User": "8" })), [403, "not_owner"]);
  assert.deepEqual(await codeOf(await put({}, { update_token: "at_wrong" })), [403, "invalid_token"]);
  assert.deepEqual(await codeOf(await del({ Authorization: "Bearer at_wrong" })), [403, "invalid_token"]);

  // The right token still works for both.
  assert.equal((await put({}, { update_token: page.update_token })).status, 200);
  assert.equal((await del({ Authorization: `Bearer ${page.update_token}` })).status, 200);
});

test("CSRF: a request carrying the session cookie needs X-Aired-Request on every /api write, publish included", async () => {
  const s = setup();
  const cookie = { Cookie: "aired_session=abc" };
  const blocked = await s.post("/api/publish", { html: "<p>x</p>" }, cookie);
  assert.equal(blocked.status, 403);
  assert.equal((await errorOf(blocked)).code, "forbidden");
  const report = await s.post("/api/report", { id: "x", reason: "spam" }, cookie);
  assert.equal(report.status, 403);
  // With the header, or without the cookie (CLI, agents), it goes through.
  assert.equal((await s.post("/api/publish", { html: "<p>x</p>" }, { ...cookie, "X-Aired-Request": "1" })).status, 200);
  assert.equal((await s.post("/api/publish", { html: "<p>x</p>" })).status, 200);
  // Reads never need it.
  assert.equal((await s.call("/api/stats", { headers: cookie })).status, 200);
});

test("anonymous publishes are counted in D1 and the sixth in an hour is a 429", async () => {
  const s = setup();
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push((await publish(s, {}, { "CF-Connecting-IP": "198.51.100.77" })).res.status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  const rows = s.raw.prepare("SELECT bucket, count FROM rate_limits WHERE bucket LIKE 'rl:ip:%'").all() as Array<{ count: number }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.count, 5);
  const last = await publish(s, {}, { "CF-Connecting-IP": "198.51.100.77" });
  assert.equal((last.body.error as { code: string }).code, "rate_limited");
});

test("a PIN-protected page's public metadata hides its title and views", async () => {
  const s = setup();
  const { body } = await publish(s, { title: "Salary review", pin: "4821" });
  const res = await s.call(`/api/pages/${body.id}`);
  assert.equal(res.status, 200);
  const meta = (await res.json()) as Record<string, unknown>;
  assert.equal(meta.title, null);
  assert.equal(meta.readCount, 0);
  assert.equal(meta.pinProtected, true);
  assert.equal(meta.id, body.id);

  const open = await publish(s, { title: "Open page" });
  const openMeta = (await (await s.call(`/api/pages/${open.body.id}`)).json()) as Record<string, unknown>;
  assert.equal(openMeta.title, "Open page");
  assert.equal(openMeta.pinProtected, false);
});
