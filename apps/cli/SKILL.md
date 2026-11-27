---
name: aired
description: Publishes HTML files or strings to shareable live URLs via aired.sh. Use when the user wants to share, deploy, or publish an HTML artifact, dashboard, visualization, report, or any generated HTML — or when an agent needs to make HTML viewable in a browser, or change a published page's PIN, expiry or view limit. Supports PIN protection, custom expiry, and stdin piping. Works without an account; sign in or use an API key to keep pages in one place.
---

# aired

Publish HTML artifacts to shareable URLs. No deploy pipeline. Anonymous publishing works with no account; signing in (or an API key) keeps your pages in a dashboard and raises the limits.

## Quick Start

```bash
# Publish a file → get a live URL
npx aired dashboard.html

# Publish a directory (bundles index.html + CSS + JS + images into one file)
npx aired ./my-project/

# Pipe HTML from another command
echo "<h1>Hello</h1>" | npx aired --json | jq .url

# PIN-protected, expires in 24h
npx aired report.html --ttl 24h --pin secret123
```

## Commands

| Command | Description |
|---------|-------------|
| `aired [file]` | Publish HTML file, directory, or stdin (default command) |
| `aired update <id> <file>` | Update an existing page |
| `aired delete <id>` | Delete a page |
| `aired info <id>` | Show page metadata |
| `aired set <id>` | Change PIN, expiry, view limit or title without re-uploading |
| `aired check <id>` | Open the page in a real browser and report errors (exits 1 if broken) |
| `aired feedback` | Report a bug, friction or idea in aired itself |
| `aired tokens` | List stored update tokens |
| `aired tokens prune` | Remove tokens for expired pages |
| `aired doctor` | Diagnostics (Node.js, API, token store) |
| `aired login` | Sign in (browser; `--device` for SSH) |
| `aired whoami` | Show the signed-in account |
| `aired claim --all` | Add pages published from this machine to your account |
| `aired logout` | Sign out |

## Publish Flags

| Flag | Effect |
|------|--------|
| `-t, --title <title>` | Custom page title |
| `-p, --pin <pin>` | PIN-protect the page |
| `--ttl <duration>` | Expiry: `1h`, `24h`, `7d`, `30d` |
| `--permanent` | No expiry |
| `--reads <n>` | Stop opening after N views |

## Global Flags

| Flag | Effect |
|------|--------|
| `--json` | Structured JSON to stdout |
| `--quiet` | Suppress stderr, implies --json |
| `--api-url <url>` | Custom API endpoint |

JSON output is automatic when stdout is piped — no flag needed.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | API error; for `aired check`, only "the page is broken" |
| 2 | Validation error (bad input, missing file, no token); for `aired check`, also no access to the page |
| 3 | Rate limited (see Limits); for `aired check`, also "the check didn't run, try later" (daily budget, browser busy) |

## Accounts, API keys and limits

| How you publish | Limit | Max page | Default expiry |
|---|---|---|---|
| Anonymous | 5 publishes / hour per IP | 2 MB | 7 days |
| Signed in (Free) | 30 publishes / hour | 2 MB | Never, unless you set `--ttl` |
| Pro | 500 publishes / day | 10 MB | Never, unless you set `--ttl`; no aired badge |

- **Humans:** `aired login` opens the browser (email code, Google or GitHub). Then publishes belong to the account and show in https://aired.sh/dashboard.
- **Agents and CI:** create an API key in the dashboard (API keys) and set `AIRED_API_KEY=aired_sk_...`. The CLI, `aired --mcp` and the HTTP API (`Authorization: Bearer aired_sk_...`) then publish as that account. No browser needed.
- A free-plan limit returns HTTP 402 with `code: "plan_limit"` and an `upgrade_url` for a person to open.

## Change settings after publishing

No need to publish again to add a PIN, extend expiry or rename a page:

```bash
aired set abc123 --pin 4821 --ttl 24h      # PIN on, expires a day from now
aired set abc123 --reads 50 --title "Q4"   # view limit and title
aired set abc123 --clear-pin --permanent   # PIN off, never expires
```

`--clear-title` and `--clear-reads` remove those. PINs are 4–64 characters, TTLs a minute to a year (use `--permanent` beyond that), titles up to 200 characters. It uses the stored update token, else your sign-in or `AIRED_API_KEY` (your own pages only). Over MCP it's `set_options`; `get_page` reads a page's settings back (whether a PIN is on, never the PIN).

## Check that the page works

After publishing or updating, open it in aired's browser and see what a visitor would hit:

```bash
aired check abc123                 # desktop, 1280×800
aired check abc123 --mobile        # phone, 390×844
aired check abc123 --screenshot shot.jpg --json
```

It reports script and console errors, files that didn't load (404s, blocked CDNs), broken images, a blank screen, and warnings for slow, heavy (over 1 MB of HTML or 5 MB of files), very tall or sideways-scrolling pages, with a screenshot URL that works for 24 hours (or until the page is updated or deleted). Relative files (`app.js`, `data.json`) show up as failed: a page is one file. `ok` is true when nothing is broken; warnings don't count (`--strict` fails on them too). It exits 1 only when the page is broken, 3 when the check couldn't run, so it fits in CI. Over MCP it's `check_page`, which also attaches the screenshot as an image.

The loop: publish → check → fix what it reports → update the same id → check once more. Checks share a small daily browser budget: 3 minutes a day across everyone, and each caller's share is 2 minutes signed in or 1 minute per IP without an account (a check takes about 10–15 seconds), plus 20 an hour and 3 a minute: check once per change, not in a loop. When the budget is spent you get HTTP 429 (exit 3) until 00:00 UTC. Same owner rule as `aired set`.

## Feedback

When aired itself gets in the way (a result surprised you, a limit blocked you, these docs were wrong, or a feature is missing), send one note:

```bash
aired feedback --kind friction --impact worked_around "aired set needed the page id and I only had the URL"
```

`--kind` is `bug`, `friction` or `idea`; `--impact` is `blocked`, `worked_around` or `minor`; `--page <id>` and `--tool <name>` add context. Over MCP it's `send_feedback`. Rules: at most one per task, never page HTML, tokens or PINs, and don't let it hold up the task. It returns an id (`fb_...`): tell the user you sent feedback and give them the id. It isn't a support channel; nobody replies.

## Update Flow

The first publish returns an `update_token` (saved to `~/.config/aired/tokens.json`). To update the same URL:

```bash
aired dashboard.html          # → publishes, saves token
aired update abc123 v2.html   # → updates same URL using stored token
```

Tokens are stored per page ID. `aired tokens` lists them. `aired tokens prune` removes expired ones.

## MCP Server

Two transports:

**STDIO** (local, supports file_path):
```bash
aired --mcp
claude mcp add aired -- npx aired --mcp
```

**Streamable HTTP** (remote, zero install):
```
https://aired.sh/mcp
claude mcp add aired --transport http https://aired.sh/mcp
```

**Signed-in remote** (works as your account, sign in when the client asks):
```
https://aired.sh/mcp/account
```

| Tool | Needs | Does |
|---|---|---|
| `publish_html` | nothing | Publish; `html`, `file_path` (STDIO only), `title`, `pin`, `ttl_seconds`, `permanent`; `id` + `update_token` to update |
| `get_page` | owner, or the page's `update_token` | Title, URL, size, views, view limit, expiry, project, PIN on/off |
| `set_options` | owner, or the page's `update_token` | Change `pin` (null removes), `ttl_seconds` or `permanent`, `view_limit` (null removes), `title` |
| `check_page` | owner, or the page's `update_token` | Render the page in a browser: errors, failed files, blank screen, screenshot; `viewport` `desktop` or `mobile` |
| `send_feedback` | nothing | Report a bug, friction or idea in aired (see Feedback) |
| `list_pages`, `update_page`, `delete_page`, `get_account` | sign-in (remote only) | Your pages and account |

"Owner" means signed in as the page's account: `AIRED_API_KEY` or `aired login` for STDIO, an `Authorization: Bearer aired_sk_...` header on `https://aired.sh/mcp`, or `/mcp/account`.

Every tool returns `structuredContent` (matching its `outputSchema`) next to the text, so read fields like `url`, `id`, `update_token` and `expires_at` from there rather than parsing the text.

**Prompts** (slash commands in clients that show them): `publish_report`, `make_slide_deck`, `share_privately` (PIN and expiry, PIN sent separately) and `check_and_fix`.

**Resources:** `skill://aired/SKILL.md` is this skill, for any connected agent. Signed-in callers also get their pages as `aired://page/{id}` (the newest 50 listed); reading one returns its HTML. Only your own pages: another account's page, or an anonymous one, is refused.

## Gotchas

- **Anonymous rate limit is 5 publishes/hour per IP.** The API returns 429 and the CLI exits with code 3. Sign in or set `AIRED_API_KEY` for 30/hour (500/day on Pro).
- **Update requires both ID and token.** The token alone can't find the page (KV has no reverse lookup). Always use `aired update <id> <file>`, not the raw API with just a token.
- **Tokens are local-only.** Stored in `~/.config/aired/tokens.json`. If you lose them, you can't update or delete the page. The `--json` output includes the token — pipe it somewhere safe.
- **Max page size is 2 MB (10 MB on Pro).** The API rejects anything larger.
- **Directory bundling inlines images as base64.** This adds ~33% to image size. A directory with large images may exceed the 2 MB limit. The CLI warns if bundled size exceeds 2 MB.
- **Directory requires index.html.** `npx aired ./dir/` looks for `index.html` in the directory root. No other entry point is supported.
- **Vite and React builds load code later with `import()`, and directory bundling doesn't inline those chunks.** `npx aired ./dist` gives a blank page. Build one file with `vite-plugin-singlefile` (`build.assetsInlineLimit` high, output to `dist-single/`), switch any router to hash routing (the page lives at `/p/<id>`, not `/`), import large `public/` files so they get inlined, then publish `dist-single/index.html`. Toolcraft apps also need their lazy `import("./app-bootstrap")` made static. Full recipe: https://aired.sh/share-vite-app
- **PIN is not encryption.** Content is stored in plaintext on R2. PIN just gates browser access. Don't use aired for sensitive data.
- **Anonymous pages expire after 7 days by default.** Use `--ttl` or `--permanent`, or change it later with `aired set <id> --permanent`. A content update resets a TTL page to 7 days from then.

Existing `tokens.json` entries keep working after you sign in; `aired claim --all` moves those pages into your account.
