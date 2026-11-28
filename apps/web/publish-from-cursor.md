# Publish from Cursor

**Add aired to Cursor with one click, then ask the agent to publish your page.** It comes back with a link anyone can open, on any device.

Source: https://aired.sh/publish-from-cursor

## How to do it

1. **Add aired once** One click installs aired's MCP server.
2. **Ask the agent** In Cursor's chat, like any other task.
3. **Send the link** It opens anywhere. No Cursor needed.

## Add aired to Cursor

Cursor is a code editor with an AI agent built in. aired plugs into it as an MCP server (MCP is the standard way to plug tools into AI apps). On a computer with Cursor installed, click:

[Add aired to Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=aired&config=eyJ1cmwiOiJodHRwczovL2FpcmVkLnNoL21jcCJ9)

Cursor opens and asks you to install aired. That one publishes without an account. To publish as your aired account, so every page shows up in your dashboard, use [this link](cursor://anysphere.cursor-deeplink/mcp/install?name=aired&config=eyJ1cmwiOiJodHRwczovL2FpcmVkLnNoL21jcC9hY2NvdW50In0%3D) instead and sign in to aired when Cursor asks.

### Or add it by hand

Put this in `~/.cursor/mcp.json` to use aired in every project, or in `.cursor/mcp.json` inside one project:

```
{
  "mcpServers": {
    "aired": { "url": "https://aired.sh/mcp" }
  }
}
```

### Or teach it with skills

A skill is an instruction file the agent reads when your request matches it. Cursor loads skills from its own folders and also from Claude Code's `~/.claude/skills/`. Install aired's five skills with the command below, and pick Cursor when it asks which agents to set up:

```
npx skills add progrmoiz/aired -g
```

With a skill, the agent publishes with aired's command-line tool, which needs Node.js 20 or later.

## What to ask

- **“Publish index.html to aired”** for a single page. CSS, scripts and images next to it are packed in.
- **“Build the app, then publish dist/ to aired”** for an app. The built folder becomes one page. For Vite and React apps, see [share a Vite app](https://aired.sh/share-vite-app).
- **“Turn these notes into a Markdown deck and publish it to aired”** for slides with speaker notes. See [share your slides](https://aired.sh/share-slides).
- **“Publish it with the PIN 4821”** so only people you tell can open it.

In Cursor's chat, aired's answer shows as a small card with a picture of the page, its link, and who can open it.

## Keep it up to date

After a change, ask the agent to “update the aired page”. It publishes to the same link, and anyone with the page open sees the new version within seconds. Every update is kept as a version you can go back to.

Or run this in Cursor's terminal while you work. It publishes once, then updates the page every time you save:

```
npx aired watch index.html
```

Back on it next week? `aired list` shows your pages and `aired pull <id>` downloads the last published version to edit. Sign in with `npx aired login` so this works from any computer.

## Questions

### Do people need Cursor to open the link?

No. It's a normal web page. It opens in any browser, on a phone or a laptop, with no sign-in.

### The Add to Cursor link didn't open Cursor. What now?

The link only works on a computer with Cursor installed. Add aired by hand instead: put the aired entry in ~/.cursor/mcp.json, as shown above.

### Can the agent publish without the MCP server?

Yes. Cursor's agent can run commands, so it can run npx aired index.html itself. It prints the link.

### Does it work with Cursor's cloud agents?

Cloud agents don't read your ~/.cursor/mcp.json. They use the servers set up at cursor.com/agents, so add aired there.

### How long does the link last?

Seven days by default. Ask for 1 hour, 1 day, 30 days or permanent.

### Is it free?

Yes. Publishing and viewing are free. Pro removes the badge and takes bigger pages.
