---
name: aired
description: Publishes HTML files or strings to shareable live URLs via aired.sh. Use when the user wants to share, deploy, or publish an HTML artifact, dashboard, visualization, report, or any generated HTML — or when an agent needs to make HTML viewable in a browser. Supports PIN protection, custom expiry, and stdin piping. No auth required.
---

# aired

Publish HTML artifacts to shareable URLs. No signup, no auth, no deploy pipeline.

## Quick Start

```bash
# Publish a file → get a live URL
npx aired dashboard.html

# Pipe HTML from another command
echo "<h1>Hello</h1>" | npx aired --json | jq .url

# PIN-protected, expires in 24h
npx aired report.html --ttl 24h --pin secret123
```

## Commands

| Command | Description |
|---------|-------------|
| `aired [file]` | Publish HTML file or stdin (default command) |
| `aired update <id> <file>` | Update an existing page |
| `aired delete <id>` | Delete a page |
| `aired info <id>` | Show page metadata |
| `aired tokens` | List stored update tokens |
| `aired tokens prune` | Remove tokens for expired pages |
| `aired doctor` | Diagnostics (Node.js, API, token store) |

## Publish Flags

| Flag | Effect |
|------|--------|
| `-t, --title <title>` | Custom page title |
| `-p, --pin <pin>` | PIN-protect the page |
| `--ttl <duration>` | Expiry: `1h`, `24h`, `7d`, `30d` |
| `--permanent` | No expiry |
| `--reads <n>` | Auto-delete after N views |

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
| 3 | Rate limited (5 uploads/hour) |

## Update Flow

The first publish returns an `update_token` (saved to `~/.config/aired/tokens.json`). To update the same URL:

```bash
aired dashboard.html          # → publishes, saves token
aired update abc123 v2.html   # → updates same URL using stored token
```

Tokens are stored per page ID. `aired tokens` lists them. `aired tokens prune` removes expired ones.

## MCP Server

```bash
aired --mcp
```

Starts a stdio MCP server with a `publish_html` tool. Configure in Claude Code:

```bash
claude mcp add aired -- npx aired --mcp
```

The MCP tool accepts `html` (string), `file_path`, `title`, `pin`, `ttl_seconds`, `permanent`, `update_token`, and `id`.

## Gotchas

- **Rate limit is 5 uploads/hour per IP.** The API returns 429 and the CLI exits with code 3. Wait an hour or use a different network.
- **Update requires both ID and token.** The token alone can't find the page (KV has no reverse lookup). Always use `aired update <id> <file>`, not the raw API with just a token.
- **Tokens are local-only.** Stored in `~/.config/aired/tokens.json`. If you lose them, you can't update or delete the page. The `--json` output includes the token — pipe it somewhere safe.
- **Max file size is 2 MB.** The API rejects anything larger. For bigger artifacts, host them elsewhere.
- **PIN is not encryption.** Content is stored in plaintext on R2. PIN just gates browser access. Don't use aired for sensitive data.
- **Default expiry is 7 days.** Pages auto-delete unless `--permanent` is set. The TTL resets on update.
