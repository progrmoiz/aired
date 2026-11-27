import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PROMPTS, registerPrompts, registerResources, SKILL_URI, skillDescription, skillUri } from "../src/lib/mcp-extras.ts";
import { skillFiles } from "./helpers/skills.ts";
import { pageAccess } from "../src/lib/page-options.ts";

const read = (f: string) => readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8");
const SKILL = read("apps/cli/skills/aired/SKILL.md");
const SKILLS = skillFiles();
const SKILL_URIS = SKILLS.map((f) => skillUri(f.path));

/**
 * The API as the resources see it: pages with owners, and the caller's
 * account. Ownership is decided by the same rule the routes use
 * (pageAccess), so this is the real "whose page is it" decision.
 */
function fakeApi(callerId: number | null) {
  const pages: Record<string, { ownerId: number | null; title: string; html: string }> = {
    mine1: { ownerId: 7, title: "My report", html: "<h1>mine</h1>" },
    mine2: { ownerId: 7, title: "My deck", html: "<h1>deck</h1>" },
    theirs: { ownerId: 8, title: "Their secret", html: "<h1>secret</h1>" },
    anon: { ownerId: null, title: "Anonymous", html: "<h1>anon</h1>" },
  };
  const calls: string[] = [];
  const get = async (path: string): Promise<{ status: number; body: unknown }> => {
    calls.push(path);
    if (path.startsWith("/api/me/pages")) {
      if (callerId === null) return { status: 401, body: { error: "Sign in" } };
      const mine = Object.entries(pages).filter(([, p]) => p.ownerId === callerId);
      return { status: 200, body: { pages: mine.map(([id, p]) => ({ id, title: p.title, url: `https://aired.test/p/${id}` })), cursor: null } };
    }
    const m = /^\/api\/pages\/([^/]+)\/source$/.exec(path);
    if (m) {
      const p = pages[decodeURIComponent(m[1]!)];
      if (p === undefined) return { status: 404, body: { error: "Page not found" } };
      const access = pageAccess({ ownerId: p.ownerId, userId: callerId, tokenSent: false, tokenMatches: false });
      if (!access.ok) return { status: access.status, body: { error: access.error } };
      return { status: 200, body: { id: m[1], html: p.html, title: p.title } };
    }
    return { status: 404, body: { error: "Not found" } };
  };
  return { get, calls };
}

async function connect(callerId: number | null) {
  const api = fakeApi(callerId);
  const server = new McpServer({ name: "aired", version: "test" });
  registerPrompts(server);
  registerResources(server, { origin: "https://aired.test", signedIn: callerId !== null, get: api.get, skills: SKILLS, ResourceTemplate });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  return { client, api };
}

test("resources: a signed-in caller lists and reads only their own pages", async () => {
  const { client } = await connect(7);
  const list = await client.listResources();
  const uris = list.resources.map((r) => r.uri).sort();
  assert.deepEqual(uris, ["aired://page/mine1", "aired://page/mine2", ...SKILL_URIS].sort());
  const mine = list.resources.find((r) => r.uri === "aired://page/mine1")!;
  assert.equal(mine.name, "My report");
  assert.equal(mine.mimeType, "text/html");

  const page = await client.readResource({ uri: "aired://page/mine1" });
  assert.deepEqual(page.contents, [{ uri: "aired://page/mine1", mimeType: "text/html", text: "<h1>mine</h1>" }]);

  // Someone else's page, and an anonymous page, by guessing the URI: refused, with no content.
  await assert.rejects(client.readResource({ uri: "aired://page/theirs" }), /isn't in your account/);
  await assert.rejects(client.readResource({ uri: "aired://page/anon" }), /isn't in your account/);
  await assert.rejects(client.readResource({ uri: "aired://page/nope" }), /Page not found/);
  await assert.rejects(client.readResource({ uri: "aired://page/..%2Fme" }), /isn't a page id|not found/i);
  await client.close();
});

test("resources: an anonymous caller sees the skill and no pages, and can't read any page", async () => {
  const { client, api } = await connect(null);
  const list = await client.listResources();
  assert.deepEqual(list.resources.map((r) => r.uri), SKILL_URIS);
  for (const id of ["mine1", "theirs", "anon"]) {
    await assert.rejects(client.readResource({ uri: `aired://page/${id}` }), /signed-in callers/);
  }
  // Never even asked the API for a page's source.
  assert.ok(!api.calls.some((c) => c.includes("/source")));
  await client.close();
});

test("the core skill resource is SKILL.md itself, in the Skills over MCP layout", async () => {
  const { client } = await connect(null);
  const skill = (await client.listResources()).resources.find((r) => r.uri === SKILL_URI)!;
  assert.equal(SKILL_URI, "skill://aired/SKILL.md");
  assert.equal(skill.mimeType, "text/markdown");
  assert.equal(skill.description, skillDescription(SKILL));
  assert.match(skill.description!, /^Publishes HTML/);
  const body = await client.readResource({ uri: SKILL_URI });
  assert.equal((body.contents[0] as { text: string }).text, SKILL);
  // The skill's name is the last segment of its URI, as the extension asks.
  assert.match(SKILL, /^---\nname: aired\n/);
  await client.close();
});

test("prompts: listed with titles and optional string arguments, and each mentions the tools it relies on", async () => {
  const { client } = await connect(null);
  const { prompts } = await client.listPrompts();
  assert.deepEqual(prompts.map((p) => p.name), ["publish_report", "make_slide_deck", "share_privately", "check_and_fix"]);
  for (const p of prompts) {
    assert.ok(p.title && p.description, p.name);
    assert.ok((p.arguments ?? []).every((a) => a.required !== true), `${p.name} works with no arguments`);
  }
  const deck = await client.getPrompt({ name: "make_slide_deck", arguments: { topic: "Q3 results", slides: "8" } });
  const text = (deck.messages[0]!.content as { text: string }).text;
  assert.equal(deck.messages[0]!.role, "user");
  assert.match(text, /about Q3 results, about 8 slides/);
  assert.match(text, /publish_html/);
  assert.match(text, /check_page/);
  assert.match(text, /viewport "mobile"/);
  const priv = await client.getPrompt({ name: "share_privately", arguments: {} });
  const ptext = (priv.messages[0]!.content as { text: string }).text;
  assert.match(ptext, /random 6-digit PIN/);
  assert.match(ptext, /Never write the PIN into the page/);
  assert.match(ptext, /two different messages/);
  for (const p of PROMPTS) assert.ok(p.text({}).length < 2000, `${p.name} stays short`);
  await client.close();
});

test("both servers register the same prompts and resources, and serve the skills as bundled text", () => {
  const hosted = read("apps/worker/src/routes/mcp.ts");
  const stdio = read("apps/mcp/src/index.ts");
  for (const code of [hosted, stdio]) {
    assert.match(code, /registerPrompts\(server\);/);
    assert.match(code, /registerResources\(server, \{/);
  }
  assert.match(hosted, /import \{ SKILL_FILES \} from "\.\.\/lib\/skill-files\.ts";/);
  assert.match(stdio, /import \{ SKILL_FILES \} from "\.\.\/\.\.\/worker\/src\/lib\/skill-files\.ts";/);
  assert.match(read("apps/worker/src/lib/skill-files.ts"), /import core from "\.\.\/\.\.\/\.\.\/cli\/skills\/aired\/SKILL\.md";/);
  // Hosted: signed in means an API key or OAuth, never a cookie (handleMcp's signedIn).
  assert.match(hosted, /signedIn: signedIn !== null,/);
  assert.match(read("apps/worker/wrangler.toml"), /\[\[rules\]\]\ntype = "Text"\nglobs = \["\*\*\/\*\.md"\]/);
  assert.match(read("apps/cli/build.mjs"), /loader: \{ '\.md': 'text' \}/);
  assert.match(read("apps/mcp/tsup.config.ts"), /loader: \{ "\.md": "text" \}/);
});

test("resources/list still lists the skill when fetching the caller's pages throws (offline, bad key)", async () => {
  const server = new McpServer({ name: "aired", version: "test" });
  registerResources(server, { origin: "https://aired.test", signedIn: true, get: async () => { throw new Error("fetch failed"); }, skills: SKILLS, ResourceTemplate });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  assert.deepEqual((await client.listResources()).resources.map((r) => r.uri), SKILL_URIS);
  await client.close();
});
