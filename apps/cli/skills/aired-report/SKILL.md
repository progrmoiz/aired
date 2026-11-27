---
name: aired-report
description: Writes client reports, one-pagers and project updates with aired and shares them privately, behind a PIN or with only named people who confirm their email with a code, with an expiry and view limit. Updates keep the same link, with version history and one-step undo. Use when the user wants to send a report, summary, proposal or one-pager to a client or team, share a page privately or with specific people, change who can open a page, or roll back a bad update. Builds on the aired skill (publishing, sign-in, limits).
---

# Reports and private sharing with aired

## Start from a template

```bash
aired new report        # writes report.md: summary, key numbers, what was done, next steps
aired new one-pager     # writes one-pager.html: headline, three numbers, three cards, one call to action
```

Over MCP: `get_template` with `{ "name": "report" }` (or `"one-pager"`) returns the starter and its rules.

## Worked example

`report.md`:

```markdown
# November report: Acme Co

For Jane Doe at Acme · prepared by Sam Lee · 28 November 2026

## Summary

Traffic grew 18% after the new landing pages went live. Sign-ups rose with it.
Two campaigns underperformed and are paused. Next month we focus on checkout.

## Key numbers

| Metric | October | November | Change |
| --- | ---: | ---: | ---: |
| Visits | 41,200 | 48,600 | +18% |
| Sign-ups | 1,310 | 1,522 | +16% |
| Cost per sign-up | $14.10 | $12.80 | −9% |

## Next steps

- [x] Launch the new landing pages
- [ ] Test a shorter checkout
- [ ] Review the two paused campaigns
```

Rules: summary first, three or four plain sentences. Numbers in a right-aligned table (`---:`). Next steps as a task list. Use only real figures: write `[number]` where one is missing. Raw HTML in Markdown shows as text, so use Markdown only (or the HTML one-pager).

Publish it signed in, so it lands in your account:

```bash
aired report.md --title "November report: Acme Co"
```

Over MCP, call `publish_html` with `{ "markdown": "<the report>", "title": "November report: Acme Co" }`. The `publish_report` prompt does all of this.

## Share it privately

| Who can open it | CLI | MCP `set_options` |
|---|---|---|
| Only named people | `aired set <id> --only jane@acme.com,sam@acme.com` | `{ "id": "<id>", "access": { "mode": "people", "emails": ["jane@acme.com"] } }` |
| Everyone at a company (Pro) | `aired set <id> --only @acme.com` | `"access": { "mode": "people", "domains": ["acme.com"] }` |
| Anyone with a PIN | `aired set <id> --pin 4821` | `{ "id": "<id>", "pin": "4821" }` |
| Anyone with the link | `aired set <id> --public` | `"access": { "mode": "public" }` |

Add an end date or a view limit to any of these: `--ttl 7d`, `--reads 20` (`ttl_seconds`, `view_limit`).

**Named people:** each person types their email on the page and gets a 6-digit code (it works once, for 10 minutes). After that they stay in for 30 days, until you take them off the list. You, signed in, always get straight in. Needs sign-in and a page in your account. Sending a list replaces the old one.

**PIN:** give the link and the PIN in two different messages or apps. Never write the PIN into the page. The `share_privately` prompt does this.

| | Free | Pro |
|---|---|---|
| People per page | 3 | 500 |
| Whole domains per page | none | 25 |
| Code emails a day, across your pages | 100 | 2,000 |

## Update and undo

```bash
aired update <id> report.md -m "December numbers"   # same link, new content
aired versions <id>                                 # v4 live, v3, v2, v1: who, when, size, note
aired restore <id> 2                                # v2's content goes live as v5
```

Over MCP: `publish_html` with `id` and `update_token` (or `id` alone when you own it), then `list_versions` and `restore_version` with `{ "id": "<id>", "version": 2 }`.

- A restore never rewrites history: the old content goes live as a new version and the one it replaced is kept, so a restore can be undone the same way.
- Each version records who made it: `owner`, `token` or `agent`, and the note from `-m` / `message`.
- Free keeps the last 5 earlier versions; Pro the last 50, each for 90 days (the newest 5 stay however old). Deleting the page deletes its history.

## Check before sending

`aired check <id>` (or `check_page`) opens the page as a visitor would, even behind a PIN or a people list. Fix what it reports and update the same id.

## Gotchas

- **One way in at a time.** A page is public, PIN-protected or for named people, never two at once. Setting a PIN on a named-people page switches it to the PIN and drops the list.
- **A PIN is not encryption.** The page is stored as plain text. Don't put passwords, keys or data the client hasn't agreed to share in it.
- **Updating a page that expires sets it to 7 days from then.** If it should end sooner, run `aired set <id> --ttl 24h` after the update.
- **A page that has collected responses** (it uses `aired.collect`) can be updated or restored only by its owner, signed in: the update token gets `403 owner_required`.
- **Private pages hide their title and views** from the public metadata and link preview, so a link pasted in chat doesn't show the title.
- Named people and domains need a page in your account. An anonymous page can only have a PIN.
