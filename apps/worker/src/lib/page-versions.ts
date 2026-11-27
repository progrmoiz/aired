import { parseSidecar, sidecarKey, type DocSidecar, type PageKind } from "./page-content.ts";
import { ALWAYS_KEEP, MOST_VERSIONS, PRUNE_BATCH, VERSION_LIMITS } from "./version-limits.ts";

/**
 * Page history: D1 `page_versions` (migration 0016) and the copies in R2.
 *
 * Every content a page has had is a numbered version. The live one is the
 * row with current = 1, and its HTML is the page's own file. When an update
 * (publish with a token, PUT, update_page, a restore) replaces it, updatePage
 * (lib/page-write.ts) calls saveVersion: the old HTML, and the Markdown or
 * deck sidecar if there is one, are copied to pages/<id>/versions/<key>.html
 * and .doc.json, then one D1 batch turns the old row into a kept version and
 * adds the new live row. A restore is an update whose content is an old
 * version's, so history only grows.
 *
 * What is kept depends on the page owner's plan (lib/version-limits.ts): the
 * count on every update (trimVersions), the days in hourly housekeeping
 * (pruneVersions), which also clears the history of deleted and expired
 * pages and of deleted accounts.
 *
 * Two updates of one page at the same moment both get versions, but which
 * content each copy holds follows R2's order, not D1's: the same race the
 * page itself already has (the last write wins).
 */

export type VersionActor = "owner" | "token" | "agent" | "unknown";
export type VersionClient = "web" | "cli" | "mcp" | "api";

/** Who made a version and why, as the update's request tells it. */
export type VersionAuthor = {
  actor: VersionActor;
  client: VersionClient | null;
  message: string | null;
  /** For a restore: the version whose content this is. */
  restoredFrom?: number | null;
};

export const UNKNOWN_AUTHOR: VersionAuthor = { actor: "unknown", client: null, message: null };

/**
 * The author of an update: `token` when the update token authorized it,
 * `agent` when it came through an MCP server (hosted or stdio), else the
 * signed-in `owner` (dashboard, CLI sign-in or API key). The client comes
 * from the User-Agent the CLI and MCP servers send, and the sign-in kind.
 */
export function versionAuthor(input: {
  viaToken: boolean;
  via: string | null;
  userAgent: string | undefined;
  message?: string | null;
  restoredFrom?: number | null;
}): VersionAuthor {
  const ua = input.userAgent ?? "";
  const client: VersionClient =
    ua.startsWith("aired-mcp") || input.via === "oauth" ? "mcp" : ua.startsWith("aired/") ? "cli" : input.via === "cookie" ? "web" : "api";
  const actor: VersionActor = input.viaToken ? "token" : client === "mcp" ? "agent" : "owner";
  const message = typeof input.message === "string" && input.message.trim() !== "" ? input.message.trim() : null;
  return { actor, client, message, ...(input.restoredFrom != null ? { restoredFrom: input.restoredFrom } : {}) };
}

export type PageVersion = {
  pageId: string;
  version: number;
  current: boolean;
  /** Where the copy is (add .html / .doc.json); null for the live version. */
  objectKey: string | null;
  hasSidecar: boolean;
  size: number;
  title: string | null;
  kind: PageKind;
  actor: VersionActor;
  client: VersionClient | null;
  message: string | null;
  restoredFrom: number | null;
  /** Unix ms it went live; null for content from before history was kept. */
  createdAt: number | null;
  replacedAt: number | null;
  keepUntil: number | null;
};

type DbVersion = {
  page_id: string;
  version: number;
  current: number;
  object_key: string | null;
  has_sidecar: number;
  size: number;
  title: string | null;
  kind: string;
  actor: string;
  client: string | null;
  message: string | null;
  restored_from: number | null;
  created_at: number | null;
  replaced_at: number | null;
  keep_until: number | null;
};

const COLS = "page_id, version, current, object_key, has_sidecar, size, title, kind, actor, client, message, restored_from, created_at, replaced_at, keep_until";

const ACTORS: readonly string[] = ["owner", "token", "agent", "unknown"];
const CLIENTS: readonly string[] = ["web", "cli", "mcp", "api"];

function fromDb(r: DbVersion): PageVersion {
  return {
    pageId: r.page_id,
    version: Number(r.version),
    current: Number(r.current) === 1,
    objectKey: r.object_key,
    hasSidecar: Number(r.has_sidecar) === 1,
    size: Number(r.size),
    title: r.title,
    kind: r.kind === "doc" || r.kind === "deck" ? r.kind : "page",
    actor: (ACTORS.includes(r.actor) ? r.actor : "unknown") as VersionActor,
    client: r.client !== null && CLIENTS.includes(r.client) ? (r.client as VersionClient) : null,
    message: r.message,
    restoredFrom: r.restored_from === null ? null : Number(r.restored_from),
    createdAt: r.created_at === null ? null : Number(r.created_at),
    replacedAt: r.replaced_at === null ? null : Number(r.replaced_at),
    keepUntil: r.keep_until === null ? null : Number(r.keep_until),
  };
}

/** Every version file of a page lives under this prefix. */
export const versionsPrefix = (pageId: string): string => `pages/${pageId}/versions/`;
const htmlKey = (objectKey: string) => `${objectKey}.html`;
const docKey = (objectKey: string) => `${objectKey}.doc.json`;

function newObjectKey(pageId: string): string {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return `${versionsPrefix(pageId)}${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** What a version's row says about its content. */
export type ContentSummary = { size: number; title: string | null; kind: PageKind };

type VersionsEnv = { DB: D1Database; PAGES_BUCKET: R2Bucket };

/**
 * The statement that adds a page's live row, if it has none: the next free
 * number, and RETURNING it. Does nothing when a live row exists, so two at
 * once can't make two (the unique index would refuse it anyway).
 */
function liveRowStatement(db: D1Database, pageId: string, c: ContentSummary, author: VersionAuthor, createdAt: number | null): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO page_versions (page_id, version, current, size, title, kind, actor, client, message, restored_from, created_at)
       SELECT ?, COALESCE((SELECT MAX(version) FROM page_versions WHERE page_id = ?), 0) + 1, 1, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM page_versions WHERE page_id = ? AND current = 1 AND removed_at IS NULL)
       RETURNING version`,
    )
    .bind(pageId, pageId, c.size, c.title, c.kind, author.actor, author.client, author.message, author.restoredFrom ?? null, createdAt, pageId);
}

/** A new page's first version (createPage). */
export async function recordFirstVersion(db: D1Database, pageId: string, c: ContentSummary, author: VersionAuthor, now: number): Promise<void> {
  await liveRowStatement(db, pageId, c, author, now).run();
}

/**
 * Before an update overwrites a page's HTML: copy the live content to a
 * version file and record it, and add the new live row. `previous` is the
 * page row's size and title before the update (for a page with no history
 * yet); `next` describes what's about to go live. Returns the version kept
 * (null when the page had no HTML to keep) and the new live version.
 * Throws if R2 or D1 fail; nothing is left behind then.
 */
export async function saveVersion(
  env: VersionsEnv,
  pageId: string,
  previous: { size: number; title: string | null },
  next: ContentSummary,
  author: VersionAuthor,
  plan: "free" | "pro",
  now: number,
): Promise<{ kept: number | null; current: number | null }> {
  const [oldHtml, oldDoc] = await Promise.all([env.PAGES_BUCKET.get(`pages/${pageId}/index.html`), env.PAGES_BUCKET.get(sidecarKey(pageId))]);
  const docText = oldDoc === null ? null : await oldDoc.text();
  const oldKind: PageKind = parseSidecar(docText)?.kind ?? "page";
  const key = oldHtml === null ? null : newObjectKey(pageId);
  if (key !== null && oldHtml !== null) {
    await env.PAGES_BUCKET.put(htmlKey(key), await oldHtml.text(), { httpMetadata: { contentType: "text/html; charset=utf-8" } });
    if (docText !== null) await env.PAGES_BUCKET.put(docKey(key), docText, { httpMetadata: { contentType: "application/json; charset=utf-8" } });
  }
  const days = VERSION_LIMITS[plan].days;
  const keepUntil = days === null ? null : now + days * 86_400_000;
  const db = env.DB;
  try {
    const [, kept, live] = await db.batch([
      // A page from before history was kept gets its live row first.
      liveRowStatement(db, pageId, { ...previous, kind: oldKind }, UNKNOWN_AUTHOR, null),
      key !== null
        ? db
            .prepare(
              "UPDATE page_versions SET current = 0, object_key = ?, has_sidecar = ?, replaced_at = ?, keep_until = ? WHERE page_id = ? AND current = 1 AND removed_at IS NULL RETURNING version",
            )
            .bind(key, docText !== null ? 1 : 0, now, keepUntil, pageId)
        : // No HTML to keep (it went missing): the old live row just goes.
          db.prepare("DELETE FROM page_versions WHERE page_id = ? AND current = 1 AND removed_at IS NULL RETURNING version").bind(pageId),
      liveRowStatement(db, pageId, next, author, now),
    ]);
    const first = (r: D1Result | undefined) => (r?.results?.[0] as { version?: number } | undefined)?.version ?? null;
    return { kept: key !== null ? first(kept) : null, current: first(live) };
  } catch (err) {
    if (key !== null) await env.PAGES_BUCKET.delete([htmlKey(key), docKey(key)]).catch(() => {});
    throw err;
  }
}

/** Delete these versions' files, then their rows. Rows whose files couldn't go stay, for the next try. */
async function dropVersions(env: VersionsEnv, rows: Array<{ page_id: string; version: number; object_key: string | null; has_sidecar: number }>): Promise<number> {
  if (rows.length === 0) return 0;
  const keys = rows.flatMap((r) => (r.object_key === null ? [] : [htmlKey(r.object_key), ...(Number(r.has_sidecar) === 1 ? [docKey(r.object_key)] : [])]));
  for (let i = 0; i < keys.length; i += 1000) await env.PAGES_BUCKET.delete(keys.slice(i, i + 1000));
  for (let i = 0; i < rows.length; i += 50) {
    await env.DB.batch(
      rows.slice(i, i + 50).map((r) => env.DB.prepare("DELETE FROM page_versions WHERE page_id = ? AND version = ?").bind(r.page_id, r.version)),
    );
  }
  return rows.length;
}

const DROP_COLS = "page_id, version, object_key, has_sidecar";
type DropRow = { page_id: string; version: number; object_key: string | null; has_sidecar: number };

/** Keep only a page's newest `keep` earlier versions (its plan's count, after every update). */
export async function trimVersions(env: VersionsEnv, pageId: string, keep: number): Promise<number> {
  const { results } = await env.DB
    .prepare(`SELECT ${DROP_COLS} FROM page_versions WHERE page_id = ? AND current = 0 AND removed_at IS NULL ORDER BY version DESC LIMIT -1 OFFSET ?`)
    .bind(pageId, keep)
    .all<DropRow>();
  return dropVersions(env, results);
}

/** A page's versions, newest first, removed ones left out. */
export async function listVersions(db: D1Database, pageId: string): Promise<PageVersion[]> {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM page_versions WHERE page_id = ? AND removed_at IS NULL ORDER BY version DESC`)
    .bind(pageId)
    .all<DbVersion>();
  return results.map(fromDb);
}

/** One version of a page, or null (never a removed one). */
export async function getVersion(db: D1Database, pageId: string, version: number): Promise<PageVersion | null> {
  const r = await db
    .prepare(`SELECT ${COLS} FROM page_versions WHERE page_id = ? AND version = ? AND removed_at IS NULL`)
    .bind(pageId, version)
    .first<DbVersion>();
  return r === null ? null : fromDb(r);
}

/** The number the live content has when the page has no live row yet (it was published before history). */
export async function nextVersionNumber(db: D1Database, pageId: string): Promise<number> {
  const r = await db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS n FROM page_versions WHERE page_id = ?").bind(pageId).first<{ n: number }>();
  return Number(r?.n ?? 1);
}

/**
 * get_page's history fields: the live version's number and how many versions
 * can be listed (the live one included). A failed read leaves them out.
 */
export async function versionCounts(db: D1Database, pageId: string): Promise<{ version?: number; versions?: number }> {
  try {
    const r = await db
      .prepare(
        "SELECT MAX(CASE WHEN current = 1 THEN version END) AS live, SUM(CASE WHEN current = 0 THEN 1 ELSE 0 END) AS kept, COALESCE(MAX(version), 0) AS top FROM page_versions WHERE page_id = ? AND removed_at IS NULL",
      )
      .bind(pageId)
      .first<{ live: number | null; kept: number | null; top: number }>();
    const live = r?.live ?? null;
    const kept = Number(r?.kept ?? 0);
    if (live !== null) return { version: Number(live), versions: kept + 1 };
    // No live row yet: published before history, or never updated since.
    return { version: await nextVersionNumber(db, pageId), versions: kept + 1 };
  } catch (err) {
    console.error("version count failed", { id: pageId, err });
    return {};
  }
}

/** A version's HTML and sidecar, or null if its file is gone. The live version reads the page's own files. */
export async function readVersionContent(bucket: R2Bucket, v: PageVersion): Promise<{ html: string; sidecar: DocSidecar | null } | null> {
  const [html, doc] =
    v.current || v.objectKey === null
      ? await Promise.all([bucket.get(`pages/${v.pageId}/index.html`), bucket.get(sidecarKey(v.pageId))])
      : await Promise.all([bucket.get(htmlKey(v.objectKey)), v.hasSidecar ? bucket.get(docKey(v.objectKey)) : Promise.resolve(null)]);
  if (html === null) return null;
  return { html: await html.text(), sidecar: doc === null ? null : parseSidecar(await doc.text()) };
}

/** A deleted page's history: every file under its versions prefix, then its rows. */
export async function deletePageVersions(env: VersionsEnv, pageId: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const list = await env.PAGES_BUCKET.list({ prefix: versionsPrefix(pageId), ...(cursor ? { cursor } : {}) });
    if (list.objects.length > 0) await env.PAGES_BUCKET.delete(list.objects.map((o) => o.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor !== undefined);
  await env.DB.prepare("DELETE FROM page_versions WHERE page_id = ?").bind(pageId).run();
}

/**
 * Account deletion: every version of the account's pages is marked removed,
 * in the same batch as the account rows (routes/me.ts), before the pages
 * become anonymous. From then on none is listed or restored; their files go
 * right after the response (deleteRemovedVersions), or in housekeeping.
 */
export function removeOwnerVersionsStatement(db: D1Database, ownerId: number, now: number): D1PreparedStatement {
  return db
    .prepare("UPDATE page_versions SET removed_at = ? WHERE removed_at IS NULL AND page_id IN (SELECT id FROM pages WHERE owner_id = ?)")
    .bind(now, ownerId);
}

/** The files and rows of removed versions, a batch at a time. */
export async function deleteRemovedVersions(env: VersionsEnv, limit = PRUNE_BATCH): Promise<number> {
  const { results } = await env.DB.prepare(`SELECT ${DROP_COLS} FROM page_versions WHERE removed_at IS NOT NULL LIMIT ?`).bind(limit).all<DropRow>();
  return dropVersions(env, results);
}

/**
 * Hourly housekeeping (index.ts): versions of removed accounts, of pages that
 * are deleted or expired, earlier versions past their plan's days (never the
 * newest ALWAYS_KEEP), and any page over the largest plan's count. At most
 * PRUNE_BATCH rows of each kind per run.
 */
export async function pruneVersions(env: VersionsEnv, now: number): Promise<{ removed: number; gone: number; old: number; over: number }> {
  const db = env.DB;
  const removed = await deleteRemovedVersions(env);
  const gone = await dropVersions(
    env,
    (
      await db
        .prepare(
          `SELECT v.page_id, v.version, v.object_key, v.has_sidecar FROM page_versions v LEFT JOIN pages p ON p.id = v.page_id
           WHERE p.id IS NULL OR p.deleted_at IS NOT NULL OR (p.expires_at IS NOT NULL AND p.expires_at <= ?) LIMIT ?`,
        )
        .bind(now, PRUNE_BATCH)
        .all<DropRow>()
    ).results,
  );
  const ranked = (where: string) =>
    `SELECT ${DROP_COLS} FROM (
       SELECT ${DROP_COLS}, keep_until, ROW_NUMBER() OVER (PARTITION BY page_id ORDER BY version DESC) AS rn
       FROM page_versions WHERE current = 0 AND removed_at IS NULL AND page_id IN (${where})
     )`;
  const old = await dropVersions(
    env,
    (
      await db
        .prepare(
          `${ranked("SELECT page_id FROM page_versions WHERE keep_until IS NOT NULL AND keep_until <= ? AND current = 0 AND removed_at IS NULL")}
           WHERE keep_until IS NOT NULL AND keep_until <= ? AND rn > ? LIMIT ?`,
        )
        .bind(now, now, ALWAYS_KEEP, PRUNE_BATCH)
        .all<DropRow>()
    ).results,
  );
  const over = await dropVersions(
    env,
    (
      await db
        .prepare(
          `${ranked("SELECT page_id FROM page_versions WHERE current = 0 AND removed_at IS NULL GROUP BY page_id HAVING COUNT(*) > ?")} WHERE rn > ? LIMIT ?`,
        )
        .bind(MOST_VERSIONS, MOST_VERSIONS, PRUNE_BATCH)
        .all<DropRow>()
    ).results,
  );
  return { removed, gone, old, over };
}

/** The version fields of an API answer (routes/versions.ts), in the API's snake_case. */
export function versionOut(v: PageVersion): Record<string, unknown> {
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  return {
    version: v.version,
    current: v.current,
    size: v.size,
    title: v.title,
    kind: v.kind,
    actor: v.actor,
    client: v.client,
    message: v.message,
    restored_from: v.restoredFrom,
    created_at: iso(v.createdAt),
    replaced_at: iso(v.replacedAt),
    kept_until: v.current ? null : iso(v.keepUntil),
  };
}
