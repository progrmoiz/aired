import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-expect-error plain .mjs script
import { linkReport } from "../scripts/link-report.mjs";

test("the link report sorts accounts by the path a WorkOS sign-in takes", () => {
  const accounts = [
    { id: 1, email: "Kim@Example.com" },
    { id: 2, email: "shared@example.com" },
    { id: 3, email: "shared@example.com" },
    { id: 4, email: "lost@example.com" },
    { id: 5, email: null },
    { id: 6, email: "9+x@users.noreply.github.com" },
  ];
  const index = new Map([["kim@example.com", "1"], ["shared@example.com", "2"], ["lost@example.com", "99"]]);
  assert.deepEqual(linkReport(accounts, index), {
    total: 6,
    paths: { email: 1, ambiguous: 2, unindexed: 1, github: 2 },
    ambiguousIds: [2, 3],
    unindexedIds: [4],
  });
});

test("the link report only reads: list and get, never put or delete, and asks where to read", () => {
  const src = readFileSync(new URL("../scripts/link-report.mjs", import.meta.url), "utf8");
  const calls = [...src.matchAll(/wrangler\(\["kv", "key", "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(calls)].sort(), ["get", "list"]);
  assert.ok(!/bulk|put|delete/.test(src.replace(/^\/\/.*$/gm, "")), "no write commands");
  assert.match(src, /usage: node scripts\/link-report\.mjs --remote \| --local <persist-dir>/);
});
