import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
  parseMetadata,
  serializeMetadata,
  DEFAULT_TTL,
} from "@aired/core";
import type { PageMetadata } from "@aired/core";
import { authoritativeCredentials } from "../lib/claim-decision.js";
import { getClaim } from "../lib/page-claims.js";
import { hashPin } from "../lib/pin-hash.js";
import { UPGRADE_URL, billingEnabled } from "../lib/entitlements.js";
import { TIERS } from "../lib/rate-limit-tiers.js";
import {
  SIGN_IN_REQUIRED,
  accountResult,
  apiErrorResult,
  deleteResult,
  listResult,
  publishResult,
  updateResult,
  type ToolResult,
} from "../lib/mcp-account.js";

/**
 * A caller signed in with an API key. Their tool calls go to the HTTP API
 * with the same key (callApi), so the API's ownership, plan limits, rate
 * limits and claim rules apply exactly as for any other key request.
 */
type SignedIn = {
  login: string;
  origin: string;
  callApi: (method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown) => Promise<{ status: number; body: unknown }>;
};

const signInRequired = (): ToolResult => ({ content: [{ type: "text", text: SIGN_IN_REQUIRED }], isError: true });

/** Page ids as generateId makes them; anything else never reaches the API path. */
const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const badId = (): ToolResult => ({ content: [{ type: "text", text: "That isn't a page id." }], isError: true });

function createAiredMcpServer(
  env: {
    PAGES_BUCKET: R2Bucket;
    PAGES_KV: KVNamespace;
    DB: D1Database;
    SITE_ORIGIN?: string;
    BILLING_ENABLED?: string;
  },
  signedIn: SignedIn | null,
) {
  const server = new McpServer({
    name: "aired",
    version: "1.0.0",
  });

  server.tool(
    "publish_html",
    "Publish HTML to a shareable URL. Returns a live URL that renders the HTML in a browser. Pass update_token from a previous publish to update the same URL. With an aired API key, pages belong to your account (permanent by default) and you can update your own pages by id without a token.",
    {
      html: z.string().describe("HTML content to publish"),
      title: z.string().optional().describe("Page title"),
      pin: z.string().optional().describe("PIN to protect access"),
      ttl_seconds: z
        .number()
        .optional()
        .describe("Time to live in seconds (default: 604800 = 7 days)"),
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
    async ({ html, title, pin, ttl_seconds, permanent, update_token, id: existingId }) => {
      if (signedIn !== null) {
        if (typeof update_token === "string" && typeof existingId !== "string") {
          return { content: [{ type: "text" as const, text: "When providing update_token, you must also provide the page id." }], isError: true };
        }
        if (typeof existingId === "string" && !PAGE_ID.test(existingId)) return badId();
        // Your own page by id: no token needed. Otherwise the API's publish,
        // which also accepts id + update_token.
        if (typeof existingId === "string" && typeof update_token !== "string") {
          const res = await signedIn.callApi("PUT", `/api/pages/${encodeURIComponent(existingId)}`, { html, title });
          return res.status === 200 ? updateResult(res.body) : apiErrorResult(res.status, res.body);
        }
        const isTokenUpdate = typeof update_token === "string";
        const res = await signedIn.callApi("POST", "/api/publish", {
          html,
          title,
          pin,
          ...(typeof ttl_seconds === "number" ? { ttl: ttl_seconds } : {}),
          ...(typeof permanent === "boolean" ? { permanent } : {}),
          ...(typeof update_token === "string" ? { update_token, id: existingId } : {}),
        });
        if (res.status !== 200) return apiErrorResult(res.status, res.body);
        // A token update may be of a page the caller doesn't own: don't claim it's theirs.
        return isTokenUpdate ? updateResult(res.body) : publishResult(res.body, signedIn.login);
      }

      // Validate HTML
      const validation = validateHtml(html);
      if (!validation.ok) {
        return {
          content: [{ type: "text" as const, text: validation.error }],
          isError: true,
        };
      }

      const resolvedTitle =
        (title && title.trim() ? title.trim() : null) ?? extractTitle(html);

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
        const raw = await env.PAGES_KV.get(`page:${existingId}`);
        if (raw === null) {
          return {
            content: [{ type: "text" as const, text: "Page not found" }],
            isError: true,
          };
        }

        const metadata = parseMetadata(raw);
        if (metadata === null) {
          return {
            content: [{ type: "text" as const, text: "Page metadata is corrupted" }],
            isError: true,
          };
        }

        // A claimed page's D1 row wins over its KV record, which can be
        // written back stale. Fail closed if D1 can't be read.
        let tokenHash: string;
        try {
          tokenHash = (
            await authoritativeCredentials(
              () => getClaim(env.DB, existingId),
              metadata.ownerId,
              metadata.tokenHash,
            )
          ).tokenHash;
        } catch (err) {
          console.error("page_claims lookup failed on MCP update", { id: existingId, err });
          return {
            content: [{ type: "text" as const, text: "Could not check this page's credentials. Please try again." }],
            isError: true,
          };
        }
        const valid = await verifyToken(update_token, tokenHash);
        if (!valid) {
          return {
            content: [{ type: "text" as const, text: "Invalid update token" }],
            isError: true,
          };
        }

        await env.PAGES_BUCKET.put(
          `pages/${existingId}/index.html`,
          html,
          { httpMetadata: { contentType: "text/html; charset=utf-8" } },
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Updated https://aired.sh/p/${existingId}\nUpdate token: ${update_token}\nPass update_token and id to update again.`,
            },
          ],
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

      await env.PAGES_BUCKET.put(`pages/${pageId}/index.html`, html, {
        httpMetadata: { contentType: "text/html; charset=utf-8" },
      });

      const kvOptions: KVNamespacePutOptions = {};
      if (ttlSeconds !== null) {
        kvOptions.expirationTtl = ttlSeconds;
      }
      await env.PAGES_KV.put(
        `page:${pageId}`,
        serializeMetadata(metadata),
        kvOptions,
      );

      // Increment publish counter (best effort)
      try {
        const stats = await loadStats(env.PAGES_KV);
        stats.publishes += 1;
        await saveStats(env.PAGES_KV, stats);
      } catch {
        // ignore
      }

      const lines: string[] = [
        `Published to https://aired.sh/p/${pageId}`,
        `Update token: ${token}`,
        expiresAt
          ? `Expires: ${new Date(expiresAt).toISOString().split("T")[0]}`
          : "Expires: never (permanent)",
        "",
        "Pass update_token and id to update the same URL.",
        `To keep this page in an aired account, open: ${claimUrl(env.SITE_ORIGIN, pageId, token)}`,
      ];

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );

  // --- Signed-in tools (need an API key) -------------------------------------

  server.tool(
    "list_pages",
    "List your pages on aired (needs an API key): id, URL, title, views, expiry.",
    {
      cursor: z.string().optional().describe("From a previous list_pages answer, for the next page of results"),
      project: z.string().optional().describe("Only pages in this project"),
    },
    async ({ cursor, project }) => {
      if (signedIn === null) return signInRequired();
      const q = new URLSearchParams();
      if (cursor) q.set("cursor", cursor);
      if (project) q.set("project", project);
      const res = await signedIn.callApi("GET", `/api/me/pages${q.size ? `?${q}` : ""}`);
      return res.status === 200 ? listResult(res.body, signedIn.origin) : apiErrorResult(res.status, res.body);
    },
  );

  server.tool(
    "update_page",
    "Replace the HTML of one of your pages, keeping its URL (needs an API key; no update token).",
    {
      id: z.string().describe("Page id, from publish_html or list_pages"),
      html: z.string().describe("The new HTML"),
      title: z.string().optional().describe("New title"),
    },
    async ({ id, html, title }) => {
      if (signedIn === null) return signInRequired();
      if (!PAGE_ID.test(id)) return badId();
      const res = await signedIn.callApi("PUT", `/api/pages/${encodeURIComponent(id)}`, { html, title });
      return res.status === 200 ? updateResult(res.body) : apiErrorResult(res.status, res.body);
    },
  );

  server.tool(
    "delete_page",
    "Delete one of your pages for good (needs an API key). The link stops working.",
    { id: z.string().describe("Page id, from publish_html or list_pages") },
    async ({ id }) => {
      if (signedIn === null) return signInRequired();
      if (!PAGE_ID.test(id)) return badId();
      const res = await signedIn.callApi("DELETE", `/api/pages/${encodeURIComponent(id)}`);
      return res.status === 200 ? deleteResult(id) : apiErrorResult(res.status, res.body);
    },
  );

  server.tool(
    "get_account",
    "Your aired account (needs an API key): plan, limits, renewal, and an upgrade link for a person to open.",
    {},
    async () => {
      if (signedIn === null) return signInRequired();
      const res = await signedIn.callApi("GET", "/api/me");
      return res.status === 200
        ? accountResult(res.body, {
            upgradeUrl: billingEnabled(env) ? `${UPGRADE_URL}?ref=mcp` : null,
            freePublishLimit: `${TIERS.authenticated.limit} an hour`,
            proPublishLimit: `${TIERS.pro.limit} a day`,
          })
        : apiErrorResult(res.status, res.body);
    },
  );

  return server;
}

/** Sends a Request through the whole app (auth, limits, routes), in-process. */
export type AppFetch = (request: Request) => Response | Promise<Response>;

/**
 * Handle MCP Streamable HTTP requests at /mcp.
 * Creates a new McpServer instance per request (required by SDK 1.26.0+).
 * Only an API key signs a caller in here (never a cookie), so a cross-site
 * request can't act as anyone; everyone else gets the anonymous tools.
 */
export async function handleMcp(c: Context<AppBindings>, appFetch: AppFetch) {
  const user = c.get("user");
  const authorization = c.req.header("Authorization");
  const signedIn: SignedIn | null =
    user !== null && c.get("authMethod") === "key" && authorization
      ? {
          login: user.login,
          origin: new URL(c.req.url).origin,
          callApi: async (method, path, body) => {
            const headers = new Headers({ Authorization: authorization, "User-Agent": "aired-mcp" });
            const ip = c.req.header("CF-Connecting-IP");
            if (ip) headers.set("CF-Connecting-IP", ip);
            if (body !== undefined) headers.set("Content-Type", "application/json");
            const res = await appFetch(
              new Request(new URL(path, c.req.url), {
                method,
                headers,
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
              }),
            );
            return { status: res.status, body: await res.json().catch(() => null) };
          },
        }
      : null;
  const server = createAiredMcpServer(c.env, signedIn);
  const handler = createMcpHandler(server, { route: "/mcp" });
  return handler(c.req.raw, c.env, c.executionCtx);
}
