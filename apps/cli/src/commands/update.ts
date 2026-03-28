import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { updatePage } from "../api-client.js";
import { getToken, saveToken } from "../store.js";

interface UpdateCommandOptions {
  title?: string;
  json?: boolean;
  apiUrl?: string;
}

export async function runUpdate(
  id: string,
  filePath: string,
  opts: UpdateCommandOptions,
): Promise<void> {
  const token = getToken(id);
  if (token === null) {
    process.stderr.write(
      `Error: no token found for page '${id}'. Run 'aired tokens' to list stored tokens.\n`,
    );
    process.exit(1);
  }

  let html: string;
  try {
    html = await readFile(resolve(filePath), "utf-8");
  } catch (err) {
    process.stderr.write(`Error: cannot read file '${filePath}': ${(err as Error).message}\n`);
    process.exit(1);
  }

  try {
    const result = await updatePage(id, html, token, {
      title: opts.title,
      apiUrl: opts.apiUrl,
    });

    // Update the stored record with any new info
    saveToken(result.id, result.update_token, {
      title: opts.title ?? null,
      url: result.url,
    });

    if (opts.json === true) {
      process.stdout.write(JSON.stringify(result) + "\n");
    } else {
      process.stdout.write(`\nUpdated! ${result.url}\n`);
      if (result.expiresAt !== null) {
        const d = new Date(result.expiresAt);
        const formatted = d.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
        process.stdout.write(`Expires: ${formatted}\n`);
      }
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
