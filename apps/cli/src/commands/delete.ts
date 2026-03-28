import { deletePage } from "../api-client.js";
import { getToken, removeToken } from "../store.js";

interface DeleteCommandOptions {
  json?: boolean;
  apiUrl?: string;
}

export async function runDelete(id: string, opts: DeleteCommandOptions): Promise<void> {
  const token = getToken(id);
  if (token === null) {
    process.stderr.write(
      `Error: no token found for page '${id}'. Run 'aired tokens' to list stored tokens.\n`,
    );
    process.exit(1);
  }

  try {
    await deletePage(id, token, { apiUrl: opts.apiUrl });

    removeToken(id);

    if (opts.json === true) {
      process.stdout.write(JSON.stringify({ ok: true, id }) + "\n");
    } else {
      process.stdout.write(`Deleted page ${id}\n`);
    }
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
