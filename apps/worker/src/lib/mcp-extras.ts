import { z } from "zod";
import type { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * MCP prompts and resources, the same on both aired servers: the hosted one
 * (routes/mcp.ts) and the stdio one in the npm package (apps/mcp). Like
 * mcp-shapes.ts, its only runtime import is zod; the SDK's ResourceTemplate
 * class comes in as an argument, so the stdio bundle keeps one copy of the SDK.
 *
 * Prompts: ready-made requests that clients show as slash commands.
 * Resources:
 *   - skill://aired/SKILL.md: the core aired skill, its reference files at
 *     skill://aired/references/*.md, and the skills for each use case at
 *     skill://aired/<name>/SKILL.md (aired-slides, aired-dashboard,
 *     aired-report, aired-forms). For any connected agent, in the Skills
 *     over MCP layout (the folder holding SKILL.md is the skill's name),
 *     served as plain resources. The files come from apps/cli (skill-files.ts).
 *   - aired://page/{id}: the caller's own pages and their HTML. Signed-in
 *     callers only (API key, OAuth, or the CLI's sign-in on stdio); the API
 *     decides ownership, so nobody reads anyone else's page.
 */

export const SKILL_URI = "skill://aired/SKILL.md";

/** One file of the aired skills: its path in the npm package (apps/cli) and its text. */
export type SkillFile = { path: string; text: string };

/**
 * A skill file's URI. The core skill is the package root, so its files keep
 * their paths under skill://aired/; a skill under skills/<name>/ sits at
 * skill://aired/<name>/.
 */
export function skillUri(path: string): string {
  const rel = path.startsWith("skills/") ? path.slice("skills/".length) : path;
  return `skill://aired/${rel}`;
}

/** A SKILL.md's frontmatter name and description, or null when it has none. */
export function skillFrontmatter(text: string): { name: string; description: string } | null {
  const block = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (block === null) return null;
  const field = (k: string) => new RegExp(`^${k}:[ \\t]*(.+)$`, "m").exec(block[1]!)?.[1]?.trim() ?? null;
  const name = field("name");
  const description = field("description");
  return name !== null && description !== null ? { name, description } : null;
}

export const PAGE_URI_TEMPLATE = "aired://page/{id}";
export const pageUri = (id: string): string => `aired://page/${id}`;

const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** How many of the caller's pages resources/list shows (the newest). */
export const RESOURCE_LIST_MAX = 50;

export type ExtrasDeps = {
  /** This server's aired origin, for the sign-in hint. */
  origin: string;
  /** Whether the caller is signed in (API key, OAuth or CLI sign-in). */
  signedIn: boolean;
  /** A GET on the aired API as the caller: status and parsed JSON. */
  get: (path: string) => Promise<{ status: number; body: unknown }>;
  /** The aired skills' files (skill-files.ts), the core SKILL.md first. */
  skills: readonly SkillFile[];
  /** The SDK's ResourceTemplate class, from the server's own copy of the SDK. */
  ResourceTemplate: typeof ResourceTemplate;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** The skill's frontmatter description, for the resource listing. */
export function skillDescription(skill: string): string {
  return skillFrontmatter(skill)?.description ?? "How to publish and manage pages with aired.";
}

export class ResourceError extends Error {}

const signIn = (origin: string): string =>
  `Pages are resources only for signed-in callers. Use an aired API key (AIRED_API_KEY), connect ${origin}/mcp/account, or run \`aired login\`.`;

/** resources/read for aired://page/{id}: the caller's own page, or an error. */
export async function readPageResource(deps: Pick<ExtrasDeps, "signedIn" | "get" | "origin">, id: string) {
  if (!deps.signedIn) throw new ResourceError(signIn(deps.origin));
  if (!PAGE_ID.test(id)) throw new ResourceError("That isn't a page id.");
  const res = await deps.get(`/api/pages/${encodeURIComponent(id)}/source`);
  if (res.status !== 200) {
    const reason = str(obj(res.body).error);
    // Someone else's page answers 403 and a missing one 404; neither says more than that.
    throw new ResourceError(res.status === 403 ? "That page isn't in your account." : res.status === 404 ? "Page not found." : reason ?? `aired answered ${res.status}`);
  }
  const b = obj(res.body);
  const html = typeof b.html === "string" ? b.html : "";
  // A Markdown page reads as its Markdown, which is what the agent can edit and publish again.
  if (b.format === "markdown" && typeof b.source === "string") return { contents: [{ uri: pageUri(id), mimeType: "text/markdown", text: b.source }] };
  // A deck's HTML as published, notes included (the caller owns it).
  const source = typeof b.source === "string" && b.kind === "deck" ? b.source : html;
  return { contents: [{ uri: pageUri(id), mimeType: "text/html", text: source }] };
}

/** resources/list: the caller's newest pages, or none when not signed in. */
export async function listPageResources(deps: Pick<ExtrasDeps, "signedIn" | "get">) {
  if (!deps.signedIn) return { resources: [] };
  let res: { status: number; body: unknown };
  try {
    res = await deps.get(`/api/me/pages?limit=${RESOURCE_LIST_MAX}`);
  } catch {
    // Offline, or a bad AIRED_API_KEY on stdio: list no pages, but still list the skill.
    return { resources: [] };
  }
  if (res.status !== 200) return { resources: [] };
  const pages = Array.isArray(obj(res.body).pages) ? (obj(res.body).pages as unknown[]) : [];
  return {
    resources: pages.slice(0, RESOURCE_LIST_MAX).flatMap((p) => {
      const id = str(obj(p).id);
      if (id === null || !PAGE_ID.test(id)) return [];
      const title = str(obj(p).title);
      return [{ uri: pageUri(id), name: title ?? id, ...(title ? { title } : {}), description: str(obj(p).url) ?? undefined, mimeType: "text/html" }];
    }),
  };
}

/** How one skill file is listed: a SKILL.md by its frontmatter, a reference by its first heading. */
export function skillResourceMeta(file: SkillFile): { name: string; title: string; description: string } {
  const uri = skillUri(file.path);
  const fm = file.path.endsWith("SKILL.md") ? skillFrontmatter(file.text) : null;
  if (fm !== null) return { name: fm.name, title: `${fm.name} skill`, description: fm.description };
  const heading = /^#\s+(.+)$/m.exec(file.text)?.[1]?.trim() ?? file.path;
  const owner = /^skill:\/\/aired\/(aired-[a-z0-9-]+)\//.exec(uri)?.[1] ?? "aired";
  return { name: uri.slice("skill://".length), title: heading, description: `Reference for the ${owner} skill: ${heading}.` };
}

export function registerResources(server: McpServer, deps: ExtrasDeps): void {
  for (const file of deps.skills) {
    const uri = skillUri(file.path);
    const meta = skillResourceMeta(file);
    server.registerResource(
      meta.name,
      uri,
      { title: meta.title, description: meta.description, mimeType: "text/markdown" },
      async () => ({ contents: [{ uri, mimeType: "text/markdown", text: file.text }] }),
    );
  }
  server.registerResource(
    "page",
    new deps.ResourceTemplate(PAGE_URI_TEMPLATE, { list: () => listPageResources(deps) }),
    { title: "Your aired pages", description: "The HTML of a page in your aired account (signed in only).", mimeType: "text/html" },
    async (_uri, vars) => readPageResource(deps, String(Array.isArray(vars.id) ? vars.id[0] : vars.id ?? "")),
  );
}

/** One prompt: its name, title, description, arguments and the message it sends. */
type PromptDef = {
  name: string;
  title: string;
  description: string;
  args: Record<string, z.ZodOptional<z.ZodString>>;
  text: (a: Record<string, string | undefined>) => string;
};

/** The line a prompt opens its steps with: which skill has the full rules. */
export const skillLine = (name: string): string =>
  `Follow the ${name} skill (load it, or read the resource ${skillUri(`skills/${name}/SKILL.md`)}). It has the worked example, the exact calls and the gotchas.`;

const CHECK_STEP =
  "After publishing, call check_page on the page. If ok is false, fix what it reports, update the same page (publish_html with its id and update_token, or update_page), and check once more. Then give me the link.";

export const PROMPTS: PromptDef[] = [
  {
    name: "publish_report",
    title: "Publish as a shareable report",
    description: "Turn what we have into a clean report page (Markdown, from aired's report template) and publish it as a link.",
    args: {
      about: z.string().optional().describe("What the report covers, e.g. last week's sign-ups"),
      audience: z.string().optional().describe("Who will read it, e.g. the team or a client"),
    },
    text: (a) =>
      [
        `Write a report${a.about ? ` about ${a.about}` : " from what we've been working on"}${a.audience ? `, for ${a.audience}` : ""}, and publish it with aired.`,
        skillLine("aired-report"),
        "",
        "1. Call get_template with name \"report\". Follow its rules and keep its shape: a # title with who it's for and the date, a short summary first, a table of key numbers, what was done, and next steps as a task list.",
        "2. Use only real figures from this conversation or files I've shared. Where one is missing, write [number] rather than guessing.",
        "3. No secrets, tokens, keys or personal data that shouldn't leave this conversation.",
        "4. Publish it with publish_html, the Markdown in `markdown` (not html), and a title. aired renders it as a readable page that works on phones and in dark mode.",
        "",
        CHECK_STEP,
      ].join("\n"),
  },
  {
    name: "make_slide_deck",
    title: "Make a slide deck",
    description: "Write a slide deck in Markdown (aired's deck template), with speaker notes, and publish it as a link you can present from.",
    args: {
      topic: z.string().optional().describe("What the deck is about"),
      slides: z.string().optional().describe("About how many slides, e.g. 8"),
    },
    text: (a) =>
      [
        `Make a slide deck${a.topic ? ` about ${a.topic}` : " from what we've discussed"}${a.slides ? `, about ${a.slides} slides` : ""}, and publish it with aired.`,
        skillLine("aired-slides"),
        "",
        "1. Call get_template with name \"deck\" and follow its rules: front matter with type: deck and a title, slides split on --- lines, a # title slide first, then ## slides with one idea each and at most five short bullets.",
        "2. Add speaker notes to each slide after a line starting with Note:. They stay out of the public page; only I see them, in the speaker view.",
        "3. Need custom layouts or charts? Use the \"deck-html\" template instead: each top-level <section> is a 1280×720 slide, notes in <aside class=\"notes\">.",
        "4. No secrets or personal data.",
        "5. Publish with publish_html: the Markdown in `markdown` (or the HTML in `html`), deck: true, and the deck's title.",
        "",
        "aired adds the controls: arrow keys, swipe on phones, F or the Present button for full screen, and #/N on the link opens slide N.",
        CHECK_STEP,
        "Check it with viewport \"mobile\" as well. Give me the link, the link to slide 2 as an example, and the speaker view link if publish_html returned one.",
      ].join("\n"),
  },
  {
    name: "share_privately",
    title: "Share privately with a PIN",
    description: "Publish a page behind a PIN, with an expiry, and say how to send the PIN.",
    args: {
      what: z.string().optional().describe("What to share: a file path, or what to build"),
      expires: z.string().optional().describe("How long the link lasts, e.g. 24h or 7d (default 7 days)"),
      pin: z.string().optional().describe("The PIN to use, 4 to 64 characters. Leave empty to make one up"),
    },
    text: (a) =>
      [
        `Share ${a.what ? a.what : "the page we've been working on"} privately with aired.`,
        skillLine("aired-report"),
        "",
        `- Publish it with publish_html and a PIN: ${a.pin ? "use the PIN I gave" : "make up a random 6-digit PIN"}. Never write the PIN into the page itself.`,
        `- Make it expire${a.expires ? ` after ${a.expires}` : " after 7 days"}: pass ttl_seconds for that long.`,
        "- If it should only be opened a few times, set a view limit afterwards with set_options (view_limit).",
        "- Run check_page on it and fix anything broken (the check sees the page without the PIN).",
        "- Then give me the link and the PIN separately, and remind me to send them to the other person in two different messages or apps.",
        "- To change the PIN or expiry later, use set_options; to take the page down, delete_page.",
      ].join("\n"),
  },
  {
    name: "check_and_fix",
    title: "Check a page and fix it",
    description: "Open a published page in a real browser, fix what's broken, and update it at the same link.",
    args: {
      page: z.string().optional().describe("The page id or URL"),
    },
    text: (a) =>
      [
        `Check ${a.page ? `the aired page ${a.page}` : "the aired page we just published"} with check_page.`,
        "- If ok is true, tell me it works and show the screenshot.",
        "- If not, fix each error it reports in the HTML (script errors, files that didn't load, broken images, a blank screen), update the same page so the link doesn't change, and check again. Stop after three rounds and tell me what's left.",
        "- Mention warnings (slow, heavy, too wide), but don't loop on them.",
      ].join("\n"),
  },
];

export function registerPrompts(server: McpServer): void {
  for (const p of PROMPTS) {
    server.registerPrompt(p.name, { title: p.title, description: p.description, argsSchema: p.args }, (args: Record<string, string | undefined>) => ({
      description: p.description,
      messages: [{ role: "user" as const, content: { type: "text" as const, text: p.text(args ?? {}) } }],
    }));
  }
}
