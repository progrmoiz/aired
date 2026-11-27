import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PROMPTS, registerResources, skillFrontmatter, skillUri, SKILL_URI } from "../src/lib/mcp-extras.ts";
import { TIERS } from "../src/lib/rate-limit-tiers.ts";
import { FREE_MAX_BYTES, PRO_MAX_BYTES } from "../src/lib/entitlements.ts";
import { COLLECT_LIMITS, COLLECT_WRITE_LIMITS, LIVE_DATA_POLL_SECONDS, LIVE_DATA_PUSH_LIMIT, READ_PAGE_MAX, RECORD_MAX_BYTES, RECORD_MAX_DEPTH, VIEWER_TOKEN_SECONDS } from "../src/lib/collect-limits.ts";
import { ACCESS_COOKIE_SECONDS, ACCESS_LIMITS, CODE_TTL_MS } from "../src/lib/access-limits.ts";
import { ALWAYS_KEEP, VERSION_LIMITS } from "../src/lib/version-limits.ts";
import { blockedFieldName } from "../src/lib/collect-validate.ts";
import { CLI_DIR, skillFiles, skillsText } from "./helpers/skills.ts";

// skill-files.ts imports the .md files as text, as wrangler and esbuild do.
register(
  "data:text/javascript," +
    encodeURIComponent(`
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
export async function load(url, ctx, next) {
  if (url.endsWith(".md")) return { format: "module", source: "export default " + JSON.stringify(readFileSync(fileURLToPath(url), "utf8")), shortCircuit: true };
  return next(url, ctx);
}`),
);

const repo = (f: string) => readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8");
const FILES = skillFiles();
const SKILLS = FILES.filter((f) => f.path.endsWith("SKILL.md"));
const byName = (name: string) => FILES.find((f) => f.path === (name === "aired" ? "SKILL.md" : `skills/${name}/SKILL.md`))!.text;
const USE_CASES = ["aired-slides", "aired-dashboard", "aired-report", "aired-forms"];
const n = (x: number) => x.toLocaleString("en-US");

/** Every .ts file under a folder, joined: what the code says. */
function source(dir: string): string {
  let out = "";
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out += source(p);
    else if (name.endsWith(".ts")) out += readFileSync(p, "utf8");
  }
  return out;
}
const APPS = fileURLToPath(new URL("../../", import.meta.url));
const CLI_SRC = source(join(APPS, "cli/src"));
const SERVER_SRC = source(join(APPS, "worker/src")) + source(join(APPS, "mcp/src"));

/** What the skills show as code: fenced blocks and inline code spans. */
function codeIn(text: string): string[] {
  const fenced = [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]!);
  const inline = [...text.replace(/```[a-z]*\n[\s\S]*?```/g, "").matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!);
  return [...fenced, ...inline];
}

test("there are five skills: the core one and one for each use case", () => {
  assert.deepEqual(SKILLS.map((f) => skillFrontmatter(f.text)?.name).sort(), ["aired", ...USE_CASES].sort());
});

test("every skill has valid frontmatter: name and description, in the Agent Skills format", () => {
  const allowed = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
  for (const f of SKILLS) {
    const fm = skillFrontmatter(f.text);
    assert.ok(fm, `${f.path} has a name and description`);
    assert.match(fm.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${f.path}: lowercase letters, digits and hyphens`);
    assert.ok(fm.name.length <= 64, `${f.path}: name at most 64 characters`);
    // The folder holding SKILL.md is the skill's name (the core one is the package root).
    assert.equal(fm.name, f.path === "SKILL.md" ? "aired" : f.path.split("/")[1], `${f.path}: name matches its folder`);
    assert.ok(fm.description.length > 0 && fm.description.length <= 1024, `${f.path}: description is 1 to 1024 characters`);
    assert.ok(!/[<>]/.test(fm.description), `${f.path}: no angle brackets in the description`);
    assert.match(fm.description, /Use when/, `${f.path}: the description says when to load it`);
    const keys = [.../^---\n([\s\S]*?)\n---\n/.exec(f.text)![1]!.matchAll(/^([a-z-]+):/gm)].map((m) => m[1]!);
    for (const k of keys) assert.ok(allowed.has(k), `${f.path}: unknown frontmatter field ${k}`);
    assert.ok(f.text.split("\n").length < 500, `${f.path} stays under 500 lines`);
  }
});

test("the core skill says which skill to load for each job, at its resource URI, and its references exist", () => {
  const core = byName("aired");
  const desc = skillFrontmatter(core)!.description;
  for (const name of USE_CASES) {
    assert.ok(desc.includes(name), `the core description names ${name}`);
    assert.ok(core.includes(`\`${skillUri(`skills/${name}/SKILL.md`)}\``), `the core skill gives ${name}'s URI`);
  }
  const refs = [...core.matchAll(/`(references\/[a-z-]+\.md)`/g)].map((m) => m[1]!);
  assert.ok(refs.length >= 4);
  for (const r of refs) assert.ok(FILES.some((f) => f.path === r), `${r} exists`);
  for (const f of FILES.filter((x) => x.path.startsWith("references/"))) assert.ok(refs.includes(f.path), `the core skill lists ${f.path}`);
  // Each use-case skill builds on the core one rather than repeating it.
  for (const name of USE_CASES) assert.match(skillFrontmatter(byName(name))!.description, /Builds on the aired skill/);
});

test("both servers bundle exactly the skill files on disk, with their text", async () => {
  const { SKILL_FILES } = await import("../src/lib/skill-files.ts");
  assert.deepEqual(SKILL_FILES.map((f) => f.path).sort(), FILES.map((f) => f.path).sort());
  assert.equal(SKILL_FILES[0]!.path, "SKILL.md");
  for (const f of SKILL_FILES) assert.equal(f.text, FILES.find((x) => x.path === f.path)!.text, f.path);
  for (const code of [repo("apps/worker/src/routes/mcp.ts"), repo("apps/mcp/src/index.ts")]) {
    assert.match(code, /import \{ SKILL_FILES \} from "\.\.\/(\.\.\/worker\/src\/)?lib\/skill-files\.ts";/);
    assert.match(code, /skills: SKILL_FILES,/);
  }
});

test("every skill file is an MCP resource at skill://aired/..., and reads back as itself", async () => {
  const server = new McpServer({ name: "aired", version: "test" });
  registerResources(server, { origin: "https://aired.test", signedIn: false, get: async () => ({ status: 401, body: {} }), skills: FILES, ResourceTemplate });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  const listed = (await client.listResources()).resources;
  assert.deepEqual(listed.map((r) => r.uri).sort(), FILES.map((f) => skillUri(f.path)).sort());
  assert.equal(skillUri("SKILL.md"), SKILL_URI);
  for (const f of FILES) {
    const uri = skillUri(f.path);
    const r = listed.find((x) => x.uri === uri)!;
    assert.equal(r.mimeType, "text/markdown", uri);
    assert.ok(r.description && r.title, uri);
    const read = await client.readResource({ uri });
    assert.equal((read.contents[0] as { text: string }).text, f.text, uri);
    if (f.path.endsWith("SKILL.md")) {
      const name = skillFrontmatter(f.text)!.name;
      assert.equal(r.name, name, uri);
      assert.equal(r.description, skillFrontmatter(f.text)!.description, uri);
      // Skills over MCP: the last folder before SKILL.md is the skill's name.
      assert.equal(uri.split("/").at(-2), name, uri);
    }
  }
  assert.ok(FILES.some((f) => skillUri(f.path) === "skill://aired/aired-slides/SKILL.md"));
  assert.ok(FILES.some((f) => skillUri(f.path) === "skill://aired/references/cli.md"));
  await client.close();
});

test("the deck and report prompts point at their skills", () => {
  const text = (name: string) => PROMPTS.find((p) => p.name === name)!.text({});
  assert.ok(text("make_slide_deck").includes("aired-slides") && text("make_slide_deck").includes("skill://aired/aired-slides/SKILL.md"));
  for (const p of ["publish_report", "share_privately"]) {
    assert.ok(text(p).includes("aired-report") && text(p).includes("skill://aired/aired-report/SKILL.md"), p);
  }
});

test("npm pack includes every skill file", () => {
  const pkg = JSON.parse(repo("apps/cli/package.json")) as { files: string[] };
  for (const f of ["SKILL.md", "references/", "skills/"]) assert.ok(pkg.files.includes(f), `package.json files has ${f}`);
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: CLI_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const packed = new Set((JSON.parse(out) as { files: { path: string }[] }[])[0]!.files.map((f) => f.path));
  for (const f of FILES) assert.ok(packed.has(f.path), `npm pack misses ${f.path}`);
});

test("the skills name only CLI commands and flags that exist", () => {
  const commands = new Set([...CLI_SRC.matchAll(/new Command\('([a-z-]+)'\)/g)].map((m) => m[1]!));
  const flags = new Set([...CLI_SRC.matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1]!));
  // Flags of other tools the skills show: npx skills add, claude mcp add.
  const otherTools = new Set(["skill", "list", "transport"]);
  for (const f of FILES) {
    for (const code of codeIn(f.text)) {
      for (const m of code.matchAll(/\baired ([a-z][a-z-]*)(?![\w./-])/g)) assert.ok(commands.has(m[1]!), `${f.path}: \`aired ${m[1]}\` isn't a command`);
      for (const m of code.matchAll(/(?<![\w-])--([a-z][a-z-]*)/g)) assert.ok(flags.has(m[1]!) || otherTools.has(m[1]!), `${f.path}: --${m[1]} isn't a CLI flag`);
    }
  }
});

test("the skills name only tools, fields and error codes the servers have", () => {
  const tools = new Set([...SERVER_SRC.matchAll(/registerTool\(\s*"(\w+)"/g)].map((m) => m[1]!));
  for (const name of ["publish_html", "update_data", "get_responses", "set_options", "check_page", "list_versions", "restore_version", "get_template"]) assert.ok(tools.has(name));
  for (const f of FILES) {
    for (const code of codeIn(f.text)) {
      // snake_case names: a tool, a field or an error code. Each has to be in the code
      // (or be a field name aired.collect refuses, like card_number).
      for (const m of code.matchAll(/\b([a-z]+(?:_[a-z]+)+)\b/g)) {
        assert.ok(SERVER_SRC.includes(m[1]!) || blockedFieldName(m[1]!), `${f.path}: ${m[1]} isn't in the server code`);
      }
    }
  }
  for (const t of tools) if (!["get_account", "list_pages", "update_page", "delete_page"].includes(t)) assert.ok(skillsText().includes(`\`${t}\``), `the skills miss ${t}`);
});

test("the limits the skills give are the ones in the config", () => {
  const mb = (b: number) => `${b / 1024 / 1024} MB`;
  const { free, pro } = COLLECT_LIMITS;
  const want: Record<string, string[]> = {
    "SKILL.md": [
      `${TIERS.anonymous.limit} an hour per IP`,
      `${TIERS.authenticated.limit} an hour`,
      `${TIERS.pro.limit} a day`,
      `| ${mb(FREE_MAX_BYTES)} |`,
      `| ${mb(PRO_MAX_BYTES)} |`,
    ],
    "references/cli.md": ["3 minutes", "2 minutes signed in", `${TIERS.page_check.limit} an hour`],
    "references/bundling.md": [mb(FREE_MAX_BYTES), mb(PRO_MAX_BYTES)],
    "skills/aired-slides/SKILL.md": [`${mb(FREE_MAX_BYTES)} on Free (${mb(PRO_MAX_BYTES)} on Pro)`],
    "skills/aired-dashboard/SKILL.md": [
      `| Live data per page | ${free.liveDataBytes / 1024} KB | ${mb(pro.liveDataBytes)} |`,
      `${LIVE_DATA_PUSH_LIMIT.limit} an hour per page`,
      `every ${LIVE_DATA_POLL_SECONDS} seconds`,
      `more than ${VIEWER_TOKEN_SECONDS / 86400} days`,
    ],
    "skills/aired-forms/SKILL.md": [
      `| New entries per page a month | ${n(free.responsesPerMonth)} | ${n(pro.responsesPerMonth)} |`,
      `| Entries a page holds | ${n(free.storedResponses)} (${mb(free.storedBytes)}) | ${n(pro.storedResponses)} (${mb(pro.storedBytes)}) |`,
      `| Kept for | ${free.retentionDays} days after saving | As long as the page |`,
      `${RECORD_MAX_BYTES / 1024} KB`,
      `nested at most ${RECORD_MAX_DEPTH} deep`,
      `${COLLECT_WRITE_LIMITS.viewer.limit} times in ${COLLECT_WRITE_LIMITS.viewer.windowSeconds / 60} minutes`,
      `${n(COLLECT_WRITE_LIMITS.page.limit)} saves an hour`,
      `up to ${READ_PAGE_MAX}`,
    ],
    "skills/aired-report/SKILL.md": [
      `| People per page | ${ACCESS_LIMITS.free.people} | ${ACCESS_LIMITS.pro.people} |`,
      `| Whole domains per page | none | ${ACCESS_LIMITS.pro.domains} |`,
      `| Code emails a day, across your pages | ${n(ACCESS_LIMITS.free.sendsPerDay)} | ${n(ACCESS_LIMITS.pro.sendsPerDay)} |`,
      `for ${CODE_TTL_MS / 60000} minutes`,
      `in for ${ACCESS_COOKIE_SECONDS / 86400} days`,
      `Free keeps the last ${VERSION_LIMITS.free.versions} earlier versions; Pro the last ${VERSION_LIMITS.pro.versions}, each for ${VERSION_LIMITS.pro.days} days (the newest ${ALWAYS_KEEP} stay however old)`,
    ],
  };
  assert.equal(free.retentionDays, 90);
  assert.equal(pro.retentionDays, null);
  assert.equal(ACCESS_LIMITS.free.domains, 0);
  assert.match(repo("apps/worker/src/lib/page-check.ts"), /DEFAULT_CHECK_BUDGET_MS = 3 \* 60 \* 1000;/);
  for (const [path, strings] of Object.entries(want)) {
    const text = FILES.find((f) => f.path === path)!.text;
    for (const s of strings) assert.ok(text.includes(s), `${path} should say "${s}"`);
  }
  // Old claims that are no longer true.
  for (const stale of ["No auth required", "5 uploads/hour"]) assert.ok(!skillsText().includes(stale), stale);
});
