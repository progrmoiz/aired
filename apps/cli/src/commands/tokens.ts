import { listTokens, pruneExpired } from "../store.js";

interface TokensCommandOptions {
  json?: boolean;
  apiUrl?: string;
}

export async function runTokensList(opts: TokensCommandOptions): Promise<void> {
  const tokens = listTokens();

  if (tokens.length === 0) {
    if (opts.json === true) {
      process.stdout.write(JSON.stringify([]) + "\n");
    } else {
      process.stdout.write("No tokens stored. Publish a page first.\n");
    }
    return;
  }

  if (opts.json === true) {
    const output = tokens.map((t) => ({
      id: t.id,
      title: t.title,
      url: t.url,
      created: t.created,
    }));
    process.stdout.write(JSON.stringify(output) + "\n");
    return;
  }

  // Human-readable table
  const idWidth = Math.max(10, ...tokens.map((t) => t.id.length));
  const titleWidth = Math.max(20, ...tokens.map((t) => (t.title ?? "(untitled)").length));
  const urlWidth = Math.max(30, ...tokens.map((t) => t.url.length));

  const pad = (s: string, w: number) => s.padEnd(w);

  process.stdout.write(
    `${pad("ID", idWidth)}  ${pad("TITLE", titleWidth)}  ${pad("URL", urlWidth)}  CREATED\n`,
  );
  process.stdout.write(
    `${"-".repeat(idWidth)}  ${"-".repeat(titleWidth)}  ${"-".repeat(urlWidth)}  ${"-".repeat(24)}\n`,
  );

  for (const t of tokens) {
    const title = t.title ?? "(untitled)";
    const created = new Date(t.created).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    process.stdout.write(
      `${pad(t.id, idWidth)}  ${pad(title, titleWidth)}  ${pad(t.url, urlWidth)}  ${created}\n`,
    );
  }
}

export async function runTokensPrune(opts: TokensCommandOptions): Promise<void> {
  process.stderr.write("Checking pages...\n");

  const pruned = await pruneExpired({ apiUrl: opts.apiUrl });

  if (opts.json === true) {
    process.stdout.write(JSON.stringify({ pruned }) + "\n");
  } else {
    if (pruned === 0) {
      process.stdout.write("Nothing to prune. All pages are still alive.\n");
    } else {
      process.stdout.write(`Pruned ${pruned} expired token${pruned === 1 ? "" : "s"}.\n`);
    }
  }
}
