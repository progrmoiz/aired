# Publish from Claude Code

**Add aired to Claude Code once, then say “publish this to aired”.** Claude sends back a link anyone can open, and it can update the page later at the same link.

Source: https://aired.sh/publish-from-claude-code

## How to do it

1. **Add aired once** One command adds the skills or the MCP server.
2. **Ask Claude** A page, a folder or a slide deck.
3. **Send the link** Anyone can open it. No Claude account.

## Set it up once

Claude Code is Anthropic's coding assistant. It can run commands on your computer, so it can publish what it made for you. Pick one of these three ways.

### 1. The aired skills (the easy default)

A skill is a short instruction file that Claude Code reads when your request matches it. aired's skills tell Claude how to publish, update and share pages, so you never have to explain. Install them for every project with:

```
npx skills add progrmoiz/aired -g -a claude-code
```

They land in `~/.claude/skills/`, the folder Claude Code loads your own skills from in every project. There are five: `aired` for publishing, plus `aired-slides` for decks, `aired-report` for client reports, `aired-dashboard` for live dashboards and `aired-forms` for pages that collect answers. Claude only reads one when the task needs it.

The same skills ship inside the `aired` npm package, if you'd rather copy them by hand:

```
npm install -g aired
cp -R "$(npm root -g)/aired/skills/." ~/.claude/skills/
```

With the skills, Claude publishes through aired's command-line tool, so your computer needs Node.js 20 or later.

### 2. The MCP server

MCP (Model Context Protocol) is the standard way to plug tools into AI apps. Add aired's server with one command:

```
claude mcp add --transport http aired https://aired.sh/mcp
```

That publishes without an account. To publish as your aired account, so every page shows up in your dashboard, add `https://aired.sh/mcp/account` instead. Then type `/mcp` in Claude Code, pick aired and sign in when your browser opens.

### 3. Nothing to install

Claude can run aired's command-line tool straight away. Say “publish index.html with npx aired” and it runs:

```
npx aired index.html
```

It prints the link. CSS, scripts and images next to the page are packed into it, so nothing goes missing.

## Publish a page, a folder or a deck

- **A page:** ask Claude to “build this as one HTML file and publish it to aired”. One file opens anywhere with nothing missing.
- **A folder:** `npx aired ./site/` packs a folder into one page.
- **A slide deck:** ask for “a Markdown slide deck with --- between slides”. `npx aired new deck` gives Claude a template to start from, and the deck gets speaker notes only you can see. See [share your slides](https://aired.sh/share-slides).
- **A private page:** ask for a PIN (`--pin 4821`), or, signed in, let only the people you name open it. See [share HTML privately](https://aired.sh/share-html-privately).

## Pick it up again later

The link doesn't change when the page does. You or Claude can come back to it next week, even in a new session or on another computer:

1. **Find it:** `aired list` shows your pages, newest first.
2. **Get the source back:** `aired pull <id>` downloads what was last published, as Markdown or HTML.
3. **Change it:** edit the file, then `aired update <id> <file>`. Anyone with the page open sees the new version within seconds, without reloading.

While you work, `aired watch index.html` publishes once and then updates the page every time the file is saved, so someone watching the link sees it change. Every update is kept as a version you can go back to; Free keeps the last 5.

Sign in once with `npx aired login` so `aired list` finds your pages from any computer. Signed out, it only knows the pages published from this one.

## Questions

### Do people need Claude to open the link?

No. It's a normal web page. It opens in any browser, on a phone or a laptop, with no sign-in.

### Skills or the MCP server: which should I use?

Either works. The skills teach Claude when and how to use aired and publish with the command-line tool; the MCP server gives Claude aired's tools directly. If you're not sure, install the skills.

### Can Claude change the page after I've sent the link?

Yes. It updates the page at the same link with aired update. In a new session, aired pull gets the last published version back first.

### Can I publish a slide deck?

Yes. Ask for a Markdown deck with --- between slides and type: deck at the top, or an HTML deck. aired shows it as slides, with speaker notes only you can see.

### How long does the link last?

Seven days by default. Ask for 1 hour, 1 day, 30 days or permanent with --ttl or --permanent.

### Is it free?

Yes. Publishing and viewing are free. Pro removes the badge and takes bigger pages.
