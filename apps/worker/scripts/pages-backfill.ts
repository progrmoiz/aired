/**
 * Drive the KV → D1 pages backfill (routes/admin.ts, lib/pages-backfill.ts)
 * batch by batch, and write the combined report. Run from apps/worker:
 *
 *   ADMIN_TOKEN=... node --experimental-strip-types scripts/pages-backfill.ts \
 *     --origin https://staging.aired.sh [--apply] [--limit 200] [--out report.json]
 *
 * Without --apply it's a dry run: nothing is written. The worker needs the
 * same ADMIN_TOKEN as a secret (`wrangler secret put ADMIN_TOKEN [--env staging]`).
 * Safe to stop and run again: rows are only ever inserted when missing.
 * docs/pages-in-d1.md has the full rollout.
 */
import { writeFileSync } from "node:fs";
import { emptyCounts, mergeReports, type BackfillReport } from "../src/lib/pages-backfill.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const origin = opt("origin");
const token = process.env.ADMIN_TOKEN;
if (!origin || !/^https:\/\//.test(origin)) throw new Error("--origin https://... is required");
if (!token) throw new Error("set ADMIN_TOKEN");
const apply = flag("apply");
const limit = Number(opt("limit") ?? 200);
const out = opt("out");

let total: BackfillReport = { dryRun: !apply, counts: emptyCounts(), samples: { corrupt: [], differs: [], claimOverridesKv: [], tombstoned: [] }, cursor: null };
let cursor: string | null = null;
let batches = 0;
const started = Date.now();
do {
  let res: Response | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    res = await fetch(`${origin}/api/admin/pages-backfill`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Token": token },
      body: JSON.stringify({ cursor, limit, apply }),
    });
    if (res.ok) break;
    console.error(`batch ${batches + 1} attempt ${attempt}: HTTP ${res.status} ${await res.text()}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  if (!res?.ok) throw new Error(`stopped at cursor ${cursor ?? "(start)"}; run again to resume from the start (safe)`);
  const batch = (await res.json()) as BackfillReport;
  total = mergeReports(total, batch);
  cursor = batch.cursor;
  batches++;
  process.stdout.write(`\rbatch ${batches}: scanned ${total.counts.scanned}, ${apply ? "inserted" : "would insert"} ${apply ? total.counts.inserted : total.counts.toInsert}`);
} while (cursor !== null);

const report = { origin, ...total, batches, seconds: Math.round((Date.now() - started) / 1000) };
console.log("\n" + JSON.stringify(report, null, 2));
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
