import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";
import { z } from "zod";
import type { Context } from "hono";
import type { AppBindings } from "../types.js";
import { PAGE_INPUT_LIMITS } from "@aired/core";
import { billingEnabled, upgradeUrl } from "../lib/entitlements.js";
import { siteOrigin } from "../lib/origin.ts";
import { TIERS } from "../lib/rate-limit-tiers.js";
import {
  signInRequiredText,
  accountResult,
  anonymousPublishResult,
  anonymousUpdateResult,
  apiErrorMessage,
  apiErrorResult,
  deleteResult,
  feedbackResult,
  listResult,
  pageResult,
  publishResult,
  publishUpdateResult,
  setOptionsResult,
  updateResult,
  type ToolResult,
} from "../lib/mcp-account.js";
import {
  EXPORT_PDF_DESCRIPTION,
  exportPdfInput,
  exportPdfOut,
  exportPdfText,
  CHECK_DESCRIPTION,
  FEEDBACK_DESCRIPTION,
  contentOut,
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
  checkContent,
  checkInput,
  checkOut,
  feedbackInput,
  outputShapes,
  patchBody,
  setOptionsInput,
  LIST_VERSIONS_DESCRIPTION,
  MESSAGE_INPUT,
  RESTORE_VERSION_DESCRIPTION,
  listVersionsInput,
  restoreOut,
  restoreText,
  restoreVersionInput,
  versionsOut,
  versionsText,
  type SlideStatsInput,
} from "../lib/mcp-shapes.ts";
import { registerPrompts, registerResources } from "../lib/mcp-extras.ts";
import { carded, cardTitle, cardToolMeta, registerCard } from "../lib/mcp-card.ts";
import { CONTENT_INPUT, GET_PAGE_DESCRIPTION, getPageInput, MISSING_CONTENT, registerTemplateTool } from "../lib/mcp-templates.ts";
// The aired skills, bundled as text (wrangler.toml [[rules]]), served as resources.
import { SKILL_FILES } from "../lib/skill-files.ts";

/**
 * A tool call passed to the HTTP API in-process. A signed-in caller's (API
 * key or OAuth) carries their credentials, so the API's ownership, plan
 * limits, rate limits and claim rules apply exactly as for any other
 * request; an anonymous caller's carries none, only the IP. `headers` adds
 * request headers (X-Update-Token).
 */
type CallApi = (
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) => Promise<{ status: number; body: unknown }>;

/** A caller signed in with an API key or OAuth. */
type SignedIn = {
  login: string;
  origin: string;
};

const signInRequired = (origin: string): ToolResult => ({ content: [{ type: "text", text: signInRequiredText(origin) }], isError: true });

/** Page ids as generateId makes them; anything else never reaches the API path. */
const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const badId = (): ToolResult => ({ content: [{ type: "text", text: "That isn't a page id." }], isError: true });
const errorText = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

/**
 * The hosted MCP server. It reads and writes nothing itself: every tool
 * calls the HTTP API in-process (callApi), so the API's rules apply to MCP
 * callers exactly as to anyone else (lib/pages-service.ts). `env` gives only
 * the site origin and whether billing is on, for the answers' wording.
 */
export function createAiredMcpServer(
  env: { SITE_ORIGIN?: string; BILLING_ENABLED?: string },
  signedIn: SignedIn | null,
  callApi: CallApi,
) {
  const server = new McpServer({
    name: "aired",
    version: "1.10.0",
  });
  const origin = siteOrigin(env);

  server.registerTool(
    "publish_html",
    {
      title: "Publish HTML",
      description:
        "Publish HTML or Markdown to a shareable URL. Returns a live URL that renders it in a browser. Send markdown instead of html for a clean, readable doc; for slides, send Markdown split on --- lines (or HTML with <section> slides) with deck: true, and get_template has ready-made starters. Pass update_token from a previous publish to update the same URL; the content it replaces is kept as a version (list_versions, restore_version). With an aired API key, pages belong to your account (permanent by default) and you can update your own pages by id without a token. Change the PIN, expiry, view limit or title later with set_options.",
      inputSchema: {
      html: z.string().optional().describe("HTML content to publish (or send markdown instead)"),
      ...CONTENT_INPUT,
      title: z.string().optional().describe("Page title"),
      pin: z.string().max(PAGE_INPUT_LIMITS.pinMax).optional().describe("PIN to protect access"),
      ttl_seconds: z
        .number()
        .max(PAGE_INPUT_LIMITS.ttlMaxSeconds)
        .optional()
        .describe("Time to live in seconds (default: 604800 = 7 days; at most a year, use permanent for longer)"),
      permanent: z
        .boolean()
        .optional()
        .describe("If true, page never expires"),
      update_token: z
        .string()
        .optional()
        .describe("Token from a previous publish to update the same URL"),
      id: z
        .string()
        .optional()
        .describe("Page ID — required when update_token is provided"),
      ...MESSAGE_INPUT,
      },
      outputSchema: outputShapes.publish_html,
      annotations: { title: "Publish HTML", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      _meta: cardToolMeta("publish_html"),
    },
    carded(origin, async ({ html, markdown, deck, title, pin, ttl_seconds, permanent, update_token, id: existingId, message }) => {
      if (html === undefined && markdown === undefined) return errorText(MISSING_CONTENT);
      if (typeof update_token === "string" && typeof existingId !== "string") {
        return errorText("When providing update_token, you must also provide the page id.");
      }
      if (typeof existingId === "string" && !PAGE_ID.test(existingId)) return badId();
      // Sent on to the API as given: it renders Markdown and decks, checks
      // sizes, spam, tokens and limits the same way for every caller
      // (lib/pages-service.ts), signed in or anonymous.
      const body = {
        ...(html !== undefined ? { html } : {}),
        ...(markdown !== undefined ? { markdown } : {}),
        ...(deck !== undefined ? { deck } : {}),
        ...(message !== undefined ? { message } : {}),
      };
      // Your own page by id: no token needed. Anonymous callers need its token.
      if (typeof existingId === "string" && typeof update_token !== "string") {
        if (signedIn === null) return errorText(`Pass the page's update_token with its id, or sign in. ${signInRequiredText(origin)}`);
        const res = await callApi("PUT", `/api/pages/${encodeURIComponent(existingId)}`, { ...body, title });
        return res.status === 200 ? publishUpdateResult(res.body, signedIn.login) : apiErrorResult(res.status, res.body, origin);
      }
      const isTokenUpdate = typeof update_token === "string";
      const res = await callApi("POST", "/api/publish", {
        ...body,
        title,
        pin,
        ...(typeof ttl_seconds === "number" ? { ttl: ttl_seconds } : {}),
        ...(typeof permanent === "boolean" ? { permanent } : {}),
        ...(isTokenUpdate ? { update_token, id: existingId } : {}),
      });
      if (res.status !== 200) return apiErrorResult(res.status, res.body, origin);
      // A token update may be of a page the caller doesn't own: don't claim it's theirs.
      if (isTokenUpdate) return signedIn !== null ? publishUpdateResult(res.body, null) : anonymousUpdateResult(res.body);
      return signedIn !== null ? publishResult(res.body, signedIn.login) : anonymousPublishResult(res.body, origin);
    }, (args, out) => ({
      action: out.updated === true ? "updated" : "published",
      title: cardTitle(args),
      // Signed-in publishes of your own page name you as its owner; token updates and anonymous pages don't.
      mine: signedIn !== null && typeof out.owner === "string",
    })),
  );

  // --- Page settings and feedback (signed in, or with the page's token) -----

  server.registerTool(
    "get_page",
    {
      title: "Get a page",
      description:
        GET_PAGE_DESCRIPTION,
      inputSchema: getPageInput,
      outputSchema: outputShapes.get_page,
      annotations: { title: "Get a page", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: cardToolMeta("get_page"),
    },
    carded(origin, async ({ id, update_token, include_source }) => {
      if (!PAGE_ID.test(id)) return badId();
      if (signedIn === null && update_token === undefined) {
        return errorText(`Pass the page's update_token, or sign in. ${signInRequiredText(origin)}`);
      }
      const headers: Record<string, string> = update_token ? { "X-Update-Token": update_token } : {};
      const res = await callApi("GET", `/api/pages/${encodeURIComponent(id)}/details`, undefined, headers);
      if (res.status !== 200) return apiErrorResult(res.status, res.body, origin);
      // A deck, for its signed-in owner: its per-slide numbers (Pro), or the upgrade link.
      let slideStats: SlideStatsInput | undefined;
      if (signedIn !== null && update_token === undefined && (res.body as { kind?: unknown } | null)?.kind === "deck") {
        const st = await callApi("GET", `/api/pages/${encodeURIComponent(id)}/slides?days=30`);
        if (st.status === 200) slideStats = { stats: st.body };
        else if (st.status === 402) slideStats = { upgradeUrl: upgradeUrl(origin, "slides") };
      }
      if (include_source !== true) return pageResult(res.body, origin, undefined, slideStats);
      const src = await callApi("GET", `/api/pages/${encodeURIComponent(id)}/source`, undefined, headers);
      return src.status === 200 ? pageResult(res.body, origin, src.body, slideStats) : apiErrorResult(src.status, src.body, origin);
    }, (args, out) => ({
      action: "page",
      title: typeof out.title === "string" ? out.title : null,
      // Details without a token: the API let the signed-in caller in as the owner.
      mine: signedIn !== null && args.update_token === undefined,
    })),
  );

  server.registerTool(
    "set_options",
    {
      title: "Change page settings",
      description:
        "Change who can open a page (anyone, a PIN, or only named people who confirm their email with a code), its expiry (a TTL, or permanent), view limit or title after publishing, without sending its HTML again. Send only what should change. For your own pages, or any page whose update_token you pass; sharing with named people needs sign-in.",
      inputSchema: setOptionsInput,
      outputSchema: outputShapes.set_options,
      annotations: { title: "Change page settings", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      if (!PAGE_ID.test(args.id)) return badId();
      if (signedIn === null && args.update_token === undefined) {
        return errorText(`Pass the page's update_token, or sign in. ${signInRequiredText(origin)}`);
      }
      const page = `/api/pages/${encodeURIComponent(args.id)}`;
      // The data-layer settings (public_results, accept_responses) go to their own endpoint, signed in only.
      const collect = collectPatchBody(args);
      if (collect !== null) {
        if (signedIn === null) return signInRequired(origin);
        const res = await callApi("PATCH", `${page}/responses`, collect);
        if (res.status !== 200) return apiErrorResult(res.status, res.body, origin);
        if (!changesPageSettings(args)) {
          const details = await callApi("GET", `${page}/details`);
          if (details.status !== 200) return apiErrorResult(details.status, details.body, origin);
          const changed = [...(args.public_results !== undefined ? ["public_results"] : []), ...(args.accept_responses !== undefined ? ["accept_responses"] : [])];
          return setOptionsResult({ ...(details.body as object), changed }, origin);
        }
      }
      const res = await callApi("PATCH", page, patchBody(args));
      return res.status === 200 ? setOptionsResult(res.body, origin) : apiErrorResult(res.status, res.body, origin);
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
      if (!PAGE_ID.test(id)) return badId();
      if (signedIn === null && update_token === undefined) {
        return errorText(`Pass the page's update_token, or sign in. ${signInRequiredText(origin)}`);
      }
      const headers: Record<string, string> = update_token ? { "X-Update-Token": update_token } : {};
      const res = await callApi("GET", `/api/pages/${encodeURIComponent(id)}/versions`, undefined, headers);
      if (res.status !== 200) return apiErrorResult(res.status, res.body, origin);
      const out = versionsOut(res.body, origin);
      return { content: [{ type: "text" as const, text: versionsText(out) }], structuredContent: out };
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
      _meta: cardToolMeta("restore_version"),
    },
    carded(origin, async ({ id, version, update_token, message }) => {
      if (!PAGE_ID.test(id)) return badId();
      if (signedIn === null && update_token === undefined) {
        return errorText(`Pass the page's update_token, or sign in. ${signInRequiredText(origin)}`);
      }
      const res = await callApi("POST", `/api/pages/${encodeURIComponent(id)}/versions/${version}/restore`, {
        ...(update_token !== undefined ? { update_token } : {}),
        ...(message !== undefined ? { message } : {}),
      });
      if (res.status !== 200) return apiErrorResult(res.status, res.body, origin);
      const out = restoreOut(res.body);
      return { content: [{ type: "text" as const, text: restoreText(out) }], structuredContent: out };
    }, (args) => ({ action: "restored", title: null, mine: signedIn !== null && args.update_token === undefined })),
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
      if (!PAGE_ID.test(id)) return badId();
      if (signedIn === null && update_token === undefined) {
        return errorText(`Pass the page's update_token, or sign in. ${signInRequiredText(origin)}`);
      }
      const withImage = include_screenshot !== false;
      const res = await callApi("POST", `/api/pages/${encodeURIComponent(id)}/check`, {
        ...(update_token !== undefined ? { update_token } : {}),
        ...(viewport !== undefined ? { viewport } : {}),
        inline_screenshot: withImage,
      });
      if (res.status === 200) return { content: checkContent(res.body, withImage), structuredContent: checkOut(res.body) };
      // Not "wait before publishing again": a busy browser or a spent budget isn't about publishing.
      if (res.status === 429 || res.status === 503) return errorText(apiErrorMessage(res.status, res.body));
      return apiErrorResult(res.status, res.body, origin);
    },
  );

  server.registerTool(
    "export_pdf",
    {
      title: "Export a page as a PDF",
      description: EXPORT_PDF_DESCRIPTION,
      inputSchema: exportPdfInput,
      outputSchema: outputShapes.export_pdf,
      annotations: { title: "Export a page as a PDF", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ id, update_token, notes, paper }) => {
      if (!PAGE_ID.test(id)) return badId();
      if (signedIn === null && update_token === undefined) {
        return errorText(`Pass the page's update_token, or sign in. ${signInRequiredText(origin)}`);
      }
      const res = await callApi("POST", `/api/pages/${encodeURIComponent(id)}/pdf`, {
        ...(update_token !== undefined ? { update_token } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(paper !== undefined ? { paper } : {}),
      });
      if (res.status === 200) {
        const out = exportPdfOut(res.body);
        return { content: [{ type: "text" as const, text: exportPdfText(out) }], structuredContent: out };
      }
      // A busy browser or a spent budget isn't about publishing.
      if (res.status === 429 || res.status === 503) return errorText(apiErrorMessage(res.status, res.body));
      return apiErrorResult(res.status, res.body, origin);
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
      const res = await callApi("POST", "/api/feedback", { ...args, source: "mcp", actor: "agent" });
      return res.status === 200 ? feedbackResult(res.body) : apiErrorResult(res.status, res.body, origin);
    },
  );

  // --- Signed-in tools (need an API key or OAuth) ----------------------------

  server.registerTool(
    "list_pages",
    {
      title: "List your pages",
      description: "List your pages on aired (needs an API key): id, URL, title, views, expiry.",
      inputSchema: {
        cursor: z.string().optional().describe("From a previous list_pages answer, for the next page of results"),
        project: z.string().optional().describe("Only pages in this project"),
      },
      outputSchema: outputShapes.list_pages,
      annotations: { title: "List your pages", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ cursor, project }) => {
      if (signedIn === null) return signInRequired(origin);
      const q = new URLSearchParams();
      if (cursor) q.set("cursor", cursor);
      if (project) q.set("project", project);
      const res = await callApi("GET", `/api/me/pages${q.size ? `?${q}` : ""}`);
      return res.status === 200 ? listResult(res.body, signedIn.origin) : apiErrorResult(res.status, res.body, origin);
    },
  );

  server.registerTool(
    "update_page",
    {
      title: "Update a page",
      description: "Replace the HTML (or Markdown) of one of your pages, keeping its URL (needs an API key; no update token). The content it replaces is kept in the page's history (list_versions).",
      inputSchema: {
        id: z.string().describe("Page id, from publish_html or list_pages"),
        html: z.string().optional().describe("The new HTML (or send markdown instead)"),
        ...CONTENT_INPUT,
        title: z.string().optional().describe("New title"),
        ...MESSAGE_INPUT,
      },
      outputSchema: outputShapes.update_page,
      annotations: { title: "Update a page", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      _meta: cardToolMeta("update_page"),
    },
    carded(origin, async ({ id, html, markdown, deck, title, message }) => {
      if (signedIn === null) return signInRequired(origin);
      if (!PAGE_ID.test(id)) return badId();
      if (html === undefined && markdown === undefined) return errorText(MISSING_CONTENT);
      const res = await callApi("PUT", `/api/pages/${encodeURIComponent(id)}`, {
        ...(html !== undefined ? { html } : {}),
        ...(markdown !== undefined ? { markdown } : {}),
        ...(deck !== undefined ? { deck } : {}),
        ...(message !== undefined ? { message } : {}),
        title,
      });
      return res.status === 200 ? updateResult(res.body) : apiErrorResult(res.status, res.body, origin);
    }, (args) => ({ action: "updated", title: cardTitle(args), mine: true })),
  );

  server.registerTool(
    "delete_page",
    {
      title: "Delete a page",
      description: "Delete one of your pages for good (needs an API key). The link stops working.",
      inputSchema: { id: z.string().describe("Page id, from publish_html or list_pages") },
      outputSchema: outputShapes.delete_page,
      annotations: { title: "Delete a page", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      if (signedIn === null) return signInRequired(origin);
      if (!PAGE_ID.test(id)) return badId();
      const res = await callApi("DELETE", `/api/pages/${encodeURIComponent(id)}`);
      return res.status === 200 ? deleteResult(id) : apiErrorResult(res.status, res.body, origin);
    },
  );

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
      if (signedIn === null) return signInRequired(origin);
      if (!PAGE_ID.test(id)) return badId();
      const q = new URLSearchParams();
      if (limit !== undefined) q.set("limit", String(limit));
      if (cursor) q.set("cursor", cursor);
      const res = await callApi("GET", `/api/pages/${encodeURIComponent(id)}/responses${q.size ? `?${q}` : ""}`);
      if (res.status !== 200) return apiErrorResult(res.status, res.body, origin);
      const out = responsesOut(res.body, { csv: format === "csv" });
      return { content: [{ type: "text" as const, text: responsesText(out) }], structuredContent: out };
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
      if (signedIn === null) return signInRequired(origin);
      if (!PAGE_ID.test(id)) return badId();
      const res = await callApi("PUT", `/api/pages/${encodeURIComponent(id)}/data`, { data });
      if (res.status !== 200) return apiErrorResult(res.status, res.body, origin);
      const out = updateDataOut(res.body);
      return { content: [{ type: "text" as const, text: updateDataText(out) }], structuredContent: out };
    },
  );

  server.registerTool(
    "get_account",
    {
      title: "Get your account",
      description: "Your aired account (needs an API key): plan, limits, renewal, and an upgrade link for a person to open.",
      inputSchema: {},
      outputSchema: outputShapes.get_account,
      annotations: { title: "Get your account", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      if (signedIn === null) return signInRequired(origin);
      const res = await callApi("GET", "/api/me");
      return res.status === 200
        ? accountResult(res.body, {
            upgradeUrl: billingEnabled(env) ? upgradeUrl(origin, "mcp") : null,
            freePublishLimit: `${TIERS.authenticated.limit} an hour`,
            proPublishLimit: `${TIERS.pro.limit} a day`,
          })
        : apiErrorResult(res.status, res.body, origin);
    },
  );

  registerTemplateTool(server);
  registerPrompts(server);
  registerCard(server, origin);
  registerResources(server, {
    origin,
    signedIn: signedIn !== null,
    get: (path) => callApi("GET", path),
    skills: SKILL_FILES,
    ResourceTemplate,
  });

  return server;
}

/** Sends a Request through the whole app (auth, limits, routes), in-process. */
/** Run a request through the app in-process; asUser signs it in as that account (an OAuth caller). */
export type AppFetch = (request: Request, asUser?: number) => Response | Promise<Response>;

/**
 * Handle MCP Streamable HTTP requests at /mcp.
 * Creates a new McpServer instance per request (required by SDK 1.26.0+).
 * Only an API key signs a caller in here (never a cookie), so a cross-site
 * request can't act as anyone; everyone else gets the anonymous tools.
 */
export async function handleMcp(c: Context<AppBindings>, appFetch: AppFetch, route: "/mcp" | "/mcp/account" = "/mcp") {
  const user = c.get("user");
  const via = c.get("via");
  const authorization = c.req.header("Authorization");
  // A key caller's calls carry their key; an OAuth caller's run as their
  // account in-process, and the OAuth token itself is never passed on.
  const asKey = via === "key" && authorization !== undefined;
  const asOAuth = via === "oauth";
  const signedIn: SignedIn | null = user !== null && (asKey || asOAuth) ? { login: user.login, origin: new URL(c.req.url).origin } : null;
  const callApi: CallApi = async (method, path, body, extra = {}) => {
    const headers = new Headers({ "User-Agent": "aired-mcp", ...extra });
    if (signedIn !== null && asKey) headers.set("Authorization", authorization!);
    const ip = c.req.header("CF-Connecting-IP");
    if (ip) headers.set("CF-Connecting-IP", ip);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    const res = await appFetch(
      new Request(new URL(path, c.req.url), {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      signedIn !== null && asOAuth ? user!.id : undefined,
    );
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const server = createAiredMcpServer(c.env, signedIn, callApi);
  const handler = createMcpHandler(server, { route });
  return handler(c.req.raw, c.env, c.executionCtx);
}
