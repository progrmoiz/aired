#!/usr/bin/env node
// Read agent feedback (D1 agent_feedback, migrations/0011) without a
// dashboard or a secret: it runs a read-only SELECT through wrangler.
//
//   node scripts/feedback.mjs                  production, newest 30 (needs `wrangler login`)
//   node scripts/feedback.mjs --local          the local wrangler dev database
//   node scripts/feedback.mjs --limit 100 --kind bug --json
//
// With ADMIN_TOKEN set, GET /api/admin/feedback answers the same rows.

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const limit = Number(value("--limit", "30"));
const kind = value("--kind", null);
if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("--limit must be 1 to 1000");
if (kind !== null && !["bug", "friction", "idea"].includes(kind)) throw new Error("--kind must be bug, friction or idea");

const sql =
  "SELECT id, kind, impact, message, page_id, tool, source, client, actor, user_id, created_at FROM agent_feedback" +
  (kind ? ` WHERE kind = '${kind}'` : "") +
  ` ORDER BY created_at DESC LIMIT ${limit}`;

const out = execFileSync(
  "npx",
  ["wrangler", "d1", "execute", "aired", flag("--local") ? "--local" : "--remote", "--json", "--command", sql],
  { cwd: WORKER_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
);
const rows = JSON.parse(out)[0]?.results ?? [];

if (flag("--json")) {
  process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
} else if (rows.length === 0) {
  process.stdout.write("No feedback yet.\n");
} else {
  for (const r of rows) {
    const when = new Date(r.created_at).toISOString().replace("T", " ").slice(0, 16);
    const bits = [r.kind, r.impact, r.source, r.actor, r.tool, r.client, r.page_id && `page ${r.page_id}`, r.user_id && `user ${r.user_id}`].filter(Boolean);
    process.stdout.write(`${r.id}  ${when}  ${bits.join(" · ")}\n  ${r.message.replace(/\n/g, "\n  ")}\n\n`);
  }
}
