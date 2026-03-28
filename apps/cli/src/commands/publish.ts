import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { publishHTML } from "../api-client.js";
import { saveToken } from "../store.js";

function parseTtl(ttl: string): number | null {
  const match = /^(\d+)(h|d|m)?$/i.exec(ttl);
  if (!match) return null;
  const n = parseInt(match[1]!, 10);
  const unit = (match[2] ?? "s").toLowerCase();
  if (unit === "h") return n * 3600;
  if (unit === "d") return n * 86400;
  if (unit === "m") return n * 60;
  return n;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", reject);
  });
}

function formatExpiry(expiresAt: string | null): string {
  if (expiresAt === null) return "Never (permanent)";
  const d = new Date(expiresAt);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

interface PublishCommandOptions {
  title?: string;
  pin?: string;
  ttl?: string;
  permanent?: boolean;
  reads?: string;
  token?: string;
  json?: boolean;
  apiUrl?: string;
}

export async function runPublish(
  filePath: string | undefined,
  opts: PublishCommandOptions,
): Promise<void> {
  let html: string;

  if (filePath === undefined || filePath === "-") {
    // Read from stdin
    if (process.stdin.isTTY) {
      process.stderr.write("Error: provide a file path or pipe HTML via stdin\n");
      process.exit(2);
    }
    html = await readStdin();
  } else {
    try {
      html = await readFile(resolve(filePath), "utf-8");
    } catch (err) {
      process.stderr.write(`Error: cannot read file '${filePath}': ${(err as Error).message}\n`);
      process.exit(1);
    }
  }

  const publishOptions: Parameters<typeof publishHTML>[1] = {
    apiUrl: opts.apiUrl,
  };

  if (opts.title !== undefined) publishOptions.title = opts.title;
  if (opts.pin !== undefined) publishOptions.pin = opts.pin;
  if (opts.permanent === true) {
    publishOptions.permanent = true;
  } else if (opts.ttl !== undefined) {
    const ttlSeconds = parseTtl(opts.ttl);
    if (ttlSeconds === null || ttlSeconds <= 0) {
      process.stderr.write(`Error: invalid --ttl value '${opts.ttl}'. Use formats like 1h, 24h, 7d, 30d\n`);
      process.exit(2);
    }
    publishOptions.ttl = ttlSeconds;
  }

  if (opts.reads !== undefined) {
    const reads = parseInt(opts.reads, 10);
    if (isNaN(reads) || reads <= 0) {
      process.stderr.write(`Error: --reads must be a positive integer\n`);
      process.exit(2);
    }
    publishOptions.reads = reads;
  }

  // If --token is provided, pass it as update_token
  if (opts.token !== undefined) {
    publishOptions.update_token = opts.token;
    // We need the id too — extract from token store or require user to use `aired update`
    // The blueprint says: if --token provided, include update_token + id in publish request
    // But we need the id — user must also pass it implicitly. For now, we require the store
    // to have the token saved so we can look up the id.
    // Actually re-reading the blueprint: "If --token provided: include update_token + id"
    // The user must pass both via --token. But the worker's POST /api/publish requires id too.
    // For the publish command, if token is provided without a stored id, we can't update.
    // The `aired update <id> <file>` command is the clean path for updates from the store.
    // For --token flag on publish, we note this limitation and require `aired update` instead.
    process.stderr.write("Use 'aired update <id> <file>' to update an existing page.\n");
    process.exit(2);
  }

  try {
    const result = await publishHTML(html, publishOptions);

    // Save token to store
    saveToken(result.id, result.update_token, {
      title: opts.title ?? null,
      url: result.url,
    });

    if (opts.json === true) {
      process.stdout.write(JSON.stringify(result) + "\n");
    } else {
      process.stdout.write(`\nPublished! ${result.url}\n`);
      process.stdout.write(`Token: ${result.update_token} (saved to ~/.config/aired/tokens.json)\n`);
      if (result.expiresAt !== null) {
        process.stdout.write(`Expires: ${formatExpiry(result.expiresAt)}\n`);
      } else {
        process.stdout.write(`Expires: Never (permanent)\n`);
      }
      process.stdout.write(`\n`);
      process.stdout.write(`Update: npx aired update ${result.id} new-file.html\n`);
      process.stdout.write(`Delete: npx aired delete ${result.id}\n`);
    }
  } catch (err) {
    const error = err as NodeJS.ErrnoException & Error;
    if (error.code === "RATE_LIMITED") {
      process.stderr.write(`Error: ${error.message}\n`);
      process.exit(3);
    }
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(1);
  }
}
