import { test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers/hosted-mcp.ts";

// The agent work loop end to end, on the real API and the hosted MCP server:
// list your pages (aired list, list_pages), pull one's source (aired pull,
// get_page include_source), edit, update, and see it listed as updated.

const kim = { "X-Test-User": "7" };
const ana = { "X-Test-User": "8" };

test("list, pull, update: the source comes back as published, and the list shows when it changed", async () => {
  const s = setup();
  const md = "---\ntype: deck\n---\n# One\n\n---\n\n# Two\n\nNote: say hi\n";
  const pub = await s.send("POST", "/api/publish", { markdown: md, project: "q4" }, kim);
  assert.equal(pub.status, 200);
  const id = String(pub.body.id);

  // aired list: the account's pages with their last change.
  const list = await s.get("/api/me/pages?limit=5&project=q4", kim);
  assert.equal(list.status, 200);
  const row = (list.body.pages as Array<Record<string, any>>).find((p) => p.id === id)!;
  assert.equal(typeof row.updatedAt, "string");
  const first = Date.parse(row.updatedAt);
  // Someone else's account doesn't list it.
  assert.ok(!((await s.get("/api/me/pages", ana)).body.pages as Array<{ id: string }>).some((p) => p.id === id));

  // aired pull: the Markdown as published, with the deck's notes, and the live version.
  const src = await s.get(`/api/pages/${id}/source`, kim);
  assert.equal(src.status, 200);
  assert.deepEqual([src.body.format, src.body.kind, src.body.source, src.body.version], ["markdown", "deck", md, 1]);
  assert.equal((await s.get(`/api/pages/${id}/source`, ana)).status, 403);

  // Edit and update; the next pull and the list follow.
  await new Promise((r) => setTimeout(r, 5));
  const edited = md.replace("# Two", "# Two, edited");
  assert.equal((await s.send("PUT", `/api/pages/${id}`, { markdown: edited, deck: true }, kim)).status, 200);
  const again = await s.get(`/api/pages/${id}/source`, kim);
  assert.deepEqual([again.body.source, again.body.version], [edited, 2]);
  const after = (await s.get("/api/me/pages", kim)).body.pages as Array<Record<string, any>>;
  assert.ok(Date.parse(after.find((p) => p.id === id)!.updatedAt) > first);

  // The hosted MCP: list_pages carries updated_at; get_page include_source the source.
  const tool = await s.mcp(7);
  const listed = await tool("list_pages", {});
  const mine = (listed.structuredContent?.pages as Array<Record<string, any>>).find((p) => p.id === id)!;
  assert.equal(typeof mine.updated_at, "string");
  const got = await tool("get_page", { id, include_source: true });
  assert.deepEqual([got.structuredContent?.source_format, got.structuredContent?.source, got.structuredContent?.updated_at !== undefined], ["markdown", edited, true]);
});

test("pull with an update token: an anonymous page's source, and nothing for a wrong token", async () => {
  const s = setup();
  const pub = await s.send("POST", "/api/publish", { html: "<h1>Draft</h1>" });
  const id = String(pub.body.id);
  const token = String(pub.body.update_token);
  const src = await s.get(`/api/pages/${id}/source`, { "X-Update-Token": token });
  assert.deepEqual([src.status, src.body.format, src.body.source], [200, "html", "<h1>Draft</h1>"]);
  assert.equal((await s.get(`/api/pages/${id}/source`, { "X-Update-Token": "at_nope" })).status, 403);
  assert.equal((await s.get(`/api/pages/${id}/source`)).status, 401);
  // Over the anonymous hosted MCP, the token is what lets get_page return the source.
  const tool = await s.mcp();
  const got = await tool("get_page", { id, update_token: token, include_source: true });
  assert.equal(got.structuredContent?.source, "<h1>Draft</h1>");
  const refused = await tool("get_page", { id, include_source: true });
  assert.equal(refused.isError, true);
});
