import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PRODUCTION_ORIGIN, isProductionOrigin, siteOrigin } from "../src/lib/origin.ts";
import { workosLogoutUrl, workosRedirectUri } from "../src/lib/workos.ts";
import { claimUrl } from "../src/lib/claim-url.ts";
import { siteOrigin as billingOrigin } from "../src/lib/billing/webhook-plan.ts";

test("siteOrigin is SITE_ORIGIN without trailing slashes, else production", () => {
  assert.equal(siteOrigin({}), "https://aired.sh");
  assert.equal(siteOrigin({ SITE_ORIGIN: "" }), "https://aired.sh");
  assert.equal(siteOrigin({ SITE_ORIGIN: "https://staging.aired.sh/" }), "https://staging.aired.sh");
  assert.equal(siteOrigin({ SITE_ORIGIN: "http://localhost:8787//" }), "http://localhost:8787");
  assert.equal(isProductionOrigin({}), true);
  assert.equal(isProductionOrigin({ SITE_ORIGIN: "https://staging.aired.sh" }), false);
  assert.equal(billingOrigin, siteOrigin, "billing uses the same helper");
});

test("WorkOS redirects and claim links follow the deploy's origin", () => {
  const staging = { SITE_ORIGIN: "https://staging.aired.sh" };
  assert.equal(workosRedirectUri(staging), "https://staging.aired.sh/auth/workos/callback");
  assert.equal(workosRedirectUri({}), "https://aired.sh/auth/workos/callback");
  assert.match(workosLogoutUrl(staging, "sess"), /return_to=https%3A%2F%2Fstaging\.aired\.sh%2F/);
  assert.equal(claimUrl(siteOrigin(staging), "abcdef1234", "at_" + "x".repeat(20)), `https://staging.aired.sh/claim#abcdef1234.at_${"x".repeat(20)}`);
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

test("staging is a separate Worker with its own storage, counters and route", () => {
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const [prod, staging] = toml.split(/^\[env\.staging\]$/m);
  assert.ok(staging, "wrangler.toml has [env.staging]");
  assert.match(staging, /^name = "aired-staging"$/m);
  assert.match(staging, /SITE_ORIGIN = "https:\/\/staging\.aired\.sh"/);
  assert.match(staging, /AIRED_ENV = "staging"/);
  assert.match(staging, /routes = \[\{ pattern = "staging\.aired\.sh", custom_domain = true \}\]/);
  assert.doesNotMatch(staging, /pattern = "aired\.sh/);

  const ids = (s: string, re: RegExp) => [...s.matchAll(re)].map((m) => m[1]);
  const kv = /\[\[(?:env\.staging\.)?kv_namespaces\]\]\nbinding = "\w+"\nid = "([^"]+)"/g;
  const d1 = /database_id = "([^"]+)"/g;
  const r2 = /bucket_name = "([^"]+)"/g;
  const rl = /namespace_id = "(\d+)"/g;
  for (const re of [kv, d1, r2, rl]) {
    const p = new Set(ids(prod!, re));
    const s = ids(staging, re);
    assert.ok(s.length > 0, `staging defines ${re}`);
    for (const id of s) assert.ok(!p.has(id), `staging shares ${id} with production`);
  }
  // Every production binding exists on staging too.
  for (const name of ids(prod!, /\[\[ratelimits\]\]\nname = "(\w+)"/g)) {
    assert.match(staging, new RegExp(`\\[\\[env\\.staging\\.ratelimits\\]\\]\\nname = "${name}"`), name);
  }
  for (const b of ["PAGES_BUCKET", "PAGES_KV", "OAUTH_KV", "DB", "BROWSER"]) {
    assert.match(staging, new RegExp(`binding = "${b}"`), b);
  }
  // Production stays as it was: no vars, the aired.sh routes.
  assert.doesNotMatch(prod!, /^\[vars\]/m);
  assert.match(prod!, /pattern = "aired\.sh\/\*"/);
});

test("staging responses say noindex; production never sets AIRED_ENV", () => {
  const mw = readFileSync(new URL("../src/middleware/staging.ts", import.meta.url), "utf8");
  assert.match(mw, /if \(c\.env\.AIRED_ENV !== "staging" \|\| c\.res\.status === 101\) return;/);
  assert.match(mw, /X-Robots-Tag", "noindex, nofollow"/);
  const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(index, /app\.use\("\*", requestIdMiddleware\);\napp\.use\("\*", stagingNoIndex\);/);
});

test("deploys tag the commit, migrate first and check /health", () => {
  const sh = readFileSync(new URL("../scripts/deploy.sh", import.meta.url), "utf8");
  assert.match(sh, /wr d1 migrations apply "\$db" --remote/);
  assert.match(sh, /wr deploy --tag "\$tag" --message "\$message"/);
  assert.ok(sh.indexOf("migrations apply") < sh.indexOf("wr deploy --tag"), "migrations run before the deploy");
  assert.match(sh, /curl -fsS --max-time 10 "\$origin\/health"/);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.deploy, "bash scripts/deploy.sh production");
  assert.equal(pkg.scripts["deploy:staging"], "bash scripts/deploy.sh staging");
});
