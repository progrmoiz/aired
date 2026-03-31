# aired Launch Playbook

> Status: Ready to execute
> Best launch day: Tuesday March 31, 2026
> Time: 9 AM ET (6 PM PKT)
> npm: v1.0.0 live
> GitHub: progrmoiz/aired
> Site: aired.sh

## The Launch Tweet

```
every AI tool can generate html now - dashboards, reports, visualizations

but theres no way for an agent to push that html to a live url

so i built aired. open source CLI + MCP server

npx aired dashboard.html → shareable link in 2 seconds
```

Attach: Terminal screenshot of `npx aired dashboard.html` output (banner + result URL). PNG, not GIF.

### Reply 1 (origin story):
```
built this because i was making an interactive pricing visualization with AI, needed to share it with colleagues

the html was on my local machine. ended up sending .html files in slack

there should be a way for any AI tool to just push html to a url
```

### Reply 2 (features):
```
any AI agent can publish directly from the terminal

claude code, cursor, vs code, codex, gemini - all supported

remote MCP endpoint too (https://aired.sh/mcp) so even web-based AI tools can use it. zero install

cloudflare workers + R2. runs for $0
```

### Reply 3 (link — separate reply):
```
aired.sh

github.com/progrmoiz/aired
```

### Reply 4 (tags — separate reply):
```
cc @kabormoiz @levelsio @marclouv @raabormoiz — would love feedback from builders shipping AI tools
```

## Launch Day Sequence (9 AM ET / 6 PM PKT)

1. 9:00 — Post tweet thread
2. 9:05 — Post Show HN
3. 9:15 — Post to r/selfhosted, r/webdev (space 5 min apart)
4. 9:25 — Post to r/opensource, r/node
5. 9:30 — Reply to own tweet with context + tags
6. 10:00-12:00 — Engage. Reply to EVERY comment. Non-negotiable.
7. Afternoon — Tier 2 platforms (Dev.to, daily.dev)

## Show HN

**Title:** `Show HN: Aired – Publish HTML artifacts to live URLs from any AI agent`

**Body:**
```
I built aired because every AI tool can generate beautiful HTML (dashboards, reports, visualizations) but there's no agent-native way to push that HTML to a shareable URL.

It's a CLI + MCP server. One command to publish:

  npx aired dashboard.html → https://aired.sh/p/a1b2c3d4e5

What it does:
- Publishes HTML files, directories, or stdin to live URLs
- MCP server (STDIO + Streamable HTTP) so AI agents can publish directly
- Works with Claude Code, Cursor, VS Code, Windsurf, Codex, Gemini CLI
- Directory bundling (inlines CSS/JS/images automatically)
- Optional PIN protection, custom expiry, update tokens
- 3D globe on landing page showing real-time views by country

Stack: Cloudflare Workers + R2 + KV. Zero cost. MIT licensed.

Remote MCP endpoint at https://aired.sh/mcp — any AI tool can connect without installing anything.

https://github.com/progrmoiz/aired
```

## Reddit Posts

| Subreddit | Title |
|-----------|-------|
| r/selfhosted | I built an open-source tool to publish HTML artifacts to shareable URLs — Cloudflare Workers + R2 |
| r/webdev | Show r/webdev: aired — publish any HTML to a live URL in 2 seconds (open source CLI) |
| r/node | aired — CLI + MCP server for publishing HTML artifacts. 516KB, 5 deps, Cloudflare Workers |
| r/opensource | aired: open-source CLI to share AI-generated HTML artifacts instantly |
| r/javascript | aired — publish HTML files to shareable URLs from the terminal or any AI agent |
| r/CloudFlare | Built an open-source HTML publisher on Workers + R2 + KV — zero cost hosting |
| r/artificial | Built an MCP server that lets any AI agent publish HTML to live URLs |
| r/ClaudeAI | Built an MCP server for publishing HTML artifacts — works with Claude Code |

## Product Hunt (Day 3-5, after 50+ stars)

- Target date: Thursday April 3 or Friday April 4, 2026
- Time: 12:01 AM PT
- Maker: @iammoizfarooq
- Topics: Developer Tools, Open Source, Artificial Intelligence, Command Line Tools

### Tagline (max 60 chars)
```
Publish HTML artifacts to live URLs from any AI agent
```

### Description
```
aired is an open-source CLI + MCP server that publishes HTML artifacts to shareable URLs in seconds. Built for AI agents — any tool that generates HTML (Claude, Cursor, ChatGPT, Codex) can publish directly via MCP. No signup, no deploy pipeline. Just HTML in, live URL out.

Features:
- npx aired file.html → live URL in 2 seconds
- MCP server (STDIO + Streamable HTTP) for AI agent publishing
- Directory bundling — inlines CSS, JS, images automatically
- PIN protection, custom expiry, update tokens
- Works with Claude Code, Cursor, VS Code, Windsurf, Codex, Gemini CLI
- Remote endpoint (https://aired.sh/mcp) — zero install needed

Stack: Cloudflare Workers + R2 + KV. MIT license. $0 to run.
```

### First Comment (as maker — most important thing on PH)
```
Hey PH! I built aired because I was making a pricing visualization with AI and needed to share it with colleagues. The HTML was on my local machine — I ended up sending .html files in Slack.

Every AI tool can generate beautiful HTML now, but there's no agent-native way to push it to a URL. So I built one over a weekend.

It's completely open source, runs on Cloudflare's free tier, and supports every major AI coding tool via MCP.

Would love your feedback — especially on what other formats you'd want to publish (React apps? Markdown? SVGs?).
```

### Screenshots (4-5 images, in order)
1. Terminal screenshot — `npx aired dashboard.html` output (hero image)
2. aired.sh landing page with 3D globe
3. MCP tab UI showing multi-client install configs
4. A published page with the aired bar visible
5. The OG image

### Pre-PH Checklist
- [ ] 50+ GitHub stars (from tweet + HN + Reddit wave)
- [ ] All screenshots taken and cropped
- [ ] PH maker profile up to date
- [ ] Ask 5-10 friends/mutuals to upvote + comment in first hour
- [ ] Prepare 3-4 reply templates for common questions

## Content Wave (Days 1-14)

| Day | Content |
|-----|---------|
| 0 | Launch tweet + HN + Reddit |
| 1 | Quote-tweet with actual numbers ("12 hours in: X stars, Y npm downloads") |
| 2 | "The CLI-for-agents wave is real" tweet — reference Karpathy/Ramp/Polymarket trend |
| 3-5 | Product Hunt launch |
| 4 | Architecture tweet: "aired runs on $0/mo. Here's the stack: Workers + R2 + KV" |
| 5 | MCP tweet: "aired supports 7 AI clients. Each one has a different config format. Here's the chaos:" + screenshot of the tab UI |
| 7 | Build-in-public: actual star/download/view numbers, traffic sources |
| 8 | "I added a 3D globe to my landing page using 5KB of JavaScript" tweet + screenshot |
| 10-14 | "Lessons from building an open-source CLI in a weekend" thread with real numbers |

## Key Angles to Play

- **Agent-native CLI** — rides the Karpathy/DHH wave. CLIs are the distribution channel for AI agents.
- **$0 infrastructure** — Cloudflare Workers free tier. Resonates with bootstrappers.
- **Weekend build** — "built this over the weekend" is aspirational. Shows what one person + AI can do.
- **The gap** — no agent-native way to publish HTML. Claude artifacts are locked in Claude's ecosystem.
- **MCP Streamable HTTP** — cutting edge. Most MCP servers are STDIO only. aired supports both.

## Rules

- Reply to EVERY comment in first 2 hours
- Space Reddit posts 5-15 min apart (avoid spam detection)
- Don't ask for upvotes anywhere
- Don't self-deprecate ("just a small project")
- Don't say "pastebin for HTML" — reductive
- Don't claim Claude artifacts can't be shared — they can, the gap is agent-native + source-agnostic
- Don't launch all platforms simultaneously — HN 5 min after tweet, Reddit 10 min after HN
- Terminal screenshot as hero image, not the landing page
- Link goes in self-reply, NOT in main tweet body
- Don't pay for promotion
- Don't tag more than 4 people

## Pre-Launch Checklist

- [x] npm v1.0.0 published
- [x] GitHub repo public
- [x] aired.sh deployed with HTTPS
- [x] OG image (static + dynamic)
- [x] Favicon (SVG + PNG + ICO)
- [x] MCP Streamable HTTP live
- [x] Multi-client install docs
- [x] SKILL.md on skills.sh
- [x] README comprehensive
- [ ] Terminal screenshot for tweet
- [ ] Enable "Always Use HTTPS" in Cloudflare dashboard
- [ ] GitHub repo description + topics set
- [ ] GitHub social preview image (use og.png)
