import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PRODUCTION_ORIGIN, siteOrigin } from "../src/lib/origin.ts";
import { workosLogoutUrl, workosRedirectUri } from "../src/lib/workos.ts";
import { claimUrl } from "../src/lib/claim-url.ts";
import { siteOrigin as billingOrigin } from "../src/lib/billing/webhook-plan.ts";

test("siteOrigin is SITE_ORIGIN without trailing slashes, else production", () => {
  assert.equal(siteOrigin({}), "https://aired.sh");
  assert.equal(siteOrigin({ SITE_ORIGIN: "" }), "https://aired.sh");
  assert.equal(siteOrigin({ SITE_ORIGIN: "https://pages.example.com/" }), "https://pages.example.com");
  assert.equal(siteOrigin({ SITE_ORIGIN: "http://localhost:8787//" }), "http://localhost:8787");
  assert.equal(billingOrigin, siteOrigin, "billing uses the same helper");
});

test("WorkOS redirects and claim links follow the deploy's origin", () => {
  const other = { SITE_ORIGIN: "https://pages.example.com" };
  assert.equal(workosRedirectUri(other), "https://pages.example.com/auth/workos/callback");
  assert.equal(workosRedirectUri({}), "https://aired.sh/auth/workos/callback");
  assert.match(workosLogoutUrl(other, "sess"), /return_to=https%3A%2F%2Fpages\.example\.com%2F/);
  assert.equal(claimUrl(siteOrigin(other), "abcdef1234", "at_" + "x".repeat(20)), `https://pages.example.com/claim#abcdef1234.at_${"x".repeat(20)}`);
});

test("no file in src writes https://aired.sh except lib/origin.ts (comments aside)", () => {
  const offenders: string[] = [];
  const walk = (dir: URL) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const u = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
      if (e.isDirectory()) { walk(u); continue; }
      if (!e.name.endsWith(".ts") || u.pathname.endsWith("/lib/origin.ts")) continue;
      readFileSync(u, "utf8").split("\n").forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return;
        if (code.includes(PRODUCTION_ORIGIN)) offenders.push(`${u.pathname.split("/src/")[1]}:${i + 1}`);
      });
    }
  };
  walk(new URL("../src/", import.meta.url));
  assert.deepEqual(offenders, []);
});

test("CORS allows the deploy's own origin", () => {
  const cors = readFileSync(new URL("../src/middleware/cors.ts", import.meta.url), "utf8");
  assert.match(cors, /const allowed = siteOrigin\(c\.env\);/);
  assert.equal((cors.match(/originAllowed\(origin, path, allowed\)/g) ?? []).length, 2);
});

test("deploys tag the commit, migrate first and check /health", () => {
  const sh = readFileSync(new URL("../scripts/deploy.sh", import.meta.url), "utf8");
  assert.match(sh, /pnpm exec wrangler d1 migrations apply "\$db" --remote/);
  assert.match(sh, /pnpm exec wrangler deploy --tag "\$tag" --message "\$message"/);
  assert.ok(sh.indexOf("wrangler d1 migrations apply \"$db\"") < sh.indexOf("wrangler deploy --tag \"$tag\""), "migrations run before the deploy");
  assert.match(sh, /curl -fsS --max-time 10 "\$origin\/health"/);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.deploy, "bash scripts/deploy.sh");
  // Production stays as it was: no vars, the aired.sh routes, no extra environments.
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.doesNotMatch(toml, /^\[vars\]/m);
  assert.doesNotMatch(toml, /^\[env\./m);
  assert.match(toml, /pattern = "aired\.sh\/\*"/);
});
