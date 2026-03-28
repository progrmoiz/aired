import { Command } from "commander";
import { runPublish } from "./commands/publish.js";
import { runUpdate } from "./commands/update.js";
import { runDelete } from "./commands/delete.js";
import { runTokensList, runTokensPrune } from "./commands/tokens.js";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require("../package.json") as { version: string };

// Handle --mcp flag before Commander parses
if (process.argv.includes("--mcp")) {
  // Spawn the MCP stdio server (@aired/mcp package).
  // In the monorepo: the built mcp package is at apps/mcp/dist/index.js
  // relative to this CLI's dist directory.
  const { spawn } = require("node:child_process") as typeof import("node:child_process");
  const path = require("node:path") as typeof import("node:path");

  const mcpEntry = path.resolve(__dirname, "../../mcp/dist/index.js");

  const child = spawn(process.execPath, [mcpEntry], {
    stdio: "inherit",
    env: process.env,
  });

  child.on("error", (err: Error) => {
    process.stderr.write(`MCP server failed to start: ${err.message}\n`);
    process.stderr.write(`Make sure @aired/mcp is built: pnpm --filter @aired/mcp build\n`);
    process.exit(1);
  });

  child.on("exit", (code: number | null) => {
    process.exit(code ?? 0);
  });

  // Stop here — don't fall through to Commander setup.
  // The process lifetime is now tied to the child MCP server process.
} else {

const program = new Command();

program
  .name("aired")
  .description("Publish HTML artifacts to shareable URLs instantly")
  .version(pkg.version);

// Default publish command: aired [file] [options]
const publishCmd = new Command("publish")
  .alias("p")
  .description("Publish an HTML file (or pipe via stdin)")
  .argument("[file]", "Path to HTML file (omit to read stdin)")
  .option("--json", "Output as JSON (stdout)")
  .option("--api-url <url>", "Custom API URL (default: https://aired.sh)")
  .option("-t, --title <title>", "Custom title")
  .option("-p, --pin <pin>", "PIN-protect the page")
  .option("--ttl <duration>", "Expiry duration: 1h, 24h, 7d, 30d")
  .option("--permanent", "No expiry")
  .option("--reads <n>", "Max read count before page is gone")
  .action(async (file: string | undefined, opts: {
    title?: string;
    pin?: string;
    ttl?: string;
    permanent?: boolean;
    reads?: string;
    json?: boolean;
    apiUrl?: string;
  }) => {
    await runPublish(file, opts);
  });

program.addCommand(publishCmd, { isDefault: true });

// aired update <id> <file>
program
  .command("update <id> <file>")
  .description("Update an existing page using the stored token")
  .option("-t, --title <title>", "New title")
  .option("--json", "Output as JSON")
  .option("--api-url <url>", "Custom API URL")
  .action(async (id: string, file: string, opts: {
    title?: string;
    json?: boolean;
    apiUrl?: string;
  }) => {
    await runUpdate(id, file, opts);
  });

// aired delete <id>
program
  .command("delete <id>")
  .description("Delete a page using the stored token")
  .option("--json", "Output as JSON")
  .option("--api-url <url>", "Custom API URL")
  .action(async (id: string, opts: { json?: boolean; apiUrl?: string }) => {
    await runDelete(id, opts);
  });

// aired tokens (and aired tokens prune)
const tokensCmd = new Command("tokens")
  .description("List stored tokens")
  .option("--json", "Output as JSON")
  .option("--api-url <url>", "Custom API URL")
  .action(async (opts: { json?: boolean; apiUrl?: string }) => {
    await runTokensList(opts);
  });

tokensCmd
  .command("prune")
  .description("Remove tokens for pages that no longer exist")
  .option("--json", "Output as JSON")
  .option("--api-url <url>", "Custom API URL")
  .action(async (opts: { json?: boolean; apiUrl?: string }) => {
    await runTokensPrune(opts);
  });

program.addCommand(tokensCmd);

program.parse(process.argv);

} // end else (non-mcp path)
