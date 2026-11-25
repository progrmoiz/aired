#!/usr/bin/env node
// Review abuse reports and take pages down.
//
//   node scripts/abuse.mjs list              reports grouped by page; owner removal requests first
//   node scripts/abuse.mjs takedown <id>     delete the page and its reports
//   node scripts/abuse.mjs dismiss <id>      keep the page, clear its reports
//
// Talks to production through wrangler, so it needs `wrangler login`.

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAMESPACE = "6388d6b3b6c04fe5ad8529ae029e723e";
const BUCKET = "aired-pages";
const WORKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function wrangler(args) {
  return execFileSync("npx", ["wrangler", ...args], {
    cwd: WORKER_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function listKeys(prefix) {
  const out = wrangler(["kv", "key", "list", "--namespace-id", NAMESPACE, "--prefix", prefix, "--remote"]);
  return JSON.parse(out.slice(out.indexOf("["), out.lastIndexOf("]") + 1)).map((k) => k.name);
}

function getValue(key) {
  try {
    return wrangler(["kv", "key", "get", key, "--namespace-id", NAMESPACE, "--remote", "--text"]).trim();
  } catch {
    return null;
  }
}

function deleteKey(key) {
  wrangler(["kv", "key", "delete", key, "--namespace-id", NAMESPACE, "--remote"]);
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function assertId(id) {
  if (!id || !/^[A-Za-z0-9_-]{4,32}$/.test(id)) {
    console.error("Pass a page ID, e.g. node scripts/abuse.mjs takedown abc123XYZ0");
    process.exit(1);
  }
}

function list() {
  const keys = listKeys("report:");
  if (keys.length === 0) {
    console.log("No open reports.");
    return;
  }
  const byPage = new Map();
  for (const key of keys) {
    const pageId = key.split(":")[1];
    const report = parseJson(getValue(key)) ?? { reason: "(unreadable)", reportedAt: key.split(":").slice(2).join(":") };
    if (!byPage.has(pageId)) byPage.set(pageId, []);
    byPage.get(pageId).push(report);
  }
  // Owner removal requests ("I lost my update token") come first, then the most reported.
  const isOwnerRemoval = (reports) => reports.some((r) => r.category === "owner_removal");
  const pages = [...byPage.entries()].sort(
    (a, b) => Number(isOwnerRemoval(b[1])) - Number(isOwnerRemoval(a[1])) || b[1].length - a[1].length,
  );
  for (const [pageId, reports] of pages) {
    const meta = parseJson(getValue(`page:${pageId}`));
    const owner = meta === null ? "already gone" : meta.ownerId === null ? "anonymous" : `owner ${meta.ownerId}`;
    const flag = isOwnerRemoval(reports) ? "OWNER REMOVAL REQUEST  " : "";
    console.log(`\n${flag}${pageId}  ${reports.length} report${reports.length === 1 ? "" : "s"}  (${owner})`);
    if (meta) console.log(`  ${meta.title ?? "(untitled)"}  https://aired.sh/p/${pageId}  views: ${meta.readCount}`);
    for (const r of reports) {
      const contact = r.contact ? `  contact: ${r.contact}` : "";
      const label = r.category === "owner_removal" ? "owner_removal: publisher lost the update token" : (r.category ?? "other");
      console.log(`  - ${r.reportedAt?.slice(0, 16) ?? "?"}  [${label}] ${r.reason}${contact}`);
    }
  }
  console.log(`\n${pages.length} page(s). takedown <id> removes a page, dismiss <id> clears its reports.`);
  console.log("Owner removal requests: confirm the page matches what they describe, then takedown. Never hand a page to another account without its update token.");
}

function clearReports(pageId) {
  const keys = listKeys(`report:${pageId}:`);
  for (const key of keys) deleteKey(key);
  return keys.length;
}

function takedown(pageId) {
  assertId(pageId);
  const meta = parseJson(getValue(`page:${pageId}`));
  if (meta === null) {
    console.log(`${pageId} has no metadata; removing any leftover file and reports.`);
  } else {
    console.log(`Taking down ${pageId}: ${meta.title ?? "(untitled)"} (${meta.ownerId === null ? "anonymous" : `owner ${meta.ownerId}`})`);
  }

  try {
    wrangler(["r2", "object", "delete", `${BUCKET}/pages/${pageId}/index.html`, "--remote"]);
  } catch (err) {
    console.error(`  R2 delete failed: ${String(err.stderr ?? err).trim()}`);
  }
  if (meta !== null) deleteKey(`page:${pageId}`);

  // Owned pages are also listed in the owner's dashboard indexes.
  if (meta !== null && meta.ownerId !== null) {
    const indexKeys = [
      ...listKeys(`pages_by_owner:${meta.ownerId}:`),
      ...listKeys(`pages_by_owner_project:${meta.ownerId}:`),
    ].filter((k) => k.endsWith(`:${pageId}`));
    for (const key of indexKeys) deleteKey(key);
    if (meta.project !== null) {
      console.log(`  Note: project "${meta.project}" page count in the owner's dashboard is now one too high.`);
    }
  }

  const cleared = clearReports(pageId);
  console.log(`  Removed. Cleared ${cleared} report(s). https://aired.sh/p/${pageId} now returns 404.`);
}

function dismiss(pageId) {
  assertId(pageId);
  console.log(`Cleared ${clearReports(pageId)} report(s) for ${pageId}. The page stays up.`);
}

const [command, id] = process.argv.slice(2);
if (command === "list") list();
else if (command === "takedown") takedown(id);
else if (command === "dismiss") dismiss(id);
else {
  console.log("Usage: node scripts/abuse.mjs list | takedown <id> | dismiss <id>");
  process.exit(command ? 1 : 0);
}
