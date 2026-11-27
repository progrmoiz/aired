import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { skillsText } from "./helpers/skills.ts";

/** The aired skills: every file under apps/cli/skills. */
const SKILLS = "apps/cli skills";
const read = (f: string) => (f === SKILLS ? skillsText() : readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8"));
const toolsIn = (code: string) => [...code.matchAll(/registerTool\(\s*"(\w+)"/g)].map((m) => m[1]!);

test("the docs name every MCP tool both servers register", () => {
  // get_template is registered from a file both servers share.
  const shared = toolsIn(read("apps/worker/src/lib/mcp-templates.ts"));
  const hosted = [...toolsIn(read("apps/worker/src/routes/mcp.ts")), ...shared];
  const stdio = [...toolsIn(read("apps/mcp/src/index.ts")), ...shared];
  assert.ok(hosted.length >= 8 && stdio.length >= 4);
  const docs = read("apps/web/docs.html");
  const table = docs.slice(docs.indexOf('id="mcp-tools"'), docs.indexOf("Tool: <code>publish_html</code>"));
  for (const t of hosted) {
    assert.ok(table.includes(`<td><code>${t}</code></td>`), `docs.html tools table misses ${t}`);
    assert.ok(read("apps/web/llms-full.txt").includes(t), `llms-full.txt misses ${t}`);
  }
  for (const t of stdio) assert.ok(read(SKILLS).includes(`\`${t}\``), `the skills miss ${t}`);
  const agent = JSON.parse(read("apps/web/.well-known/agent.json")) as { mcp: { tools: string[] } };
  assert.deepEqual([...agent.mcp.tools].sort(), [...hosted].sort());
});

test("the docs cover aired set, aired feedback and their endpoints", () => {
  for (const f of [SKILLS, "apps/web/docs.html", "apps/web/llms.txt"]) {
    const s = read(f);
    for (const want of ["aired set", "aired feedback", "set_options", "get_page", "send_feedback"]) assert.ok(s.includes(want), `${f} misses ${want}`);
  }
  for (const f of ["apps/web/docs.html", "apps/web/llms.txt", "apps/web/llms-full.txt"]) {
    const s = read(f);
    for (const want of ["/api/pages/:id/details", "/api/feedback", "PATCH"]) assert.ok(s.includes(want), `${f} misses ${want}`);
  }
  // The bounds the docs give are the ones the code enforces.
  const opts = read("apps/worker/src/lib/page-options.ts");
  assert.match(opts, /TITLE_MAX = 200;/);
  assert.match(opts, /PIN_MIN = 4;\nexport const PIN_MAX = 64;/);
  assert.match(opts, /TTL_MIN = 60;\nexport const TTL_MAX = 365 \* 24 \* 60 \* 60;/);
  assert.match(opts, /READS_MAX = 1_000_000;/);
  for (const f of ["apps/web/docs.html", "apps/web/llms.txt"]) {
    const s = read(f);
    assert.ok(s.includes("31536000") && s.includes("4–64") && s.includes("1000000"), `${f} bounds`);
  }
  assert.match(read("apps/worker/src/lib/feedback.ts"), /FEEDBACK_PER_HOUR = 10;/);
  assert.match(read("apps/web/llms.txt"), /10 an hour per caller/);
});

test("the CLI, its MCP server and the registry entry say 1.8.0", () => {
  assert.equal(JSON.parse(read("apps/cli/package.json")).version, "1.8.0");
  assert.equal(JSON.parse(read("server.json")).version, "1.8.0");
  assert.match(read("apps/worker/src/routes/mcp.ts"), /name: "aired",\s*version: "1\.8\.0",/);
});

test("the docs cover aired check, check_page, its endpoint, the prompts and the resources", async () => {
  const { PROMPTS, SKILL_URI, PAGE_URI_TEMPLATE } = await import("../src/lib/mcp-extras.ts");
  for (const f of [SKILLS, "apps/web/docs.html", "apps/web/llms.txt", "apps/web/llms-full.txt"]) {
    const s = read(f);
    for (const want of ["aired check", "check_page", SKILL_URI, PAGE_URI_TEMPLATE, ...PROMPTS.map((p) => p.name)]) assert.ok(s.includes(want), `${f} misses ${want}`);
  }
  for (const f of ["apps/web/docs.html", "apps/web/llms.txt", "apps/web/llms-full.txt"]) {
    const s = read(f);
    for (const want of ["/api/pages/:id/check", "/api/pages/:id/source", "check_budget"]) assert.ok(s.includes(want), `${f} misses ${want}`);
  }
  // The limits the docs give are the ones the code has.
  assert.match(read("apps/worker/src/lib/page-check.ts"), /DEFAULT_CHECK_BUDGET_MS = 3 \* 60 \* 1000;/);
  assert.match(read("apps/worker/src/lib/mcp-extras.ts"), /RESOURCE_LIST_MAX = 50;/);
  for (const f of [SKILLS, "apps/web/docs.html", "apps/web/llms-full.txt"]) assert.match(read(f), /3 minutes/, f);
});

test("the docs cover Markdown, decks, speaker notes, templates and the slides guide", async () => {
  const { TEMPLATES } = await import("@aired/core");
  for (const f of [SKILLS, "apps/web/docs.html", "apps/web/llms.txt", "apps/web/llms-full.txt"]) {
    const s = read(f);
    for (const want of ["markdown", "type: deck", "/presenter", "get_template", "#/3", '<meta name="aired" content="deck">'.replace(/</g, f.endsWith(".html") ? "&lt;" : "<").replace(/>/g, f.endsWith(".html") ? "&gt;" : ">"), ...TEMPLATES.map((t) => t.name)]) {
      assert.ok(s.toLowerCase().includes(want.toLowerCase()), `${f} misses ${want}`);
    }
  }
  for (const f of [SKILLS, "apps/web/docs.html", "apps/web/llms.txt"]) assert.ok(read(f).includes("aired new"), `${f} misses aired new`);
  // get_template is registered on both servers, outside routes/mcp.ts.
  assert.match(read("apps/worker/src/routes/mcp.ts"), /registerTemplateTool\(server\)/);
  assert.match(read("apps/mcp/src/index.ts"), /registerTemplateTool\(server\)/);
  assert.match(read("apps/worker/src/lib/mcp-templates.ts"), /registerTool\(\s*"get_template"/);
  // The guide page exists, is in the sitemap and the footer.
  const guide = read("apps/web/share-slides.html");
  assert.match(guide, /<link rel="canonical" href="https:\/\/aired\.sh\/share-slides" \/>/);
  assert.ok(read("apps/web/sitemap.xml").includes("<loc>https://aired.sh/share-slides</loc>"));
  assert.ok(read("apps/web/index.html").includes('<a href="/share-slides">Share slides</a>'));
});
