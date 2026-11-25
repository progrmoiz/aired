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
import { pageCredentials } from "../lib/claim-decision.js";
import { getClaim } from "../lib/page-claims.js";

function createAiredMcpServer(env: {
  PAGES_BUCKET: R2Bucket;
  PAGES_KV: KVNamespace;
  DB: D1Database;
  SITE_ORIGIN?: string;
}) {
  const server = new McpServer({
    name: "aired",
    version: "1.0.0",
  });

  server.tool(
    "publish_html",
    "Publish HTML to a shareable URL. Returns a live URL that renders the HTML in a browser. Pass update_token from a previous publish to update the same URL.",
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

      // Remote MCP publishes are always anonymous, so every one is screened.
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
          tokenHash = pageCredentials(
            metadata.ownerId,
            metadata.tokenHash,
            await getClaim(env.DB, existingId),
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
        pin: typeof pin === "string" && pin.length > 0 ? pin : null,
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

  return server;
}

/**
 * Handle MCP Streamable HTTP requests at /mcp.
 * Creates a new McpServer instance per request (required by SDK 1.26.0+).
 */
export async function handleMcp(c: Context<AppBindings>) {
  const server = createAiredMcpServer(c.env);
  const handler = createMcpHandler(server, { route: "/mcp" });
  return handler(c.req.raw, c.env, c.executionCtx);
}
