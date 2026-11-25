#!/usr/bin/env node
// How today's accounts would link when WorkOS sign-in is turned on. Read-only:
// it lists and reads KV keys and never writes anything.
//
//   node scripts/link-report.mjs --remote                 production (needs `wrangler login`)
//   node scripts/link-report.mjs --local <persist-dir>    a local wrangler dev state
//
// For each account (KV user:<id>) it reports the path a WorkOS sign-in takes:
//   email      a verified sign-in with this email lands on the account
//   ambiguous  two or more accounts hold the email: it won't link by email
//   unindexed  the email index doesn't point at this account: it won't link
//              by email until the person signs in with GitHub once more
//   github     no email on file: only "Continue with GitHub" (or the old
//              GitHub sign-in) reaches the account
// Prints counts only, plus the ids for the ambiguous and unindexed rows (no
// emails), so the output is safe to paste.

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAMESPACE = "6388d6b3b6c04fe5ad8529ae029e723e";
const WORKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const normalize = (e) => (typeof e === "string" && e.trim() ? e.trim().toLowerCase() : null);
const isNoreply = (e) => /@users\.noreply\.github\.com$/i.test(e);

/**
 * accounts: [{ id, email }] from user:<id>; index: Map<email, id string>
 * from email:<email>. Returns { total, paths: {email, ambiguous, unindexed,
 * github}, ambiguousIds, unindexedIds }.
 */
export function linkReport(accounts, index) {
  const holders = new Map();
  for (const a of accounts) {
    const e = normalize(a.email);
    if (e && !isNoreply(e)) holders.set(e, (holders.get(e) ?? 0) + 1);
  }
  const paths = { email: 0, ambiguous: 0, unindexed: 0, github: 0 };
  const ambiguousIds = [];
  const unindexedIds = [];
  for (const a of accounts) {
    const e = normalize(a.email);
    if (!e || isNoreply(e)) paths.github++;
    else if (holders.get(e) > 1) { paths.ambiguous++; ambiguousIds.push(a.id); }
    else if (index.get(e) !== String(a.id)) { paths.unindexed++; unindexedIds.push(a.id); }
    else paths.email++;
  }
  return { total: accounts.length, paths, ambiguousIds, unindexedIds };
}

function main(argv) {
  const where = argv[0] === "--remote" ? ["--remote"] : argv[0] === "--local" && argv[1] ? ["--local", "--persist-to", argv[1]] : null;
  if (!where) {
    console.error("usage: node scripts/link-report.mjs --remote | --local <persist-dir>");
    process.exit(2);
  }
  const target = where[0] === "--remote" ? ["--namespace-id", NAMESPACE] : ["--binding", "PAGES_KV"];
  const wrangler = (args) =>
    execFileSync("npx", ["wrangler", ...args, ...target, ...where], { cwd: WORKER_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const list = (prefix) => {
    const out = wrangler(["kv", "key", "list", "--prefix", prefix]);
    return JSON.parse(out.slice(out.indexOf("["), out.lastIndexOf("]") + 1)).map((k) => k.name);
  };
  const get = (key) => {
    try {
      return wrangler(["kv", "key", "get", key, "--text"]).trim();
    } catch {
      return null;
    }
  };

  const accounts = [];
  for (const key of list("user:")) {
    try {
      const r = JSON.parse(get(key) ?? "null");
      if (r && typeof r === "object") accounts.push({ id: Number(key.slice(5)), email: r.email ?? null });
    } catch {
      // not a user record
    }
  }
  const index = new Map();
  for (const key of list("email:")) index.set(key.slice(6), get(key));

  const r = linkReport(accounts, index);
  console.log(`accounts: ${r.total}`);
  console.log(`  link by email:          ${r.paths.email}`);
  console.log(`  email held by several:  ${r.paths.ambiguous}${r.ambiguousIds.length ? `  (ids ${r.ambiguousIds.join(", ")})` : ""}`);
  console.log(`  email not indexed:      ${r.paths.unindexed}${r.unindexedIds.length ? `  (ids ${r.unindexedIds.join(", ")})` : ""}`);
  console.log(`  GitHub only (no email): ${r.paths.github}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
