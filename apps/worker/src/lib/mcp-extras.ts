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
 *   - skill://aired/SKILL.md: the aired skill, for any connected agent
 *     (the Skills over MCP layout, served as a plain resource).
 *   - aired://page/{id}: the caller's own pages and their HTML. Signed-in
 *     callers only (API key, OAuth, or the CLI's sign-in on stdio); the API
 *     decides ownership, so nobody reads anyone else's page.
 */

export const SKILL_URI = "skill://aired/SKILL.md";
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
  /** The aired skill (apps/cli/SKILL.md). */
  skill: string;
  /** The SDK's ResourceTemplate class, from the server's own copy of the SDK. */
  ResourceTemplate: typeof ResourceTemplate;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** The skill's frontmatter description, for the resource listing. */
export function skillDescription(skill: string): string {
  const m = /^---\n[\s\S]*?^description:\s*(.+)$[\s\S]*?^---/m.exec(skill);
  return m?.[1]?.trim() ?? "How to publish and manage pages with aired.";
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
  return { contents: [{ uri: pageUri(id), mimeType: "text/html", text: html }] };
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

export function registerResources(server: McpServer, deps: ExtrasDeps): void {
  server.registerResource(
    "aired",
    SKILL_URI,
    { title: "aired skill", description: skillDescription(deps.skill), mimeType: "text/markdown" },
    async () => ({ contents: [{ uri: SKILL_URI, mimeType: "text/markdown", text: deps.skill }] }),
  );
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

const CHECK_STEP =
  "After publishing, call check_page on the page. If ok is false, fix what it reports, update the same page (publish_html with its id and update_token, or update_page), and check once more. Then give me the link.";

export const PROMPTS: PromptDef[] = [
  {
    name: "publish_report",
    title: "Publish as a shareable report",
    description: "Turn what we have into a clean one-page HTML report and publish it as a link.",
    args: {
      about: z.string().optional().describe("What the report covers, e.g. last week's sign-ups"),
      audience: z.string().optional().describe("Who will read it, e.g. the team or a client"),
    },
    text: (a) =>
      [
        `Write a one-page HTML report${a.about ? ` about ${a.about}` : " from what we've been working on"}${a.audience ? `, for ${a.audience}` : ""}, and publish it with aired.`,
        "",
        "The page:",
        "- One self-contained HTML file: inline CSS, no build step. External scripts or fonts only from a CDN, and only if they're needed.",
        "- A clear <title>, a short summary at the top, then sections with headings. Tables for numbers, charts only where they help.",
        "- Readable on a phone (a viewport meta tag, no fixed widths) and when printed.",
        "- No secrets, tokens, keys or personal data that shouldn't leave this conversation.",
        "",
        "Publish it with publish_html (title it), then:",
        CHECK_STEP,
      ].join("\n"),
  },
  {
    name: "make_slide_deck",
    title: "Make a slide deck page",
    description: "Build a keyboard-driven HTML slide deck and publish it as a link.",
    args: {
      topic: z.string().optional().describe("What the deck is about"),
      slides: z.string().optional().describe("About how many slides, e.g. 8"),
    },
    text: (a) =>
      [
        `Make an HTML slide deck${a.topic ? ` about ${a.topic}` : " from what we've discussed"}${a.slides ? `, about ${a.slides} slides` : ""}, and publish it with aired.`,
        "",
        "The deck:",
        "- One self-contained HTML file. Each slide is a 16:9 section scaled to fit the window; one slide shows at a time.",
        "- Arrow keys, Space and Page Up/Down move between slides, Home/End jump, F toggles fullscreen. Clicking the right or left half moves too, so it works on a phone. Show the slide number.",
        "- Keep the current slide in the URL hash (#3), so a link can open on a slide.",
        "- A print stylesheet puts one slide per page, so Print → Save as PDF gives a PDF deck.",
        "- Big type, one idea per slide, few words. No secrets or personal data.",
        "",
        "Publish it with publish_html (title it after the deck), then:",
        CHECK_STEP,
        "Check it with viewport \"mobile\" as well.",
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
