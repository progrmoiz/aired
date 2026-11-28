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
| `get_page` | owner, or the `update_token` | Title, URL, size, views, view limit, expiry, project, PIN on or off, doc or deck, live `version`, `updated_at`; `include_source` adds the Markdown or HTML as published and a deck's notes, so you can edit it and update the page from anywhere. On your own deck, signed in: `slide_stats` (Pro: per slide `reached`, `median_seconds`, `drop_off`, last 30 days) or `slide_stats_upgrade_url` (Free) |
| `set_options` | owner, or the `update_token` | Change `pin` (null removes), `ttl_seconds` or `permanent`, `view_limit` (null removes), `title`, `allow_pdf` (viewers can download a PDF); signed in: `access`, `public_results`, `accept_responses` |
| `list_versions` | owner, or the `update_token` | Every version kept, newest first, with who made it, when, size and note |
| `restore_version` | owner, or the `update_token` | Put `version` back as a new version; a page with responses needs the owner |
| `check_page` | owner, or the `update_token` | Render the page in a browser: errors, failed files, blank screen, screenshot; `viewport` `desktop` or `mobile` |
| `export_pdf` | owner, or the `update_token`; `notes` needs the owner | Turn the page into a PDF: `download_url` (15 minutes), `filename`, `pages`, `cached`; `paper` `a4` or `letter`; `notes` for a deck's speaker notes |
| `send_feedback` | nothing | Report a bug, friction or idea in aired itself |
| `get_responses` | owner, signed in | What viewers saved with `aired.collect`; `limit` (up to 200), `cursor`, `format: "csv"` |
| `update_data` | owner, signed in | Push JSON a page reads with `aired.data`, without republishing |
| `list_pages`, `update_page`, `delete_page`, `get_account` | signed in, remote server only | Your pages and account |

Every tool returns `structuredContent` that matches its `outputSchema`, next to the text. Read `url`, `id`, `update_token` and `expires_at` from there.

To pick up a page where you left off: `list_pages` (signed in; each has `updated_at`), then `get_page` with `include_source: true`, edit `source`, and send it back with `update_page` or `publish_html` (`id` + `update_token`), with `deck: true` for a deck. Anyone who has the page open sees the new version without reloading: within about 5 seconds if they opened it in the last 2 minutes, then within 15 seconds, then within a minute.

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

Every caller also gets the page card, `ui://aired/page-card-v1.html` (below).

Signed-in callers also get their own pages as `aired://page/{id}` (the newest 50 are listed). Reading one returns its HTML, or its Markdown for a Markdown page (a deck's HTML with its notes). Another account's page, or an anonymous one, is refused.

## Page card (MCP Apps)

Chat apps that support MCP Apps draw a card under `publish_html`, `get_page`, `update_page` and `restore_version`: the page's screenshot, title and link, views, who can open it and when it expires, with Open and Copy link, and Views and Sharing (in the dashboard) for the signed-in owner. Claude (web, desktop, mobile), ChatGPT, VS Code, Cursor and Goose show it; Claude Code and other text-only clients don't, and get the same text and `structuredContent` as always.

- Nothing to call: the tools link to the card themselves (`_meta.ui.resourceUri`).
- Still give the link in your reply. The card is for the person; not every client shows it.
- The card never shows the update token, the PIN or the claim link. Pass those on in text as before, when the person needs them.
- The local server (`npx aired --mcp`) shows the same card in desktop apps that run local servers, on `publish_html`, `get_page` and `restore_version`.
