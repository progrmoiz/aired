import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { z } from "zod";

const DEFAULT_API_URL = "https://aired.sh";

interface PublishResult {
  id: string;
  url: string;
  update_token: string;
  expiresAt: string | null;
}

async function publishHTML(
  html: string,
  options: {
    title?: string;
    pin?: string;
    ttl?: number;
    permanent?: boolean;
    update_token?: string;
    id?: string;
    apiUrl?: string;
  } = {},
): Promise<PublishResult> {
  const base = options.apiUrl ?? process.env["AIRED_API_URL"] ?? DEFAULT_API_URL;
  const body: Record<string, unknown> = { html };

  if (options.title !== undefined) body["title"] = options.title;
  if (options.pin !== undefined) body["pin"] = options.pin;
  if (options.ttl !== undefined) body["ttl"] = options.ttl;
  if (options.permanent === true) body["permanent"] = true;
  if (options.update_token !== undefined) body["update_token"] = options.update_token;
  if (options.id !== undefined) body["id"] = options.id;

  const resp = await fetch(`${base}/api/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (resp.status === 429) {
    throw new Error("Rate limited: too many uploads. Try again in an hour.");
  }

  if (!resp.ok) {
    let message = `Publish failed (${resp.status})`;
    try {
      const errorBody = await resp.json() as Record<string, unknown>;
      if (typeof errorBody["error"] === "string") {
        message = errorBody["error"];
      }
    } catch {
      // ignore parse error
    }
    throw new Error(message);
  }

  try {
    return await resp.json() as PublishResult;
  } catch {
    throw new Error("Publish: unexpected response format");
  }
}

const server = new McpServer({
  name: "aired",
  version: "0.0.1",
});

server.tool(
  "publish_html",
  "Publish an HTML file or string to a shareable URL. Returns a live URL that renders the HTML in a browser. Pass update_token from a previous publish to update the same URL.",
  {
    html: z.string().optional().describe("HTML content to publish"),
    file_path: z.string().optional().describe("Path to HTML file (alternative to html)"),
    title: z.string().optional().describe("Page title"),
    pin: z.string().optional().describe("PIN to protect access"),
    ttl_seconds: z.number().optional().describe("Time to live in seconds (default: 604800 = 7 days)"),
    permanent: z.boolean().optional().describe("If true, page never expires"),
    update_token: z.string().optional().describe("Pass a previously returned token to update the same URL instead of creating a new one"),
    id: z.string().optional().describe("Page ID — required when update_token is provided to update the same URL"),
  },
  async ({ html, file_path, title, pin, ttl_seconds, permanent, update_token, id }) => {
    // Resolve HTML content
    let content: string;

    if (html !== undefined) {
      content = html;
    } else if (file_path !== undefined) {
      try {
        content = readFileSync(file_path, "utf-8");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error reading file: ${message}` }],
          isError: true,
        };
      }
    } else {
      return {
        content: [{ type: "text", text: "Either html or file_path is required." }],
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
      const result = await publishHTML(content, {
        title,
        pin,
        ttl: ttl_seconds,
        permanent,
        update_token,
        id,
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

      return {
        content: [{ type: "text", text: lines.join("\n") }],
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
