#!/usr/bin/env node
// Delete the KV owner and project indexes that D1 `pages` replaced
// (docs/pages-in-d1.md, "Retiring the old copies"). Nothing reads or writes
// these keys any more:
//
//   pages_by_owner:<uid>:<ts>:<pageId>
//   pages_by_owner_project:<uid>:<project>:<ts>:<pageId>
//   projects_by_owner:<uid>
//
//   node scripts/retire-kv-indexes.mjs list --out <dir>
//        List every such key into <dir>/retire-<prefix>-<n>.json (JSON
//        arrays of up to 10,000 key names, the format and size `wrangler kv
//        bulk delete` takes) and print the counts. Reads only.
//   node scripts/retire-kv-indexes.mjs delete --out <dir>
//        Print the `wrangler kv bulk delete` commands for those files. It
//        doesn't run them: you do, after checking the counts and that last
//        night's KV snapshot finished (docs/backups.md).
//
// Talks to production through wrangler, so it needs `wrangler login`.
// Never touches page:, user: or any other prefix.

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAMESPACE = "6388d6b3b6c04fe5ad8529ae029e723e";
const WORKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PREFIXES = ["pages_by_owner:", "pages_by_owner_project:", "projects_by_owner:"];

const CHUNK = 10_000;
const stem = (prefix) => `retire-${prefix.replace(/:$/, "")}-`;
const filesFor = (dir, prefix) =>
  readdirSync(dir).filter((f) => f.startsWith(stem(prefix)) && /^\d+\.json$/.test(f.slice(stem(prefix).length))).sort().map((f) => join(dir, f));

function listKeys(prefix) {
  const out = execFileSync(
    "npx",
    ["wrangler", "kv", "key", "list", "--namespace-id", NAMESPACE, "--prefix", prefix, "--remote"],
    { cwd: WORKER_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 512 * 1024 * 1024 },
  );
  const names = JSON.parse(out.slice(out.indexOf("["), out.lastIndexOf("]") + 1)).map((k) => k.name);
  // `pages_by_owner:` is also the start of `pages_by_owner_project:`; keep each list to its own prefix.
  return names.filter((n) => n.startsWith(prefix) && !(prefix === "pages_by_owner:" && n.startsWith("pages_by_owner_project:")));
}

function outDir() {
  const i = process.argv.indexOf("--out");
  const dir = i > 0 ? process.argv[i + 1] : undefined;
  if (!dir) {
    console.error("Pass --out <dir>, e.g. --out /tmp/aired-retire");
    process.exit(1);
  }
  return resolve(dir);
}

const command = process.argv[2];
if (command === "list") {
  const dir = outDir();
  mkdirSync(dir, { recursive: true });
  for (const prefix of PREFIXES) {
    const keys = listKeys(prefix);
    let files = 0;
    for (let i = 0; i < keys.length; i += CHUNK) {
      writeFileSync(join(dir, `${stem(prefix)}${String(files++).padStart(3, "0")}.json`), JSON.stringify(keys.slice(i, i + CHUNK)));
    }
    console.log(`${prefix.padEnd(26)} ${String(keys.length).padStart(7)} keys in ${files} file(s)`);
  }
  console.log("\nNothing was deleted. Next: node scripts/retire-kv-indexes.mjs delete --out " + dir);
} else if (command === "delete") {
  const dir = outDir();
  console.log("Check the counts and the latest KV snapshot first (docs/backups.md). Then, from apps/worker:\n");
  for (const prefix of PREFIXES) {
    for (const file of filesFor(dir, prefix)) {
      const keys = JSON.parse(readFileSync(file, "utf8"));
      const own = (k) => typeof k === "string" && k.startsWith(prefix) && !(prefix === "pages_by_owner:" && k.startsWith("pages_by_owner_project:"));
      if (!Array.isArray(keys) || !keys.every(own)) {
        console.error(`${file} holds something other than ${prefix} keys; not printing a delete for it.`);
        process.exit(1);
      }
      console.log(`npx wrangler kv bulk delete ${file} --namespace-id ${NAMESPACE} --remote   # ${keys.length} keys`);
    }
  }
} else {
  console.error("Usage: node scripts/retire-kv-indexes.mjs list|delete --out <dir>");
  process.exit(1);
}
