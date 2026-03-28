# aired — CLI for publishing HTML artifacts

Publish HTML files to shareable URLs. Works with any AI tool (Claude Code, Cursor, ChatGPT).

## Setup

No auth required. Anonymous by default.

```bash
# Install globally
npm install -g aired

# Or use directly
npx aired file.html
```

Optional: set `AIRED_API_URL` env var for custom API endpoint.

## Commands

### publish (default)

Publish an HTML file to a shareable URL.

```bash
aired file.html
aired file.html --json
cat file.html | aired
aired file.html --ttl 24h --pin secret123
aired file.html --permanent
```

**Flags:** `--title`, `--pin`, `--ttl <1h|24h|7d|30d>`, `--permanent`, `--reads <n>`

**JSON output:**
```json
{
  "id": "abc123",
  "url": "https://aired.sh/p/abc123",
  "update_token": "at_...",
  "expiresAt": "2026-04-04T12:00:00.000Z"
}
```

### update

Update an existing page.

```bash
aired update <id> new-file.html
aired update <id> new-file.html --json
```

### delete

Delete a page.

```bash
aired delete <id>
aired delete <id> --json
```

### info

Show page metadata.

```bash
aired info <id>
aired info <id> --json
```

**JSON output:**
```json
{
  "id": "abc123",
  "title": "My Dashboard",
  "size": 4096,
  "readCount": 5,
  "expiresAt": "2026-04-04T12:00:00.000Z"
}
```

### tokens

List stored tokens.

```bash
aired tokens
aired tokens --json
aired tokens prune
```

### doctor

Run diagnostic checks.

```bash
aired doctor
aired doctor --json
```

**JSON output:**
```json
{
  "ok": true,
  "checks": [
    { "name": "CLI Version", "status": "pass", "message": "v0.1.0" },
    { "name": "Node.js", "status": "pass", "message": "v22.19.0" },
    { "name": "Token Store", "status": "pass", "message": "2 tokens at ~/.config/aired/tokens.json" },
    { "name": "API", "status": "pass", "message": "https://aired.sh" }
  ]
}
```

## Global Flags

| Flag | Effect |
|------|--------|
| `--json` | Force JSON output |
| `--quiet` | Suppress stderr, implies --json |
| `--verbose` | Extended output |
| `--api-url <url>` | Custom API endpoint |

When stdout is piped, JSON is automatic.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | API error |
| 2 | Validation error |
| 3 | Rate limited |

## MCP Server

Spawn the MCP stdio server:

```bash
aired --mcp
```

This starts the `@aired/mcp` package as a stdio MCP server with a `publish_html` tool.

## Common Workflows

### Publish and share
```bash
aired dashboard.html
# → https://aired.sh/p/abc123
```

### Update same URL
```bash
aired dashboard.html        # first publish
aired update abc123 v2.html  # update same URL
```

### Temporary with PIN
```bash
aired report.html --ttl 24h --pin secret
```

### Pipe from stdin
```bash
echo "<h1>Hello</h1>" | aired --json | jq .url
```

### Clean up expired tokens
```bash
aired tokens prune
```
