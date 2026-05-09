# aired

Paste HTML, get a live URL. No signup, no deploy.

## Two-step agent flow

1. Tell your agent to publish to aired.
2. It is online at `aired.sh/p/{slug}`, no account needed.

## Install paths

- **Skill** — `npx skills add progrmoiz/aired -g`
- **CLI** — `npx aired index.html`
- **MCP** — `claude mcp add aired --transport http https://aired.sh/mcp`
- **API** — `curl -X POST https://aired.sh/api/publish -H "Content-Type: application/json" -d '{"html":"<h1>hi</h1>"}'`

## Works with every agent

Claude Code, Cursor, Codex, Windsurf, ChatGPT, Continue, Cline — anything that can make an HTTP request.

## What to publish

Documents, dashboards, reports, prototypes, mood boards, galleries, presentations, games, search results, JSON viewers, articles, demos, lookbooks, tutorials.

## Limits

- 2 MB max per publish.
- 5 publishes per hour per IP.
- Default TTL 7 days. Permanent available.

## Agent context

- Concise: https://aired.sh/llms.txt
- Full: https://aired.sh/llms-full.txt
- Manifest: https://aired.sh/.well-known/agent.json
- Plugin: https://aired.sh/.well-known/ai-plugin.json

## Source

https://github.com/progrmoiz/aired
