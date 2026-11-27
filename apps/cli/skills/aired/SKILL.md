---
name: aired
description: Publishes HTML or Markdown to shareable links with aired.sh, from the CLI (npx aired) or the aired MCP server. Use when the user wants to share, publish, host or send an HTML page, Markdown doc, report, dashboard, slide deck or form as a link, or change a published page's PIN, expiry, view limit or who can open it. Works without an account; sign in or use an API key to keep pages and raise limits. For slide decks also load aired-slides, for live dashboards aired-dashboard, for client reports and private sharing aired-report, and for pages that collect answers aired-forms.
---

# aired

aired turns one HTML or Markdown file into a link at `https://aired.sh/p/<id>`. No deploy, no account needed. Signing in (or an API key) keeps your pages in a dashboard, raises the limits and unlocks the data features.

## Publish

```bash
npx aired page.html                  # a file → prints the link
npx aired notes.md                   # Markdown → a clean reading page
npx aired ./site/                    # a folder with index.html; CSS, JS and images are put inside the page
echo "<h1>Hi</h1>" | npx aired --json  # stdin; JSON is automatic when piped
npx aired report.html --pin 4821 --ttl 24h
```

Over MCP it's `publish_html` with `html` or `markdown` (plus `title`, `pin`, `ttl_seconds`, `permanent`). Read `url`, `id` and `update_token` from the result's `structuredContent`, not from the text.

Markdown renders as a readable page in light and dark, with highlighted code, tables and task lists. Front matter `title:` (or the first `# heading`) sets the title. Raw HTML inside Markdown shows as text, so publish an `.html` file when you need custom HTML.

## The loop

1. Publish. Keep the `id` and the `update_token`.
2. Check it: `aired check <id>` or `check_page`. It opens the page in a real browser and lists errors, failed files and a blank screen, with a screenshot.
3. Fix what it reports and update the same id: `aired update <id> page.html -m "Fix chart"`, or `publish_html` with `id` and `update_token` (signed in, `id` alone is enough for your own page).
4. Check once more, then give the user the link.

Checks share a small daily browser budget, so check once per change, not in a loop.

## Send it as a PDF

When the user wants an attachment, a file to email or something to print, make a PDF instead of (or as well as) sending the link:

```bash
aired pdf <id>                      # saves q3-update.pdf here (a name from the page title)
aired pdf <id> -o report.pdf --paper a4
```

Over MCP it's `export_pdf` with `id` (and `update_token` unless signed in as the owner). It returns a `download_url` that works for 15 minutes: give it to the user or download it. A deck prints one slide per page; a doc or page prints on A4 or Letter with page numbers. Free PDFs carry a small "Made with aired" line; Pro PDFs don't. Asking again for the same version uses no browser time.

To let viewers download it themselves, turn on the PDF button: `aired set <id> --allow-pdf`, or `set_options` with `allow_pdf: true`. It doesn't work on a page with a view limit.

## Load the skill for the job

| The user wants | Load | Over MCP |
|---|---|---|
| A presentation, pitch deck or talk slides | `aired-slides` | `skill://aired/aired-slides/SKILL.md` |
| A dashboard or status page that stays up to date | `aired-dashboard` | `skill://aired/aired-dashboard/SKILL.md` |
| A client report or one-pager, shared privately, with undo | `aired-report` | `skill://aired/aired-report/SKILL.md` |
| A form, poll, quiz, sign-up sheet or tracker that saves answers | `aired-forms` | `skill://aired/aired-forms/SKILL.md` |

Anything else (a prototype, a chart, a game, a page from a build): this skill is enough.

## Sign-in and limits

| How you publish | Publishes | Max page | Default expiry |
|---|---|---|---|
| Anonymous | 5 an hour per IP | 2 MB | 7 days |
| Signed in, Free | 30 an hour | 2 MB | Never, unless you set one |
| Pro | 500 a day | 10 MB | Never, unless you set one |

- **A person:** `aired login` (browser), or `aired login --device` over SSH. `aired claim --all` moves pages published from this machine into the account.
- **An agent or CI:** an API key from the dashboard (API keys) in `AIRED_API_KEY=aired_sk_...`. The CLI, `aired --mcp` and the HTTP API (`Authorization: Bearer aired_sk_...`) then act as that account.
- **A remote MCP client:** `https://aired.sh/mcp/account` signs in when the client asks; `https://aired.sh/mcp` with the API key header works too.
- A Free limit answers HTTP 402 with `code: "plan_limit"` and an `upgrade_url`. Give the link to the person; agents can't pay.

## Rules that trip agents up

- **A page is one file.** Relative files (`app.js`, `data.json`, `img/logo.png`) fail to load. Inline them, use full `https://` URLs, or publish the folder so the CLI inlines them. Code-split Vite or React builds need a single-file build: see `references/bundling.md`.
- **Pages run in a sandbox.** `localStorage`, `sessionStorage` and cookies work but are lost on reload; a `<form action>` never submits (handle the submit in JavaScript); the page can't be shown in an iframe on another site. To keep what visitors enter, use `aired.collect` (load `aired-forms`).
- **A PIN is not encryption.** The page is stored as plain text. Never publish secrets, keys or personal data that shouldn't leave the conversation.
- **One way in at a time:** anyone with the link, a PIN, or only named people. Setting a PIN on a named-people page switches it to the PIN.
- **Updating needs the id and its token**, or the owner signed in. A token alone can't find the page. Tokens are kept in `~/.config/aired/tokens.json`; lose them on an anonymous page and you can't update it.
- **A page that has collected responses** can be replaced or restored only by its owner, signed in. The update token is refused (`403 owner_required`).
- **Updating a page that expires resets it to 7 days from then.** Set the expiry again afterwards if it should be shorter, or make it `--permanent`.
- **Rate limited:** HTTP 429, CLI exit code 3. Wait, or sign in for higher limits.

## Change a page without publishing again

```bash
aired set <id> --pin 4821 --ttl 24h --reads 50 --title "Q4"
aired set <id> --clear-pin --permanent
```

Over MCP it's `set_options`; `get_page` reads the settings back (whether a PIN is on, never the PIN, and `allow_pdf`). Every update keeps the old content: `aired versions <id>` and `aired restore <id> <n>` (`list_versions`, `restore_version`). Details in `aired-report`.

## When aired gets in the way

Send one note per task with `aired feedback --kind friction "..."` or `send_feedback`, and tell the user the id it returns. Never include page HTML, tokens or PINs. It isn't a support channel.

## References

Read these only when you need them:

- `references/cli.md`: every command, flag and exit code, and how update tokens work.
- `references/mcp.md`: both MCP servers, every tool and what it needs, the prompts and resources.
- `references/bundling.md`: folders, images, and single-file builds for Vite and React apps.
- `references/troubleshooting.md`: error codes and what to do about each.

## Install the skills

These five skills ship in the npm package (one folder each under `skills/`) and are MCP resources on both servers. For Claude Code:

```bash
npx skills add progrmoiz/aired -g -a claude-code
```
