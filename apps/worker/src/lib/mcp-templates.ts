import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTemplate, TEMPLATE_NAMES, TEMPLATES, type Template } from "@aired/core";

/**
 * Markdown, decks and templates on both aired MCP servers: the hosted one
 * (routes/mcp.ts) and the stdio one (apps/mcp). Like mcp-shapes.ts, the
 * only runtime imports are zod and @aired/core (the templates themselves,
 * which `aired new` uses too).
 */

/** The publish_html and update_page inputs beside html. */
export const CONTENT_INPUT = {
  markdown: z
    .string()
    .optional()
    .describe(
      "Markdown to publish instead of html. Renders as a clean, readable page with highlighted code, tables and task lists (raw HTML in it shows as text). With deck: true, or front matter `type: deck`, it becomes slides split on --- lines",
    ),
  deck: z
    .boolean()
    .optional()
    .describe(
      'Show it as slides: Markdown split on --- lines, or HTML whose top-level <section>s are 1280×720 slides (or HTML with <meta name="aired" content="deck">). Speaker notes (Note: lines in Markdown, <aside class="notes"> in HTML) are kept out of the public page; only the signed-in owner sees them',
    ),
};

export const MISSING_CONTENT = "Send html or markdown.";

/** get_page, the same on both servers. */
export const GET_PAGE_DESCRIPTION =
  "A page's details: title, URL, size, views, view limit, expiry, project, whether a PIN is on (never the PIN), and whether it's a doc or a deck. With include_source, also what was published: the Markdown (or HTML) before rendering, and a deck's speaker notes. For your own pages, or any page whose update_token you pass.";

export const getPageInput = {
  id: z.string().describe("Page id, from publish_html or list_pages"),
  update_token: z.string().optional().describe("The page's update token. Not needed for pages your account owns"),
  include_source: z.boolean().optional().describe("Also return the source as published (Markdown or HTML) and a deck's speaker notes"),
};

const templateSummary = z.object({ name: z.string(), title: z.string(), description: z.string(), format: z.enum(["markdown", "html"]), deck: z.boolean() });

export const TEMPLATE_DESCRIPTION =
  `A starting point to fill in and publish: ${TEMPLATES.map((t) => `${t.name} (${t.description.replace(/\.$/, "")})`).join("; ")}. ` +
  "Without a name, lists them. With a name, returns the starter content and the rules for filling it in. Then publish it with publish_html (markdown or html, and deck when it's a deck).";

export const templateOutput = {
  templates: z.array(templateSummary),
  template: z
    .object({
      ...templateSummary.shape,
      filename: z.string(),
      rules: z.array(z.string()),
      content: z.string().describe("The starter, ready to publish as it is"),
      publish_with: z.string().describe("Which publish_html field to put the content in: markdown or html"),
    })
    .nullable(),
};

const summary = (t: Template) => ({ name: t.name, title: t.title, description: t.description, format: t.format, deck: t.deck });

/** get_template's answer: the list, and the template asked for (or an error for an unknown name). */
export function templateResult(name: string | undefined) {
  const list = TEMPLATES.map(summary);
  if (name === undefined || name.trim() === "") {
    const text = ["Templates (call get_template with a name for the content):", ...TEMPLATES.map((t) => `- ${t.name}: ${t.description}`)].join("\n");
    return { content: [{ type: "text" as const, text }], structuredContent: { templates: list, template: null } };
  }
  const t = getTemplate(name);
  if (t === null) {
    return { content: [{ type: "text" as const, text: `No template called "${name}". Pick one of: ${TEMPLATE_NAMES.join(", ")}.` }], isError: true };
  }
  const publishWith = t.format === "markdown" ? "markdown" : "html";
  const text = [
    `${t.title}: ${t.description}`,
    "",
    "Rules:",
    ...t.rules.map((r) => `- ${r}`),
    "",
    `Publish with publish_html, the content in \`${publishWith}\`${t.deck ? ", deck: true" : ""}.`,
    "",
    `Starter (${t.filename}):`,
    t.content,
  ].join("\n");
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: { templates: list, template: { ...summary(t), filename: t.filename, rules: t.rules, content: t.content, publish_with: publishWith } },
  };
}

export function registerTemplateTool(server: McpServer): void {
  server.registerTool(
    "get_template",
    {
      title: "Get a page template",
      description: TEMPLATE_DESCRIPTION,
      inputSchema: { name: z.enum(TEMPLATE_NAMES).optional().describe("Which template. Leave out to list them") },
      outputSchema: templateOutput,
      annotations: { title: "Get a page template", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ name }) => templateResult(name),
  );
}
