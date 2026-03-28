# aired

Publish HTML artifacts to shareable URLs instantly. No signup. No friction.

```
npx aired file.html
→ https://aired.sh/p/a1b2c3d4e5
```

Works from the CLI, as an MCP tool for AI agents, or by pasting at [aired.sh](https://aired.sh).

---

## Quick start

### CLI

```bash
# Publish a file
npx aired file.html

# With options
npx aired file.html --ttl 1h --pin 1234

# Permanent (no expiry)
npx aired file.html --permanent

# Stdin
cat page.html | npx aired --title "My Page"

# JSON output
npx aired file.html --json

# Update same URL
npx aired update <id> new-version.html

# Page info
npx aired info <id>

# Manage stored tokens
npx aired tokens
npx aired tokens prune

# Delete a page
npx aired delete <id>

# Diagnostics
npx aired doctor
```

### Skills (AI agents)

```bash
npx skills add progrmoiz/aired
```

Adds a `SKILL.md` to your project. Any AI agent discovers and uses `aired` automatically.

### MCP (Claude Code, Cursor, Windsurf)

```bash
claude mcp add aired -- npx aired --mcp
```

Then in Claude: "Publish this HTML artifact" → get a live URL.

Available tool: `publish_html`
- `html` — HTML string to publish
- `file_path` — path to HTML file (alternative to `html`)
- `title` — page title
- `pin` — PIN to protect access
- `ttl_seconds` — time to live (default: 604800 = 7 days)
- `permanent` — if true, page never expires
- `update_token` — pass a previous token to update the same URL

### Web

Visit [aired.sh](https://aired.sh), paste HTML, click "Air it".

---

## API

Base URL: `https://aired.sh`

### Publish

```
POST /api/publish
Content-Type: application/json

{
  "html": "<html>...</html>",
  "title": "My Page",       // optional
  "pin": "1234",            // optional
  "ttl": 86400,             // optional, seconds (default: 604800)
  "permanent": false,       // optional
  "reads": 10,              // optional, max read count
  "update_token": "at_..."  // optional, update existing page
}
```

Response:
```json
{
  "id": "a1b2c3d4e5",
  "url": "https://aired.sh/p/a1b2c3d4e5",
  "update_token": "at_xK9mN2pQr7...",
  "expiresAt": "2026-04-04T12:00:00Z"
}
```

### Get page metadata

```
GET /api/pages/:id
```

Response:
```json
{
  "id": "a1b2c3d4e5",
  "title": "My Page",
  "size": 4523,
  "readCount": 3,
  "expiresAt": "2026-04-04T12:00:00Z"
}
```

### Update a page

```
PUT /api/pages/:id
Authorization: Bearer at_xK9mN2pQr7...
Content-Type: application/json

{ "html": "<html>...v2...</html>", "update_token": "at_..." }
```

### Delete a page

```
DELETE /api/pages/:id
Authorization: Bearer at_xK9mN2pQr7...
```

### Report a page

```
POST /api/report
Content-Type: application/json

{ "id": "a1b2c3d4e5", "reason": "phishing" }
```

### View a page

```
GET /p/:id
```

Serves the raw HTML. If PIN-protected, serves a PIN entry page first.

---

## Self-hosting

Aired runs on Cloudflare Workers + R2 + KV. Deployment requires a Cloudflare account.

```bash
# Clone
git clone https://github.com/progrmoiz/aired
cd aired
pnpm install

# Configure (create KV namespace and R2 bucket)
wrangler kv:namespace create PAGES_KV
wrangler r2 bucket create aired-pages

# Update apps/worker/wrangler.toml with your KV namespace ID

# Deploy
cd apps/worker
wrangler deploy
```

The `[assets]` directive in `wrangler.toml` automatically serves the landing page from `apps/web/`.

---

## Limits (v1)

| Limit | Value |
|-------|-------|
| Max page size | 2 MB |
| Rate limit | 5 uploads / hour / IP |
| Default TTL | 7 days |
| Max PIN length | 20 chars |

---

## License

MIT — see [LICENSE](./LICENSE)
