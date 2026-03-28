import Conf from "conf";
import { pageExists } from "./api-client.js";

export interface TokenRecord {
  token: string;
  title: string | null;
  url: string;
  created: string;
}

type TokenStore = Record<string, TokenRecord>;

// Lazy-initialize to avoid side effects at import time
let _conf: Conf<TokenStore> | null = null;

function getConf(): Conf<TokenStore> {
  if (_conf === null) {
    _conf = new Conf<TokenStore>({
      projectName: "aired",
      configName: "tokens",
      cwd: `${process.env["HOME"] ?? "~"}/.config/aired`,
      fileExtension: "json",
      configFileMode: 0o600,
      defaults: {},
    });
  }
  return _conf;
}

export function saveToken(
  id: string,
  token: string,
  meta: { title?: string | null; url: string },
): void {
  const conf = getConf();
  const record: TokenRecord = {
    token,
    title: meta.title ?? null,
    url: meta.url,
    created: new Date().toISOString(),
  };
  conf.set(id, record);
}

export function getToken(id: string): string | null {
  const conf = getConf();
  const record = conf.get(id);
  if (record === undefined) return null;
  return record.token;
}

export function getRecord(id: string): TokenRecord | null {
  const conf = getConf();
  const record = conf.get(id);
  if (record === undefined) return null;
  return record;
}

export function listTokens(): Array<{ id: string } & TokenRecord> {
  const conf = getConf();
  const store = conf.store;
  return Object.entries(store).map(([id, record]) => ({ id, ...record }));
}

export function removeToken(id: string): void {
  const conf = getConf();
  conf.delete(id);
}

export async function pruneExpired(options: { apiUrl?: string } = {}): Promise<number> {
  const tokens = listTokens();
  let pruned = 0;

  await Promise.all(
    tokens.map(async (entry) => {
      const exists = await pageExists(entry.id, options);
      if (!exists) {
        removeToken(entry.id);
        pruned++;
      }
    }),
  );

  return pruned;
}
