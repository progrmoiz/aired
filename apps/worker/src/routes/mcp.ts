import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";
import { z } from "zod";
import type { Context } from "hono";
import type { AppBindings } from "../types.js";
import { loadStats, saveStats } from "../lib/stats.js";
import { detectSpam, SPAM_REJECTION } from "../lib/spam.js";
import { claimUrl } from "../lib/claim-url.js";
import {
  generateId,
  generateToken,
  hashToken,
  verifyToken,
  validateHtml,
  extractTitle,
  capTitle,
  DEFAULT_TTL,
  PAGE_INPUT_LIMITS,
} from "@aired/core";
import type { PageMetadata } from "@aired/core";
import { createPage, loadPage, StorageUnavailable, updatePage, type LoadedPage } from "../lib/page-write.ts";
import { hashPin } from "../lib/pin-hash.js";
import { refreshShot } from "../lib/og-render.js";
import { billingEnabled, upgradeUrl } from "../lib/entitlements.js";
import { siteOrigin } from "../lib/origin.ts";
import { TIERS } from "../lib/rate-limit-tiers.js";
import {
  signInRequiredText,
  accountResult,
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
  CHECK_DESCRIPTION,
  FEEDBACK_DESCRIPTION,
  checkContent,
  checkInput,
  checkOut,
  feedbackInput,
  outputShapes,
  patchBody,
  setOptionsInput,
} from "../lib/mcp-shapes.ts";
import { registerPrompts, registerResources } from "../lib/mcp-extras.ts";
// The aired skill, bundled as text (wrangler.toml [[rules]]), served as a resource.
import skill from "../../../cli/SKILL.md";

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

function createAiredMcpServer(
  env: {
    PAGES_BUCKET: R2Bucket;
    PAGES_KV: KVNamespace;
    DB: D1Database;
    SITE_ORIGIN?: string;
    BILLING_ENABLED?: string;
    BROWSER?: Fetcher;
    OG_SHOT_DAILY_SECONDS?: string;
  },
  signedIn: SignedIn | null,
  callApi: CallApi,
  /** Runs work after the response (the request's waitUntil). */
  background: (work: Promise<unknown>) => void,
) {
  const server = new McpServer({
    name: "aired",
    version: "1.5.0",
  });
  const origin = siteOrigin(env);

  server.registerTool(
    "publish_html",
    {
      title: "Publish HTML",
      description:
        "Publish HTML to a shareable URL. Returns a live URL that renders the HTML in a browser. Pass update_token from a previous publish to update the same URL. With an aired API key, pages belong to your account (permanent by default) and you can update your own pages by id without a token. Change the PIN, expiry, view limit or title later with set_options.",
      inputSchema: {
      html: z.string().describe("HTML content to publish"),
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
      },
      outputSchema: outputShapes.publish_html,
      annotations: { title: "Publish HTML", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ html, title, pin, ttl_seconds, permanent, update_token, id: existingId }) => {
      if (signedIn !== null) {
        if (typeof update_token === "string" && typeof existingId !== "string") {
          return { content: [{ type: "text" as const, text: "When providing update_token, you must also provide the page id." }], isError: true };
        }
        if (typeof existingId === "string" && !PAGE_ID.test(existingId)) return badId();
        // Your own page by id: no token needed. Otherwise the API's publish,
        // which also accepts id + update_token.
        if (typeof existingId === "string" && typeof update_token !== "string") {
          const res = await callApi("PUT", `/api/pages/${encodeURIComponent(existingId)}`, { html, title });
          return res.status === 200 ? publishUpdateResult(res.body, signedIn.login) : apiErrorResult(res.status, res.body, origin);
        }
        const isTokenUpdate = typeof update_token === "string";
        const res = await callApi("POST", "/api/publish", {
          html,
          title,
          pin,
          ...(typeof ttl_seconds === "number" ? { ttl: ttl_seconds } : {}),
          ...(typeof permanent === "boolean" ? { permanent } : {}),
          ...(typeof update_token === "string" ? { update_token, id: existingId } : {}),
        });
        if (res.status !== 200) return apiErrorResult(res.status, res.body, origin);
        // A token update may be of a page the caller doesn't own: don't claim it's theirs.
        return isTokenUpdate ? publishUpdateResult(res.body, null) : publishResult(res.body, signedIn.login);
      }

      // Validate HTML
      const validation = validateHtml(html);
      if (!validation.ok) {
        return {
          content: [{ type: "text" as const, text: validation.error }],
          isError: true,
        };
      }

      const resolvedTitle = capTitle(title) ?? capTitle(extractTitle(html));

      // Anonymous remote MCP publishes (no API key) are always screened.
      const verdict = detectSpam(html, resolvedTitle);
      if (verdict.spam) {
        console.log({ event: "spam_rejected", route: "mcp", reason: verdict.reason });
        return {
          content: [{ type: "text" as const, text: SPAM_REJECTION }],
          isError: true,
        };
      }

      // Update path
      if (
        typeof update_token === "string" &&
        typeof existingId === "string"
      ) {
        // The page's D1 row decides its token (lib/page-write.ts loadPage),
        // never the KV record, which can be written back stale. Fail closed
        // if D1 can't be read.
        let page: LoadedPage | null;
        try {
          page = await loadPage(env, existingId);
        } catch (err) {
          console.error("pages lookup failed on MCP update", { id: existingId, err });
          return {
            content: [{ type: "text" as const, text: "Could not check this page's credentials. Please try again." }],
            isError: true,
          };
        }
        if (page === null) {
          return {
            content: [{ type: "text" as const, text: "Page not found" }],
            isError: true,
          };
        }
        const valid = await verifyToken(update_token, page.row.tokenHash);
        if (!valid) {
          return {
            content: [{ type: "text" as const, text: "Invalid update token" }],
            isError: true,
          };
        }

        // Same update as the API: title, size and expiry move with the HTML.
        const { metadata: updated, htmlEtag } = await updatePage(env, page, html, resolvedTitle);
        // Link-preview screenshot, after the response (lib/og-render.ts).
        background(refreshShot(env, existingId, updated, html, htmlEtag, { replacing: true }));

        return {
          content: [
            {
              type: "text" as const,
              text: `Updated ${origin}/p/${existingId}\nUpdate token: ${update_token}\nPass update_token and id to update again.`,
            },
          ],
          structuredContent: {
            id: existingId,
            url: `${origin}/p/${existingId}`,
            updated: true,
            update_token,
            expires_at: updated.expiresAt,
            owner: null,
            claim_url: null,
            upgrade_url: null,
          },
        };
      }

      if (typeof update_token === "string" && existingId === undefined) {
        return {
          content: [
            {
              type: "text" as const,
              text: "When providing update_token, you must also provide the page id.",
            },
          ],
          isError: true,
        };
      }

      // Create path
      const pageId = generateId();
      const token = generateToken();
      const tokenHash = await hashToken(token);
      const isPermanent = permanent === true;
      const ttlSeconds = isPermanent
        ? null
        : typeof ttl_seconds === "number" && ttl_seconds > 0
          ? Math.floor(ttl_seconds)
          : DEFAULT_TTL;

      const now = new Date();
      const expiresAt =
        ttlSeconds !== null
          ? new Date(now.getTime() + ttlSeconds * 1000).toISOString()
          : null;

      const metadata: PageMetadata = {
        id: pageId,
        title: resolvedTitle,
        size: new TextEncoder().encode(html).byteLength,
        tokenHash,
        // Stored as a salted PBKDF2 hash (lib/pin-hash.ts), never as typed.
        pin: typeof pin === "string" && pin.length > 0 ? await hashPin(pin) : null,
        reads: null,
        readCount: 0,
        permanent: isPermanent,
        createdAt: now.toISOString(),
        expiresAt,
        ownerId: null,
        // Anonymous (ownerId null) — never owner-indexed or grouped, so always Unsorted.
        project: null,
      };

      // D1 row, R2 HTML and KV cache record, or nothing (lib/page-write.ts).
      let htmlObj: R2Object | null;
      try {
        htmlObj = await createPage(env, metadata, html, now.getTime());
      } catch (err) {
        if (!(err instanceof StorageUnavailable)) throw err;
        console.error("MCP publish storage write failed", { id: pageId, err: err.message });
        return {
          content: [{ type: "text" as const, text: "Service temporarily unavailable. Try again later." }],
          isError: true,
        };
      }

      // Link-preview screenshot, after the response (lib/og-render.ts).
      background(refreshShot(env, pageId, metadata, html, htmlObj?.etag ?? null, { replacing: false }));

      // Increment publish counter (best effort)
      try {
        const stats = await loadStats(env.PAGES_KV);
        stats.publishes += 1;
        await saveStats(env.PAGES_KV, stats);
      } catch {
        // ignore
      }

      const lines: string[] = [
        `Published to ${origin}/p/${pageId}`,
        `Update token: ${token}`,
        expiresAt
          ? `Expires: ${new Date(expiresAt).toISOString().split("T")[0]}`
          : "Expires: never (permanent)",
        "",
        "Pass update_token and id to update the same URL.",
        `To keep this page in an aired account, open: ${claimUrl(origin, pageId, token)}`,
      ];

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent: {
          id: pageId,
          url: `${origin}/p/${pageId}`,
          updated: false,
          update_token: token,
          expires_at: expiresAt,
          owner: null,
          claim_url: claimUrl(origin, pageId, token),
          upgrade_url: null,
        },
      };
    },
  );

  // --- Page settings and feedback (signed in, or with the page's token) -----

  server.registerTool(
    "get_page",
    {
      title: "Get a page",
      description:
        "A page's details: title, URL, size, views, view limit, expiry, project, and whether a PIN is on (never the PIN). For your own pages, or any page whose update_token you pass.",
      inputSchema: {
        id: z.string().describe("Page id, from publish_html or list_pages"),
        update_token: z.string().optional().describe("The page's update token. Not needed for pages your account owns"),
      },
      outputSchema: outputShapes.get_page,
      annotations: { title: "Get a page", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, update_token }) => {
      if (!PAGE_ID.test(id)) return badId();
      if (signedIn === null && update_token === undefined) {
        return errorText(`Pass the page's update_token, or sign in. ${signInRequiredText(origin)}`);
      }
      const res = await callApi("GET", `/api/pages/${encodeURIComponent(id)}/details`, undefined, update_token ? { "X-Update-Token": update_token } : {});
      return res.status === 200 ? pageResult(res.body, origin) : apiErrorResult(res.status, res.body, origin);
    },
  );

  server.registerTool(
    "set_options",
    {
      title: "Change page settings",
      description:
        "Change a page's PIN (or remove it), expiry (a TTL, or permanent), view limit or title after publishing, without sending its HTML again. Send only what should change. For your own pages, or any page whose update_token you pass.",
      inputSchema: setOptionsInput,
      outputSchema: outputShapes.set_options,
      annotations: { title: "Change page settings", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      if (!PAGE_ID.test(args.id)) return badId();
      if (signedIn === null && args.update_token === undefined) {
        return errorText(`Pass the page's update_token, or sign in. ${signInRequiredText(origin)}`);
      }
      const res = await callApi("PATCH", `/api/pages/${encodeURIComponent(args.id)}`, patchBody(args));
      return res.status === 200 ? setOptionsResult(res.body, origin) : apiErrorResult(res.status, res.body, origin);
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
      if (res.status === 429 || res.status === 503) return errorText(String((res.body as { error?: unknown } | null)?.error ?? `The aired API answered ${res.status}.`));
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
      description: "Replace the HTML of one of your pages, keeping its URL (needs an API key; no update token).",
      inputSchema: {
        id: z.string().describe("Page id, from publish_html or list_pages"),
        html: z.string().describe("The new HTML"),
        title: z.string().optional().describe("New title"),
      },
      outputSchema: outputShapes.update_page,
      annotations: { title: "Update a page", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ id, html, title }) => {
      if (signedIn === null) return signInRequired(origin);
      if (!PAGE_ID.test(id)) return badId();
      const res = await callApi("PUT", `/api/pages/${encodeURIComponent(id)}`, { html, title });
      return res.status === 200 ? updateResult(res.body) : apiErrorResult(res.status, res.body, origin);
    },
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

  registerPrompts(server);
  registerResources(server, {
    origin,
    signedIn: signedIn !== null,
    get: (path) => callApi("GET", path),
    skill,
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
  const server = createAiredMcpServer(c.env, signedIn, callApi, (work) => c.executionCtx.waitUntil(work));
  const handler = createMcpHandler(server, { route });
  return handler(c.req.raw, c.env, c.executionCtx);
}
