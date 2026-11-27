import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { hasFlag, sourceOf } from "../../dashboard/src/lib/sources.ts";

test("referrer hosts get friendly names, and unknown sites keep their host", () => {
  const cases: [string, string, string][] = [
    ["", "direct", "Direct or an app"],
    ["app.slack.com", "slack", "Slack"],
    ["com.slack", "slack", "Slack"],
    ["mail.google.com", "gmail", "Gmail"],
    ["com.google.android.gm", "gmail", "Gmail"],
    ["google.com", "google", "Google Search"],
    ["google.co.uk", "google", "Google Search"],
    ["t.co", "x", "X"],
    ["lnkd.in", "linkedin", "LinkedIn"],
    ["l.facebook.com", "facebook", "Facebook"],
    ["l.instagram.com", "instagram", "Instagram"],
    ["out.reddit.com", "reddit", "Reddit"],
    ["github.com", "github", "GitHub"],
    ["acme.notion.site", "notion", "Notion"],
    ["discord.com", "discord", "Discord"],
    ["teams.microsoft.com", "teams", "Microsoft Teams"],
    ["outlook.office.com", "outlook", "Outlook"],
    ["web.whatsapp.com", "whatsapp", "WhatsApp"],
    ["t.me", "telegram", "Telegram"],
    ["chatgpt.com", "chatgpt", "ChatGPT"],
    ["claude.ai", "claude", "Claude"],
    ["bing.com", "bing", "Bing"],
    ["duckduckgo.com", "duckduckgo", "DuckDuckGo"],
    ["example.org", "other", "example.org"],
    ["google.com.evil.example", "other", "google.com.evil.example"],
  ];
  for (const [host, key, name] of cases) assert.deepEqual(sourceOf(host), { key, name }, host);
});

test("flags are drawn for two-letter codes only; unknown and Tor get the globe", () => {
  assert.equal(hasFlag("US"), true);
  assert.equal(hasFlag("XX"), false);
  assert.equal(hasFlag("T1"), false);
  assert.equal(hasFlag("us"), false);
  assert.equal(hasFlag("../x"), false);
});

/** Every file under a directory. */
function walk(dir: URL): string[] {
  return readdirSync(dir).flatMap((f) => {
    const u = new URL(f, dir);
    return statSync(u).isDirectory() ? walk(new URL(f + "/", dir)) : [readFileSync(u, "utf8")];
  });
}

test("the dashboard never fetches favicons or flags from another site", () => {
  const src = walk(new URL("../../dashboard/src/", import.meta.url)).join("\n");
  assert.doesNotMatch(src, /favicon\.ico|s2\/favicons|faviconkit|icon\.horse|icons\.duckduckgo|logo\.clearbit|flagcdn|flagsapi|cdn\.jsdelivr|unpkg\.com/i);
  const icons = readFileSync(new URL("../../dashboard/src/components/source-icon.tsx", import.meta.url), "utf8");
  assert.match(icons, /src=\{`\/dashboard-assets\/flags\/\$\{code\}\.svg`\}/);
  const vite = readFileSync(new URL("../../dashboard/vite.config.ts", import.meta.url), "utf8");
  assert.match(vite, /country-flag-icons\/3x2\//);
});
