import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const web = (f: string) => readFileSync(new URL(`../../web/${f}`, import.meta.url), "utf8");
const repo = (f: string) => readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8");

test("docs show the token format the code mints and the limits it enforces", () => {
  const core = repo("packages/core/src/token.ts");
  assert.match(core, /const TOKEN_PREFIX = "at_";/);
  for (const f of ["docs.html", "llms.txt", "llms-full.txt"]) {
    const s = web(f);
    assert.ok(!s.includes("tok_"), `${f} shows tok_ tokens`);
    assert.ok(!/no paid tier/i.test(s), `${f} says there's no paid tier`);
  }
  const ent = readFileSync(new URL("../src/lib/entitlements.ts", import.meta.url), "utf8");
  assert.match(ent, /PRO_MAX_BYTES = 10 \* 1024 \* 1024/);
  assert.match(web("docs.html"), /2 MB \(Free\), 10 MB \(Pro\)/);
  assert.match(repo("README.md"), /2 MB \(Free\), 10 MB \(Pro\)/);
});

test("the error table covers every status the API answers with", () => {
  const docs = web("docs.html");
  for (const status of ["400", "401", "402", "403", "404", "409", "410", "422", "429", "500", "502", "503"]) {
    assert.match(docs, new RegExp(`<code>${status}</code>`), status);
  }
  assert.match(docs, /code: "plan_limit"/);
  // Unknown /api/* paths answer JSON, so "errors are JSON" holds.
  const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(index, /if \(path === "\/api" \|\| path\.startsWith\("\/api\/"\) \|\| path\.startsWith\("\/oauth\/"\)\) \{\s*return c\.json\(\{ error: "Not found" \}, 404\);/);
});

test("self-hosting docs name D1, the rate-limit bindings and the required secrets", () => {
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const bindings = [...toml.matchAll(/\[\[ratelimits\]\]\r?\n(?:#[^\n]*\n)*name = "(\w+)"/g)].map((m) => m[1]);
  assert.equal(bindings.length, (toml.match(/\[\[ratelimits\]\]/g) ?? []).length, "every rate-limit binding was read");
  assert.ok(bindings.length > 0);
  const readme = repo("README.md");
  for (const b of bindings) assert.ok(readme.includes(b), `README misses ${b}`);
  for (const s of ["SESSION_SECRET", "SESSION_VALID_SINCE", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"]) {
    assert.ok(readme.includes(s), `README misses ${s}`);
    assert.ok(web("docs.html").includes(s), `docs miss ${s}`);
    assert.ok(web("llms.txt").includes(s), `llms.txt misses ${s}`);
  }
  for (const s of [readme, web("docs.html"), web("llms.txt")]) assert.ok(s.includes("D1"));
});

test("the privacy policy covers D1 sign-in records, API keys, connected apps and WorkOS", () => {
  const p = web("privacy.html");
  assert.match(p, /Account and sign-in records \(including the email you signed in with\), API key hashes and billing records live in Cloudflare D1\./);
  // Sign-in runs on WorkOS now, so the row names it as live.
  assert.match(p, /<tr><td>WorkOS<\/td><td>Runs sign-in[^<]*Receives your email address and name\./);
  assert.ok(!p.includes("Not used yet"), "privacy policy still says WorkOS is not used");
  assert.match(p, /<code>aired_workos_sid<\/code>/);
  assert.match(p, /disconnects every app you connected, deletes your API keys/);
});

test("sign out everywhere has a control on the website, and identity rows keep only verified emails", () => {
  const account = repo("apps/dashboard/src/views/account-view.tsx");
  assert.match(account, /mutate\('POST', '\/api\/me\/sign-out-everywhere'\)/);
  const resolve = readFileSync(new URL("../src/lib/resolve-user.ts", import.meta.url), "utf8");
  assert.ok(!/userId: user\.id, email, emailVerified/.test(resolve), "identity rows store the verified email only");
  const auth = readFileSync(new URL("../src/routes/auth.ts", import.meta.url), "utf8");
  assert.ok(!auth.includes("'https://aired.sh/auth/callback'"), "the GitHub callback follows SITE_ORIGIN");
});
