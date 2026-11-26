# aired

```
 █████╗ ██╗██████╗ ███████╗██████╗
██╔══██╗██║██╔══██╗██╔════╝██╔══██╗
███████║██║██████╔╝█████╗  ██║  ██║
██╔══██║██║██╔══██╗██╔══╝  ██║  ██║
██║  ██║██║██║  ██║███████╗██████╔╝
╚═╝  ╚═╝╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
```

**Publish HTML artifacts to shareable URLs instantly.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](../../LICENSE)

---

## Why

AI tools generate beautiful HTML — dashboards, visualizations, reports — but sharing them is broken. You either email raw `.html` files or wrestle with GitHub Pages. Aired gives you `npx aired file.html` → live URL in 2 seconds.

---

## Install

**Instant (no install):**
```bash
npx aired file.html
```

**Global install:**
```bash
npm install -g aired
aired --version
```

> Requires Node.js >= 20

---

## Quick Start

```bash
# 1. Publish an HTML file
aired dashboard.html

# 2. See it live
# → https://aired.sh/p/abc123

# 3. Update the same URL
aired update abc123 dashboard-v2.html
```

---

## Commands

### Publishing

| Command | Description |
|---------|-------------|
| `publish [file]` | Publish an HTML file (or pipe via stdin) |
| `update <id> <file>` | Update an existing page using the stored token |
| `delete <id>` | Delete a page using the stored token |
| `info <id>` | Show page metadata (title, size, reads, expiry) |

### Management

| Command | Description |
|---------|-------------|
| `tokens` | List stored tokens |
| `tokens prune` | Remove tokens for pages that no longer exist |
| `doctor` | Run diagnostic checks |

### Publish Options

| Flag | Description |
|------|-------------|
| `-t, --title <title>` | Custom title |
| `-p, --pin <pin>` | PIN-protect the page |
| `--ttl <duration>` | Expiry: `1h`, `24h`, `7d`, `30d` |
| `--permanent` | No expiry |
| `--reads <n>` | Max read count before page is gone |

---

## Output Modes

| Flag | Output |
|------|--------|
| *(default)* | Human-readable, colored terminal output |
| `--json` | Machine-readable JSON |
| `--quiet` | Suppress stderr, JSON only |
| `--verbose` | Extended detail |

When stdout is piped, JSON output is automatic — no flag needed.

```bash
aired file.html --json
aired file.html | jq .url
echo "<h1>Hi</h1>" | aired --json
```

---

## Configuration

| Source | Priority |
|--------|----------|
| `--api-url <url>` flag | Highest |
| `AIRED_API_URL` env var | Medium |
| Default (`https://aired.sh`) | Lowest |

`AIRED_API_KEY`: an API key (`aired_sk_…`, from **API keys** in the dashboard). When set, every publish, update and delete runs as that account, which suits CI. A set but malformed value is an error, never an anonymous publish.

Token store: `~/.config/aired/tokens.json` (mode `0600`).

---

## MCP Server

Spawn the MCP server for AI tool integration:

```bash
aired --mcp
```

This starts a stdio MCP server with a `publish_html` tool. Configure in your AI tool's MCP settings.

---

## AI Agent Integration

Every command outputs structured JSON. Exit codes are consistent:

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | API error |
| 2 | Validation error |
| 3 | Rate limited |

---

## Accounts (optional)

Sign in to manage all your pages in one place.
Anonymous publish still works without an account.

```bash
npx aired login              # browser flow
npx aired login --device     # SSH-friendly fallback
npx aired claim --all        # add your pages to your account (each gets a new token)
npx aired whoami
npx aired logout
```

Session is stored in `~/.config/aired/session.json` (mode 0600).

---

## License

MIT — see [LICENSE](../../LICENSE)
