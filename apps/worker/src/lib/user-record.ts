/**
 * The account record in KV (user:<id>), read in one place. Sessions, API
 * keys, MCP OAuth calls and the CLI device flow all sign in from it, and an
 * account without one (deleted) signs nobody in.
 */
import { kvKeys, redactNoreplyEmail } from '@aired/core';

export type AccountRecord = {
  id: number;
  login: string;
  email: string | null;
  name: string | null;
  /** ISO time the record was first written, when known. */
  createdAt: string | null;
};

/** Parse a stored record; null if it's missing or not an account. */
export function parseUserRecord(id: number, raw: string | null): AccountRecord | null {
  if (raw === null) return null;
  let r: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    r = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof r.login !== 'string' || r.login === '') return null;
  return {
    id,
    login: r.login,
    email: typeof r.email === 'string' ? r.email : null,
    name: typeof r.name === 'string' ? r.name : null,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : null,
  };
}

export async function loadUserRecord(kv: KVNamespace, id: number): Promise<AccountRecord | null> {
  return parseUserRecord(id, await kv.get(kvKeys.user(id)));
}

/** The signed-in user as requests see it (no GitHub noreply addresses). */
export function signedInUser(record: AccountRecord): { id: number; login: string; email: string | null; name: string | null } {
  return { id: record.id, login: record.login, email: redactNoreplyEmail(record.email), name: record.name };
}
