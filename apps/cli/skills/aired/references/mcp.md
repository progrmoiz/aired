# aired MCP reference

## Servers

| Server | Add it to Claude Code | Notes |
|---|---|---|
| Remote, anonymous or API key | `claude mcp add aired --transport http https://aired.sh/mcp` | Send `Authorization: Bearer aired_sk_...` to act as your account |
| Remote, signed in | `claude mcp add aired --transport http https://aired.sh/mcp/account` | Signs in when the client asks |
| Local (stdio) | `claude mcp add aired -- npx aired --mcp` | Can publish a local file with `file_path`; signed in with `AIRED_API_KEY` or `aired login` |

## Tools

"Owner" means signed in as the page's account: `AIRED_API_KEY` or `aired login` for the local server, the API key header on `/mcp`, or `/mcp/account`.

| Tool | Needs | Does |
|---|---|---|
| `publish_html` | nothing | Publish `html` or `markdown`, with `deck`, `title`, `pin`, `ttl_seconds`, `permanent`; `id` + `update_token` to update (owner: `id` alone); `message` labels the version; `file_path` and `project` on the local server |
| `get_template` | nothing | Starters: `deck`, `deck-html`, `report`, `one-pager` (no name lists them) |
| `get_page` | owner, or the `update_token` | Title, URL, size, views, view limit, expiry, project, PIN on or off, doc or deck, live `version`; `include_source` adds the Markdown or HTML as published and a deck's notes |
| `set_options` | owner, or the `update_token` | Change `pin` (null removes), `ttl_seconds` or `permanent`, `view_limit` (null removes), `title`; signed in: `access`, `public_results`, `accept_responses` |
| `list_versions` | owner, or the `update_token` | Every version kept, newest first, with who made it, when, size and note |
| `restore_version` | owner, or the `update_token` | Put `version` back as a new version; a page with responses needs the owner |
| `check_page` | owner, or the `update_token` | Render the page in a browser: errors, failed files, blank screen, screenshot; `viewport` `desktop` or `mobile` |
| `send_feedback` | nothing | Report a bug, friction or idea in aired itself |
| `get_responses` | owner, signed in | What viewers saved with `aired.collect`; `limit` (up to 200), `cursor`, `format: "csv"` |
| `update_data` | owner, signed in | Push JSON a page reads with `aired.data`, without republishing |
| `list_pages`, `update_page`, `delete_page`, `get_account` | signed in, remote server only | Your pages and account |

Every tool returns `structuredContent` that matches its `outputSchema`, next to the text. Read `url`, `id`, `update_token` and `expires_at` from there.

`set_options` with `access`:

```json
{ "id": "abc123", "access": { "mode": "people", "emails": ["alice@client.com"], "domains": ["client.com"] } }
```

`"mode": "public"` removes the PIN and the list; `"mode": "pin"` uses the PIN in `pin`. Sending a list replaces the old one.

## Prompts

Clients that show prompts list these as slash commands:

| Prompt | Does | Skill |
|---|---|---|
| `publish_report` | A Markdown report from the `report` template | `aired-report` |
| `make_slide_deck` | A deck with speaker notes from the `deck` template | `aired-slides` |
| `share_privately` | A PIN and an expiry, with the PIN sent separately | `aired-report` |
| `check_and_fix` | Check a page, fix it, update it at the same link | `aired` |

## Resources

Every caller gets the skills:

| URI | What |
|---|---|
| `skill://aired/SKILL.md` | This core skill |
| `skill://aired/references/cli.md`, `mcp.md`, `bundling.md`, `troubleshooting.md` | Its reference files |
| `skill://aired/aired-slides/SKILL.md` | Slide decks |
| `skill://aired/aired-dashboard/SKILL.md` | Live dashboards |
| `skill://aired/aired-report/SKILL.md` | Reports and private sharing |
| `skill://aired/aired-forms/SKILL.md` | Pages that collect answers |

Signed-in callers also get their own pages as `aired://page/{id}` (the newest 50 are listed). Reading one returns its HTML, or its Markdown for a Markdown page (a deck's HTML with its notes). Another account's page, or an anonymous one, is refused.
