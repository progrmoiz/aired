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

# Publish a directory (bundles index.html + CSS + JS + images)
npx aired ./my-project/

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

# Change PIN, expiry, view limit or title without re-uploading
npx aired set <id> --pin 4821 --ttl 24h --reads 50

# Tell the aired team about a bug, friction or idea
npx aired feedback --kind friction "what happened"

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

### MCP

Two transports: **Streamable HTTP** (remote, zero install) and **STDIO** (local, supports `file_path`).

#### Claude Code

```bash
# Remote (recommended)
claude mcp add aired --transport http https://aired.sh/mcp

# Local
claude mcp add aired -- npx aired --mcp
```

#### Cursor

Add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "aired": { "url": "https://aired.sh/mcp" }
  }
}
```

#### VS Code (GitHub Copilot)

Add to `.vscode/mcp.json`:
```json
{
  "servers": {
    "aired": { "type": "http", "url": "https://aired.sh/mcp" }
  }
}
```

#### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "aired": { "serverUrl": "https://aired.sh/mcp" }
  }
}
```

#### Codex

Add to `~/.codex/config.toml`:
```toml
[mcp_servers.aired]
url = "https://aired.sh/mcp"
```

#### Gemini CLI

```bash
gemini mcp add --transport http aired https://aired.sh/mcp
```

#### Others

Any MCP client that supports Streamable HTTP can connect to `https://aired.sh/mcp`. For STDIO-only clients, use the `mcp-remote` bridge:

```json
{
  "mcpServers": {
    "aired": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://aired.sh/mcp"]
    }
  }
}
```

#### Available tool: `publish_html`
- `html` — HTML string to publish
- `file_path` — path to HTML file (STDIO only)
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
Content-Type: application/json

{ "html": "<html>...v2...</html>", "update_token": "at_..." }
```

The token can go in the body (above) or as `Authorization: Bearer at_...`.

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

## Accounts (optional)

Sign in at aired.sh to manage all your pages in one place.
Anonymous publish still works without an account.

**Pro** ($9/month billed yearly, or $12 monthly) removes the aired badge and raises the limits to 10 MB pages and 500 publishes a day. Free stays free. See [aired.sh/pricing](https://aired.sh/pricing).

CLI:
```bash
npx aired login              # browser flow
npx aired login --device     # SSH-friendly fallback
npx aired claim --all        # add your pages to your account (each gets a new token)
npx aired whoami
npx aired logout
```

**API keys (CI and agents).** Create one under API keys in the dashboard and set `AIRED_API_KEY`; the CLI, the local MCP server and the HTTP API (`Authorization: Bearer aired_sk_…`) then publish to your account.

**Signed-in MCP.** Add `https://aired.sh/mcp/account` as a connector (Claude, ChatGPT, Cursor, VS Code): you sign in on aired and the server works as your account, adding `list_pages`, `update_page`, `delete_page` and `get_account`. `https://aired.sh/mcp` stays anonymous unless you send an API key; anonymous callers still get `get_page` and `set_options` with a page's update token, and `send_feedback`.

Managing API keys, billing and deleting the account only work on the website, not from the CLI, an API key or a connected app. Sign out everywhere (under Account in the dashboard) ends every session, CLI login and connected app; API keys keep working until you revoke them. Deleting the account ends all of them and deletes the keys.

---

## Self-hosting

Aired runs as one Cloudflare Worker: KV for page records and accounts, R2 for the HTML, D1 for accounts, billing, API keys and sign-in, and Workers Rate Limiting bindings as flood guards. Deployment requires a Cloudflare account.

```bash
# Clone and build
git clone https://github.com/progrmoiz/aired
cd aired
pnpm install
pnpm run build

# Create the storage, then put the IDs in apps/worker/wrangler.toml
cd apps/worker
wrangler kv namespace create PAGES_KV     # also bound as OAUTH_KV (same id)
wrangler r2 bucket create aired-pages
wrangler d1 create aired

# Secrets (see .dev.vars.example for local values)
wrangler secret put SESSION_SECRET        # 32+ random characters
wrangler secret put SESSION_VALID_SINCE   # ISO date; sessions, API keys and MCP connections created before it stop working
wrangler secret put GITHUB_CLIENT_ID      # a GitHub OAuth app, callback <your origin>/auth/callback
wrangler secret put GITHUB_CLIENT_SECRET

# Deploy: checks, D1 migrations, a deploy tagged with the commit, then /health
# (scripts/deploy.sh; set DEPLOY_ORIGIN to your origin for the health check)
npm run deploy
```

- The `[[ratelimits]]` bindings in `wrangler.toml` (`PUBLISH_BURST`, `REPORT_BURST`, `PIN_GUESS`, `PIN_GUESS_PAGE`, `DEVICE_BURST`, `OAUTH_BURST`, `SIGNIN_BURST`, `FAVICON_BURST`) need no setup; give them your own `namespace_id`s if you run more than one deployment in an account.
- Set `SITE_ORIGIN` if you're not serving from aired.sh, and change the `[[routes]]` to your domain. Every link the Worker writes follows it (`src/lib/origin.ts`); the static pages in `apps/web/` still say aired.sh.
- Optional, off until set: billing (`BILLING_ENABLED`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`, `STRIPE_MANAGED_PAYMENTS`) and WorkOS sign-in (`WORKOS_CLIENT_ID`, `WORKOS_API_KEY`).
- The `[browser]` binding (`BROWSER`, Cloudflare Browser Rendering) takes each page's link-preview screenshot, which `/og/:id` serves; it needs no setup. Screenshots stop for the day after 8 minutes of browser time (Workers Free allows 10); set `OG_SHOT_DAILY_SECONDS` to change that, or `0` to keep the generated card for every page.
- The `[assets]` directive serves the site from `apps/web/`, and a Cron Trigger every 5 minutes removes expired pages' files from R2.

---

## Limits

| Limit | Value |
|-------|-------|
| Max page size | 2 MB (Free), 10 MB (Pro) |
| Publishes | 5 / hour / IP anonymously, 30 / hour signed in on Free, 500 / day on Pro |
| Default TTL | 7 days |
| Max PIN length | 20 chars |

---

## License

MIT — see [LICENSE](./LICENSE)
