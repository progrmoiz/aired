import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync, statSync, accessSync, constants } from "node:fs";
import { readFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { z } from "zod";
import { AUTH_HEADER, CSRF_HEADER } from "@aired/core";
import { readCliSession } from "./session.js";
import {
  CHECK_DESCRIPTION,
  checkContent,
  checkInput,
  checkOut,
  FEEDBACK_DESCRIPTION,
  RESPONSES_DESCRIPTION,
  UPDATE_DATA_DESCRIPTION,
  changesPageSettings,
  collectPatchBody,
  responsesInput,
  responsesOut,
  responsesText,
  updateDataInput,
  updateDataOut,
  updateDataText,
  feedbackInput,
  feedbackOut,
  outputShapes,
  getPageOut,
  getPageText,
  pageText,
  patchBody,
  publishOut,
  setOptionsInput,
  setOptionsOut,
  LIST_VERSIONS_DESCRIPTION,
  MESSAGE_INPUT,
  RESTORE_VERSION_DESCRIPTION,
  listVersionsInput,
  restoreOut,
  restoreText,
  restoreVersionInput,
  versionsOut,
  versionsText,
} from "../../worker/src/lib/mcp-shapes.ts";
import { registerPrompts, registerResources } from "../../worker/src/lib/mcp-extras.ts";
import { CONTENT_INPUT, GET_PAGE_DESCRIPTION, getPageInput, MISSING_CONTENT, registerTemplateTool } from "../../worker/src/lib/mcp-templates.ts";
// The aired skill, bundled as text (esbuild/tsup loader for .md).
import skill from "../../cli/SKILL.md";

declare const __AIRED_VERSION__: string | undefined;

const DEFAULT_API_URL = "https://aired.sh";

type PackToString = (
  baseDir: string,
  inputHtml: string,
  fs: {
    exists(path: string): Promise<boolean>;
    readFileText(path: string): Promise<string>;
    readFileDataUri(path: string): Promise<string>;
  },
) => Promise<string>;

interface PublishResult {
  id: string;
  url: string;
  update_token: string;
  expiresAt: string | null;
  claim_url?: string;
  upgrade?: { url?: string };
  kind?: string;
  slides?: number;
  presenter_url?: string;
}

const apiBase = () => process.env["AIRED_API_URL"] ?? DEFAULT_API_URL;

/**
 * Who the call is from: the aired CLI's sign-in (`aired login`) and, if set,
 * AIRED_API_KEY (CI, agents). A set-but-wrong key is an error, never a quiet
 * anonymous call.
 */
function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  // Attach the CLI session if signed in, so the page is owned by the account
  // (authenticated publishes default to permanent rather than a 7-day expiry).
  const jwt = readCliSession();
  if (jwt !== null) {
    headers[AUTH_HEADER] = jwt;
    headers[CSRF_HEADER] = "1";
  }
  const rawKey = process.env["AIRED_API_KEY"];
  if (rawKey !== undefined) {
    const apiKey = rawKey.trim().replace(/^bearer\s+/i, "");
    if (!apiKey.startsWith("aired_sk_")) {
      throw new Error("AIRED_API_KEY must be an aired API key starting with aired_sk_ (or unset it to publish anonymously).");
    }
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  return headers;
}

/** One aired API call. Throws with the API's error message on a non-2xx answer. */
async function api<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  const headers: Record<string, string> = {
    "User-Agent": `aired-mcp/${typeof __AIRED_VERSION__ === "string" ? __AIRED_VERSION__ : "dev"}`,
    ...authHeaders(),
    ...extra,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const resp = await fetch(`${apiBase()}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let parsed: unknown = null;
  try {
    parsed = await resp.json();
  } catch {
    // handled below
  }
  if (!resp.ok) {
    const message = typeof (parsed as Record<string, unknown> | null)?.["error"] === "string"
      ? String((parsed as Record<string, unknown>)["error"])
      : `aired answered ${resp.status}`;
    throw new Error(resp.status === 429 ? `Rate limited: ${message}` : message);
  }
  if (parsed === null) throw new Error("aired: unexpected response format");
  return parsed as T;
}

/** One aired API GET: status and parsed JSON, never throwing on a non-2xx answer. */
async function apiGet(path: string): Promise<{ status: number; body: unknown }> {
  const resp = await fetch(`${apiBase()}${path}`, {
    headers: { "User-Agent": `aired-mcp/${typeof __AIRED_VERSION__ === "string" ? __AIRED_VERSION__ : "dev"}`, ...authHeaders() },
  });
  return { status: resp.status, body: await resp.json().catch(() => null) };
}

/** Signed in here: the CLI's sign-in or an API key. */
function signedIn(): boolean {
  return readCliSession() !== null || (process.env["AIRED_API_KEY"] ?? "").trim() !== "";
}

async function publishHTML(
  content: { html?: string; markdown?: string; deck?: boolean },
  options: {
    title?: string;
    pin?: string;
    ttl?: number;
    permanent?: boolean;
    project?: string;
    update_token?: string;
    id?: string;
    message?: string;
  } = {},
): Promise<PublishResult> {
  const body: Record<string, unknown> = { ...content };

  if (options.title !== undefined) body["title"] = options.title;
  if (options.pin !== undefined) body["pin"] = options.pin;
  if (options.ttl !== undefined) body["ttl"] = options.ttl;
  if (options.permanent === true) body["permanent"] = true;
  if (options.project !== undefined) body["project"] = options.project;
  if (options.update_token !== undefined) body["update_token"] = options.update_token;
  if (options.id !== undefined) body["id"] = options.id;
  if (options.message !== undefined) body["message"] = options.message;

  return api<PublishResult>("POST", "/api/publish", body);
}

const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const toolError = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const server = new McpServer({
  name: "aired",
  // Set at build time by apps/cli/build.mjs (the npm package version).
  version: typeof __AIRED_VERSION__ === "string" ? __AIRED_VERSION__ : "0.0.0-dev",
});

server.registerTool(
  "publish_html",
  {
    title: "Publish HTML",
    description:
      "Publish HTML or Markdown (a string or a file) to a shareable URL. Returns a live URL that renders it in a browser. Markdown (or a .md file) becomes a clean, readable doc; with deck: true it becomes slides split on --- lines, and HTML with <section> slides works too. get_template has ready-made starters. Pass update_token from a previous publish to update the same URL; the content it replaces is kept as a version (list_versions, restore_version). Change the PIN, expiry, view limit or title later with set_options.",
    inputSchema: {
      html: z.string().optional().describe("HTML content to publish"),
      ...CONTENT_INPUT,
      file_path: z.string().optional().describe("Path to an HTML or Markdown (.md) file, or a folder with index.html (alternative to html)"),
      title: z.string().optional().describe("Page title"),
      pin: z.string().optional().describe("PIN to protect access"),
      ttl_seconds: z.number().optional().describe("Time to live in seconds (default: 604800 = 7 days)"),
      permanent: z.boolean().optional().describe("If true, page never expires"),
      project: z.string().optional().describe("Group this page under a project on your dashboard (e.g. the repo or app name). Not auto-detected over MCP — pass it explicitly to organize related pages together."),
      update_token: z.string().optional().describe("Pass a previously returned token to update the same URL instead of creating a new one"),
      id: z.string().optional().describe("Page ID — required when update_token is provided to update the same URL"),
      ...MESSAGE_INPUT,
    },
    outputSchema: outputShapes.publish_html,
    annotations: { title: "Publish HTML", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ html, markdown, deck, file_path, title, pin, ttl_seconds, permanent, project, update_token, id, message }) => {
    // Resolve the content: HTML, or Markdown (a .md file counts as Markdown)
    let content: string;
    let isMarkdown = false;

    if (markdown !== undefined) {
      content = markdown;
      isMarkdown = true;
    } else if (html !== undefined) {
      content = html;
    } else if (file_path !== undefined) {
      try {
        const s = statSync(file_path);
        if (s.isDirectory()) {
          // Bundle directory into single HTML
          const indexPath = join(file_path, "index.html");
          try {
            accessSync(indexPath, constants.R_OK);
          } catch {
            return {
              content: [{ type: "text", text: `No index.html found in directory: ${file_path}` }],
              isError: true,
            };
          }
          // Loaded with require so tsc does not typecheck the package's raw
          // .ts sources (its "types" field points at them); same as apps/cli.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { default: packToString } = require("@joplin/htmlpack/packToString") as {
            default: PackToString;
          };
          const baseDir = dirname(indexPath);
          const inputHtml = readFileSync(indexPath, "utf-8");
          content = await packToString(baseDir, inputHtml, {
            async exists(p: string) {
              try { await access(p, constants.R_OK); return true; } catch { return false; }
            },
            async readFileText(p: string) {
              return readFile(p, "utf-8");
            },
            async readFileDataUri(p: string) {
              const { default: Datauri } = await import("datauri/sync");
              // Empty string is how htmlpack already treats an unreadable file.
              return Datauri(p).content ?? "";
            },
          });
        } else {
          content = readFileSync(file_path, "utf-8");
          isMarkdown = /\.(md|markdown|mdown|mkd)$/i.test(file_path);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error reading file: ${message}` }],
          isError: true,
        };
      }
    } else {
      return {
        content: [{ type: "text", text: `${MISSING_CONTENT} Or pass file_path.` }],
        isError: true,
      };
    }

    // If update_token is provided but id is missing, we can't target the same page
    if (update_token !== undefined && id === undefined) {
      return {
        content: [
          {
            type: "text",
            text: "When providing update_token, you must also provide the page id (returned from the original publish call). Without id, a new page would be created instead of updating the existing one.",
          },
        ],
        isError: true,
      };
    }

    try {
      const sent = isMarkdown ? { markdown: content } : { html: content };
      const result = await publishHTML({ ...sent, ...(deck !== undefined ? { deck } : {}) }, {
        title,
        pin,
        ttl: ttl_seconds,
        permanent,
        project,
        update_token,
        id,
        message,
      });

      const lines: string[] = [];
      lines.push(`Published to ${result.url}`);
      lines.push(`Update token: ${result.update_token}`);

      if (result.expiresAt !== null) {
        const expiry = new Date(result.expiresAt);
        lines.push(`Expires: ${expiry.toISOString().split("T")[0]}`);
      } else {
        lines.push("Expires: never (permanent)");
      }

      lines.push("");
      lines.push("Pass update_token and id to update the same URL.");
      if (result.claim_url) lines.push(`To keep this page in an aired account, open: ${result.claim_url}`);
      if (result.kind === "deck") {
        lines.push(`Slides: ${result.slides ?? 0}. Link to one with #/N, e.g. ${result.url}#/2`);
        if (result.presenter_url) lines.push(`Speaker view (notes, only for the signed-in owner): ${result.presenter_url}`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: publishOut(result, { updated: update_token !== undefined, owner: null }),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "get_page",
  {
    title: "Get a page",
    description: GET_PAGE_DESCRIPTION,
    inputSchema: getPageInput,
    outputSchema: outputShapes.get_page,
    annotations: { title: "Get a page", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ id, update_token, include_source }) => {
    if (!PAGE_ID.test(id)) return toolError("That isn't a page id.");
    try {
      const headers: Record<string, string> = update_token ? { "X-Update-Token": update_token } : {};
      const body = await api<unknown>("GET", `/api/pages/${encodeURIComponent(id)}/details`, undefined, headers);
      const source = include_source === true ? await api<unknown>("GET", `/api/pages/${encodeURIComponent(id)}/source`, undefined, headers) : undefined;
      const page = getPageOut(body, apiBase(), source);
      return { content: [{ type: "text" as const, text: getPageText(page) }], structuredContent: page };
    } catch (err) {
      return toolError(`Error: ${errorMessage(err)}`);
    }
  },
);

server.registerTool(
  "set_options",
  {
    title: "Change page settings",
    description:
      "Change who can open a page (anyone, a PIN, or only named people who confirm their email with a code), its expiry (a TTL, or permanent), view limit or title after publishing, without sending its HTML again. Send only what should change. For pages your account owns, or any page whose update_token you pass; sharing with named people needs sign-in.",
    inputSchema: setOptionsInput,
    outputSchema: outputShapes.set_options,
    annotations: { title: "Change page settings", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (args) => {
    if (!PAGE_ID.test(args.id)) return toolError("That isn't a page id.");
    try {
      const path = `/api/pages/${encodeURIComponent(args.id)}`;
      // The data-layer settings go to their own endpoint, signed in only.
      const collect = collectPatchBody(args);
      if (collect !== null) await api<unknown>("PATCH", `${path}/responses`, collect);
      const body =
        collect !== null && !changesPageSettings(args)
          ? {
              ...((await api<Record<string, unknown>>("GET", `${path}/details`))),
              changed: [...(args.public_results !== undefined ? ["public_results"] : []), ...(args.accept_responses !== undefined ? ["accept_responses"] : [])],
            }
          : await api<unknown>("PATCH", path, patchBody(args));
      const page = setOptionsOut(body, apiBase());
      const lead = page.changed.length > 0 ? `Changed ${page.changed.join(", ")} of` : "Settings of";
      return { content: [{ type: "text" as const, text: pageText(page, lead) }], structuredContent: page };
    } catch (err) {
      return toolError(`Error: ${errorMessage(err)}`);
    }
  },
);

server.registerTool(
  "list_versions",
  {
    title: "List a page's versions",
    description: LIST_VERSIONS_DESCRIPTION,
    inputSchema: listVersionsInput,
    outputSchema: outputShapes.list_versions,
    annotations: { title: "List a page's versions", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ id, update_token }) => {
    if (!PAGE_ID.test(id)) return toolError("That isn't a page id.");
    try {
      const headers: Record<string, string> = update_token ? { "X-Update-Token": update_token } : {};
      const out = versionsOut(await api<unknown>("GET", `/api/pages/${encodeURIComponent(id)}/versions`, undefined, headers), apiBase());
      return { content: [{ type: "text" as const, text: versionsText(out) }], structuredContent: out };
    } catch (err) {
      return toolError(`Error: ${errorMessage(err)}`);
    }
  },
);

server.registerTool(
  "restore_version",
  {
    title: "Restore a page version",
    description: RESTORE_VERSION_DESCRIPTION,
    inputSchema: restoreVersionInput,
    outputSchema: outputShapes.restore_version,
    annotations: { title: "Restore a page version", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ id, version, update_token, message }) => {
    if (!PAGE_ID.test(id)) return toolError("That isn't a page id.");
    try {
      const out = restoreOut(
        await api<unknown>("POST", `/api/pages/${encodeURIComponent(id)}/versions/${version}/restore`, {
          ...(update_token !== undefined ? { update_token } : {}),
          ...(message !== undefined ? { message } : {}),
        }),
      );
      return { content: [{ type: "text" as const, text: restoreText(out) }], structuredContent: out };
    } catch (err) {
      return toolError(`Error: ${errorMessage(err)}`);
    }
  },
);

server.registerTool(
  "check_page",
  {
    title: "Check a page in a browser",
    description: CHECK_DESCRIPTION,
    inputSchema: checkInput,
    outputSchema: outputShapes.check_page,
    annotations: { title: "Check a page in a browser", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ id, update_token, viewport, include_screenshot }) => {
    if (!PAGE_ID.test(id)) return toolError("That isn't a page id.");
    const withImage = include_screenshot !== false;
    try {
      const body = await api<unknown>("POST", `/api/pages/${encodeURIComponent(id)}/check`, {
        ...(update_token !== undefined ? { update_token } : {}),
        ...(viewport !== undefined ? { viewport } : {}),
        inline_screenshot: withImage,
      });
      return { content: checkContent(body, withImage), structuredContent: checkOut(body) };
    } catch (err) {
      return toolError(`Error: ${errorMessage(err)}`);
    }
  },
);

server.registerTool(
  "send_feedback",
  {
    title: "Send feedback to aired",
    description: FEEDBACK_DESCRIPTION,
    inputSchema: feedbackInput,
    outputSchema: outputShapes.send_feedback,
    annotations: { title: "Send feedback to aired", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (args) => {
    try {
      const out = feedbackOut(await api<unknown>("POST", "/api/feedback", { ...args, source: "mcp", actor: "agent" }));
      return { content: [{ type: "text" as const, text: `Feedback sent: ${out.id}\n${out.message}` }], structuredContent: out };
    } catch (err) {
      return toolError(`Error: ${errorMessage(err)}`);
    }
  },
);

registerTemplateTool(server);
server.registerTool(
  "get_responses",
  {
    title: "Read a page's responses",
    description: RESPONSES_DESCRIPTION,
    inputSchema: responsesInput,
    outputSchema: outputShapes.get_responses,
    annotations: { title: "Read a page's responses", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ id, limit, cursor, format }) => {
    if (!PAGE_ID.test(id)) return toolError("That isn't a page id.");
    if (!signedIn()) return toolError("Sign in first: run `aired login`, or set AIRED_API_KEY.");
    const q = new URLSearchParams();
    if (limit !== undefined) q.set("limit", String(limit));
    if (cursor) q.set("cursor", cursor);
    try {
      const out = responsesOut(await api<unknown>("GET", `/api/pages/${encodeURIComponent(id)}/responses${q.size ? `?${q}` : ""}`), { csv: format === "csv" });
      return { content: [{ type: "text" as const, text: responsesText(out) }], structuredContent: out };
    } catch (err) {
      return toolError(`Error: ${errorMessage(err)}`);
    }
  },
);

server.registerTool(
  "update_data",
  {
    title: "Push live data to a page",
    description: UPDATE_DATA_DESCRIPTION,
    inputSchema: updateDataInput,
    outputSchema: outputShapes.update_data,
    annotations: { title: "Push live data to a page", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  async ({ id, data }) => {
    if (!PAGE_ID.test(id)) return toolError("That isn't a page id.");
    if (!signedIn()) return toolError("Sign in first: run `aired login`, or set AIRED_API_KEY.");
    try {
      const out = updateDataOut(await api<unknown>("PUT", `/api/pages/${encodeURIComponent(id)}/data`, { data }));
      return { content: [{ type: "text" as const, text: updateDataText(out) }], structuredContent: out };
    } catch (err) {
      return toolError(`Error: ${errorMessage(err)}`);
    }
  },
);

registerPrompts(server);
// Signed in or not is read on each call, so `aired login` mid-session counts.
registerResources(server, {
  origin: apiBase(),
  get signedIn() {
    return signedIn();
  },
  get: apiGet,
  skill,
  ResourceTemplate,
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
