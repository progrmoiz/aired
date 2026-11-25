import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

test("the site's /tokens.css is an exact copy of packages/ui-tokens/tokens.css", () => {
  assert.equal(read("apps/web/tokens.css"), read("packages/ui-tokens/tokens.css"), "run: pnpm --filter @aired/ui-tokens sync");
});

test("the marketing site and the dashboard both read their values from the shared tokens", () => {
  const site = read("apps/web/site.css");
  assert.match(site, /^\/\*[\s\S]*?\*\/\s*@import url\("\/tokens\.css"\);/, "site.css imports /tokens.css first");
  for (const alias of ["--bg: var(--aired-bg)", "--text-1: var(--aired-text-1)", "--mark: var(--aired-mark)", "--btn: var(--aired-primary)"]) {
    assert.ok(site.includes(alias), `site.css maps ${alias}`);
  }
  const dash = read("apps/dashboard/src/index.css");
  assert.match(dash, /@import "@aired\/ui-tokens\/tokens\.css";/);
  for (const alias of ["--background: var(--aired-bg)", "--foreground: var(--aired-text-1)", "--primary: var(--aired-primary)", "--ring: var(--aired-ring)", "--font-sans: var(--aired-font-sans)", "--radius-lg: var(--aired-radius-lg)"]) {
    assert.ok(dash.includes(alias), `dashboard maps ${alias}`);
  }
  // No palette hex values left in the dashboard theme: every colour is a token.
  const root = dash.slice(dash.indexOf(":root {"), dash.indexOf("}", dash.indexOf(":root {")));
  assert.doesNotMatch(root, /#[0-9a-f]{3,8}\b/i, "dashboard :root uses only tokens");
});
