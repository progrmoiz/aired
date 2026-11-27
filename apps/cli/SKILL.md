---
name: aired
description: Publishes HTML files or strings to shareable live URLs via aired.sh. Use when the user wants to share, deploy, or publish an HTML artifact, dashboard, visualization, report, or any generated HTML — or when an agent needs to make HTML viewable in a browser. Supports PIN protection, custom expiry, and stdin piping. Works without an account; sign in or use an API key to keep pages in one place.
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
| 1 | API error |
| 2 | Validation error (bad input, missing file, no token) |
| 3 | Rate limited (see Limits) |

## Accounts, API keys and limits

| How you publish | Limit | Max page | Default expiry |
|---|---|---|---|
| Anonymous | 5 publishes / hour per IP | 2 MB | 7 days |
| Signed in (Free) | 30 publishes / hour | 2 MB | Never, unless you set `--ttl` |
| Pro | 500 publishes / day | 10 MB | Never, unless you set `--ttl`; no aired badge |

- **Humans:** `aired login` opens the browser (email code, Google or GitHub). Then publishes belong to the account and show in https://aired.sh/dashboard.
- **Agents and CI:** create an API key in the dashboard (API keys) and set `AIRED_API_KEY=aired_sk_...`. The CLI, `aired --mcp` and the HTTP API (`Authorization: Bearer aired_sk_...`) then publish as that account. No browser needed.
- A free-plan limit returns HTTP 402 with `code: "plan_limit"` and an `upgrade_url` for a person to open.

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

`publish_html` accepts `html` (string), `file_path` (STDIO only), `title`, `pin`, `ttl_seconds`, `permanent`, `update_token`, and `id`. With an API key (`AIRED_API_KEY` for STDIO, or an `Authorization: Bearer` header on `https://aired.sh/mcp`) or on `/mcp/account`, four more tools work: `list_pages`, `update_page` (by id, no token), `delete_page` and `get_account`.

## Gotchas

- **Anonymous rate limit is 5 publishes/hour per IP.** The API returns 429 and the CLI exits with code 3. Sign in or set `AIRED_API_KEY` for 30/hour (500/day on Pro).
- **Update requires both ID and token.** The token alone can't find the page (KV has no reverse lookup). Always use `aired update <id> <file>`, not the raw API with just a token.
- **Tokens are local-only.** Stored in `~/.config/aired/tokens.json`. If you lose them, you can't update or delete the page. The `--json` output includes the token — pipe it somewhere safe.
- **Max page size is 2 MB (10 MB on Pro).** The API rejects anything larger.
- **Directory bundling inlines images as base64.** This adds ~33% to image size. A directory with large images may exceed the 2 MB limit. The CLI warns if bundled size exceeds 2 MB.
- **Directory requires index.html.** `npx aired ./dir/` looks for `index.html` in the directory root. No other entry point is supported.
- **Vite and React builds load code later with `import()`, and directory bundling doesn't inline those chunks.** `npx aired ./dist` gives a blank page. Build one file with `vite-plugin-singlefile` (`build.assetsInlineLimit` high, output to `dist-single/`), switch any router to hash routing (the page lives at `/p/<id>`, not `/`), import large `public/` files so they get inlined, then publish `dist-single/index.html`. Toolcraft apps also need their lazy `import("./app-bootstrap")` made static. Full recipe: https://aired.sh/share-vite-app
- **PIN is not encryption.** Content is stored in plaintext on R2. PIN just gates browser access. Don't use aired for sensitive data.
- **Anonymous pages expire after 7 days by default.** Use `--ttl` or `--permanent`. The TTL resets on update.

Existing `tokens.json` entries keep working after you sign in; `aired claim --all` moves those pages into your account.
