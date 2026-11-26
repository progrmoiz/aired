import { STATE_KEY, parseBackupState, runBackupStep, trashKey, type BackupDeps } from "./backup.ts";
import { log } from "./log.js";
import type { Env } from "../types.js";

/**
 * The Worker bindings behind lib/backup.ts and the sweep's copy-before-delete.
 * Kept apart from backup.ts so that file stays free of runtime imports.
 */
export function backupDeps(env: Env, bucket: R2Bucket): BackupDeps {
  return {
    loadState: async () => parseBackupState((await (await bucket.get(STATE_KEY))?.text()) ?? null),
    saveState: async (state) => {
      await bucket.put(STATE_KEY, JSON.stringify(state), { httpMetadata: { contentType: "application/json" } });
    },
    writeFile: async (key, body) => {
      await bucket.put(key, body, { httpMetadata: { contentType: "application/json" } });
    },
    kvList: async (prefix, cursor, limit) => {
      const res = await env.PAGES_KV.list({ prefix, limit, ...(cursor ? { cursor } : {}) });
      return {
        keys: res.keys.map((k) => (k.expiration !== undefined ? { name: k.name, expiration: k.expiration } : { name: k.name })),
        cursor: res.list_complete ? null : res.cursor,
      };
    },
    kvGetMany: (keys) => env.PAGES_KV.get(keys),
    listTables: async () =>
      (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>()).results.map((r) => r.name),
    d1Rows: async (table, after, limit) =>
      (
        await env.DB
          .prepare(`SELECT rowid AS __rowid, * FROM "${table.replace(/"/g, '""')}" WHERE rowid > ? ORDER BY rowid LIMIT ?`)
          .bind(after, limit)
          .all<Record<string, unknown>>()
      ).results,
    log: ({ event, level, ...fields }) => log(level === "error" ? "error" : "info", String(event), fields),
  };
}

/** The nightly KV + D1 snapshot, a few chunks per cron run (lib/backup.ts). */
export async function runBackup(env: Env): Promise<void> {
  if (!env.BACKUP_BUCKET) {
    log("warn", "backup_unconfigured", {});
    return;
  }
  const result = await runBackupStep(backupDeps(env, env.BACKUP_BUCKET), Date.now());
  if (result.status !== "idle") log("info", "backup_step", result);
}

/**
 * The sweep's safety copy: each file goes to `trash/` in the backup bucket
 * if it still has the etag the sweep judged it by. A file already gone counts
 * as safe (there's nothing left to lose). Without a backup bucket nothing is
 * safe, so the sweep deletes nothing.
 */
export async function preserveSweptFiles(env: Env, files: Array<{ key: string; etag: string }>): Promise<string[]> {
  const backup = env.BACKUP_BUCKET;
  if (!backup) throw new Error("BACKUP_BUCKET is not bound");
  const safe: string[] = [];
  for (const f of files) {
    try {
      const obj = await env.PAGES_BUCKET.get(f.key);
      if (obj === null) {
        safe.push(f.key);
        continue;
      }
      if (obj.etag !== f.etag) continue; // rewritten since: the sweep will look again
      await backup.put(trashKey(f.key), await obj.arrayBuffer(), {
        httpMetadata: obj.httpMetadata,
        customMetadata: { ...obj.customMetadata, sweptAt: new Date().toISOString(), etag: f.etag },
      });
      safe.push(f.key);
    } catch (err) {
      log("warn", "expired_sweep_copy_failed", { key: f.key, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return safe;
}
