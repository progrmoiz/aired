# aired CLI reference

Run it with `npx aired` (no install) or install it with `npm install -g aired`.

## Commands

| Command | What it does |
|---|---|
| `aired [file]` | Publish an HTML or Markdown file, a folder with `index.html`, or stdin (the default command) |
| `aired new [template]` | Write a starter to fill in: `deck`, `deck-html`, `report`, `one-pager` (no name lists them) |
| `aired update <id> <file>` | Replace a page's content at the same link (`-m "note"` labels the version) |
| `aired versions <id>` | A page's history: every version kept, newest first |
| `aired restore <id> <version>` | Put an earlier version back (it goes live as a new version) |
| `aired set <id>` | Change who can open it, its expiry, view limit or title without uploading again |
| `aired check <id>` | Open the page in a real browser and report errors (exits 1 if broken) |
| `aired info <id>` | Title, size, views and expiry |
| `aired delete <id>` | Delete a page |
| `aired feedback` | Report a bug, friction or idea in aired itself |
| `aired tokens` | List stored update tokens (`aired tokens prune` removes ones for pages that are gone) |
| `aired login` | Sign in (browser; `--device` for SSH) |
| `aired whoami` / `aired logout` | Show or end the sign-in |
| `aired claim --all` | Move pages published from this machine into your account |
| `aired doctor` | Check Node.js, the API and the token store |
| `aired --mcp` | Start the local MCP server (stdio) |

## Publish flags

| Flag | Effect |
|---|---|
| `-t, --title <title>` | Page title |
| `-p, --pin <pin>` | PIN-protect the page |
| `--ttl <duration>` | Expire after `1h`, `24h`, `7d`, `30d` |
| `--permanent` | Never expire |
| `--reads <n>` | Stop opening after this many views |
| `--project <name>` / `--no-project` | Group it on the dashboard (taken from the git repo or folder by default) |
| `--deck` | Show as slides (Markdown split on `---`, or HTML `<section>` slides) |
| `--markdown` | Treat the input as Markdown (automatic for `.md` files; use it for stdin) |

`aired update` takes `-t`, `--deck`, `--markdown` and `-m, --message`.

## aired set

```bash
aired set abc123 --pin 4821 --ttl 24h        # PIN on, expires a day from now
aired set abc123 --reads 50 --title "Q4"     # view limit and title
aired set abc123 --clear-pin --permanent     # PIN off, never expires
aired set abc123 --only alice@client.com,@client.com   # only these people (each gets an email code)
aired set abc123 --public                    # anyone with the link again
```

Also `--clear-title` and `--clear-reads`. PINs are 4–64 characters, TTLs a minute to a year (use `--permanent` beyond that), titles up to 200 characters. It uses the stored update token, else your sign-in or `AIRED_API_KEY` (your own pages only). `--only` needs sign-in and a page in your account.

## aired check

```bash
aired check abc123                  # desktop, 1280×800
aired check abc123 --mobile         # phone, 390×844
aired check abc123 --screenshot shot.jpg --json
aired check abc123 --strict         # also fail on warnings
```

It reports script and console errors, files that didn't load, broken images and a blank screen, plus warnings for slow, heavy, very tall or sideways-scrolling pages, with a screenshot URL that works for 24 hours. Checks share a daily browser budget of 3 minutes across everyone; each caller's share is 2 minutes signed in or 1 minute per IP without an account (a check takes about 10–15 seconds), plus 20 an hour and 3 a minute. When it's spent you get HTTP 429 (exit 3) until 00:00 UTC.

## aired feedback

```bash
aired feedback --kind friction --impact worked_around "aired set needed the page id and I only had the URL"
```

`--kind` is `bug`, `friction` or `idea`; `--impact` is `blocked`, `worked_around` or `minor`; `--page <id>` and `--tool <name>` add context; `-y` sends without asking. The message is 10 to 2000 characters. At most one per task.

## Global flags

| Flag | Effect |
|---|---|
| `--json` | JSON on stdout (automatic when stdout is piped) |
| `-q, --quiet` | Nothing on stderr; implies `--json` |
| `--api-url <url>` | Another aired server |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | API error; for `aired check`, only "the page is broken" |
| 2 | Bad input, missing file or no token; for `aired check`, also no access to the page |
| 3 | Rate limited; for `aired check`, also "the check couldn't run, try later" |

A malformed `AIRED_API_KEY` stops the run with exit 2, so CI never publishes anonymously by mistake.

## Update tokens

The first publish returns an `update_token`, saved to `~/.config/aired/tokens.json` by page id:

```bash
aired dashboard.html          # publishes, saves the token
aired update abc123 v2.html   # same link, new content
```

The `--json` output includes the token. Tokens keep working after you sign in; `aired claim --all` moves those pages into your account, after which your sign-in is enough.
