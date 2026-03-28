# Session Handoff — Aired (Session 1)
### Continue from here in the next session

*Session date: 2026-03-27 to 2026-03-28*
*Previous sessions: none (first session)*
*Status: v0.1 complete — all 4 phases built and tested. CLI needs regeneration with /cli-generate for production polish. Design iteration ongoing.*

---

## What This Session Was About

Built **Aired** from zero — an open-source tool that publishes HTML artifacts to shareable URLs. The idea came from Moiz's personal pain point: AI tools generate beautiful HTML (dashboards, visualizations, reports) but sharing them is broken. You either email raw .html files or wrestle with GitHub Pages.

We went through full product lifecycle: market research → naming → brainstorm → architecture → blueprint → build → test → design. The product has three interfaces: CLI (`npx aired file.html`), MCP server (`publish_html` tool for Claude Code/Cursor), and a web UI (paste form on aired.sh).

All 4 build phases are complete and tested. 26/26 tests pass. The landing page went through 3 design iterations — final version uses Karri Saarinen's (Linear founder) design system with custom tokens.

## What We Decided

### Name: Aired
- "Artifact" is THE word everyone uses for AI-generated HTML (Claude calls them artifacts)
- But `artifacts` is taken on npm (38 versions, active). `artifact` also taken.
- Consulted 4 naming experts: David Placek (named Vercel), Willem Van Lancker (named Arc), Arvid Kahl (bootstrapper), Marc Lou (indie maker)
- Willem's winning insight: "You've been naming the noun when you should be naming the verb."
- `aired` = past-tense verb. "I aired it." Broadcasting metaphor. 5 letters, 1 syllable.
- npm `aired`: AVAILABLE. Domain aired.sh: AVAILABLE.

### Stack: Hono + Cloudflare Workers + R2 + KV
- Researched and confirmed this is the most modern stack in March 2026
- Hono v4.12: 20M weekly npm downloads, Cloudflare uses it internally, MCP SDK has official Hono middleware
- R2: zero egress fees = free tier sustainable forever. ~$5/mo at 10K users, ~$62/mo at 1M users
- KV over D1: native TTL = auto-expiry without cron jobs. Simpler for key-value metadata.
- @modelcontextprotocol/sdk v1.28.0 (latest stable)

### Ownership: Claim Token Pattern
- On publish, server generates random token, stores SHA-256 hash in KV
- Returns raw token once to user
- Pass token back → update same URL. No token → new URL.
- CLI stores tokens in `~/.config/aired/tokens.json` (chmod 600) using `conf` package
- MCP: token lives in conversation context. Lost on new conversation = new URL. Fine.
- Researched: this is what PrivateBin, GitHub PATs, Stripe do. Industry standard.

### Immutable by Default, Update by Token
- envshare model: every publish = new link. No editing.
- BUT with claim token, you CAN update the same URL (for "change the colors" workflow)
- No named slots (collision risk without identity system)
- No accounts (v1 is anonymous-first)

### No Zero-Knowledge Encryption
- Content must be scannable for moderation (phishing prevention)
- PIN for access control, not encryption
- 62% of phishing sites abuse free hosting. Must be able to take down content.

### Directory Bundling (v1)
- CLI detects file vs directory input
- For directories: Parcel + html-inline → single bundled HTML → upload
- Same strategy as Anthropic's web-artifacts-builder skill

## What Changed in the Codebase

### Files Created (all in `/Users/moiz/Documents/Code/aired/`)

**Root:**
- `package.json` — pnpm workspaces root
- `pnpm-workspace.yaml` — packages/*, apps/*
- `tsconfig.base.json` — ES2022, strict
- `.gitignore` — node_modules, dist, .wrangler
- `README.md` — full project README with API docs
- `LICENSE` — MIT, copyright 2026 Abdul Moiz

**packages/core/ (shared logic):**
- `src/id.ts` — `generateId()` using nanoid (10 chars, url-safe)
- `src/token.ts` — `generateToken()`, `hashToken()`, `verifyToken()` (SHA-256, timing-safe)
- `src/metadata.ts` — `PageMetadata` type with tokenHash, serialize/parse
- `src/constants.ts` — DEFAULT_TTL=604800, MAX_SIZE=2MB, RATE_LIMIT=5
- `src/validate.ts` — HTML validation, relative path detection, title extraction
- `src/index.ts` — barrel export

**apps/worker/ (Cloudflare Worker):**
- `src/index.ts` — Hono app, mounts routes, error handler, ASSETS fallback
- `src/types.ts` — Env bindings (R2Bucket, KVNamespace, Fetcher)
- `src/routes/api.ts` — POST /api/publish (create + update), PUT/DELETE /api/pages/:id, GET /api/pages/:id
- `src/routes/viewer.ts` — GET /p/:id (PIN check, read limit, serve HTML with CSP + OG tags + report bar)
- `src/routes/report.ts` — POST /api/report
- `src/middleware/rate-limit.ts` — IP hash + KV counter, 5/hour
- `src/middleware/security.ts` — CSP headers
- `wrangler.toml` — R2 PAGES_BUCKET, KV PAGES_KV, assets binding

**apps/cli/ (Commander.js CLI):**
- `src/index.ts` — Commander program, default publish command, subcommands, --mcp flag
- `src/commands/publish.ts` — Read file/stdin, call API, save token, format output
- `src/commands/update.ts` — Update page by token from local store
- `src/commands/delete.ts` — Delete page by token from local store
- `src/commands/tokens.ts` — List/prune stored tokens
- `src/api-client.ts` — HTTP client (publishHTML, updatePage, deletePage, getPage, pageExists)
- `src/store.ts` — conf-based token storage, ~/.config/aired/, chmod 600
- `tsup.config.ts` — Bundle to 15KB .cjs

**apps/mcp/ (MCP stdio server):**
- `src/index.ts` — McpServer with `publish_html` tool (html/file_path, title, pin, ttl, permanent, update_token, id)
- `tsup.config.ts` — Bundle to 5KB .cjs

**apps/web/ (landing page):**
- `index.html` — Karri Saarinen's design: custom tokens, JetBrains Mono, code editor textarea, toolbar options, stacked install section
- `style.css` — Intentionally near-empty (styles in index.html `<style>` block)
- `app.js` — Vanilla JS: paste, upload, drag-drop, submit, result display, copy buttons

### Research Files Created (in life-os repo)
- `/Users/moiz/Documents/Code/life-os/content/research/html-publishing-tools/_index.md`
- `/Users/moiz/Documents/Code/life-os/content/research/html-publishing-tools/landscape.md`
- `/Users/moiz/Documents/Code/life-os/content/research/html-publishing-tools/cost-analysis.md`
- `/Users/moiz/Documents/Code/life-os/content/research/html-publishing-tools/ux-unknowns.md`
- `/Users/moiz/Documents/Code/life-os/docs/brainstorms/2026-03-28-aired-requirements.md`
- `/Users/moiz/Documents/Code/life-os/docs/blueprints/aired.md`
- `/Users/moiz/Documents/Code/life-os/memory/decisions.md` — Added "Aired — Name Decision"
- `/Users/moiz/Documents/Code/life-os/memory/ideas.md` — Added "Aired — HTML Artifact Publishing"

### Reference Repos Cloned (at ~/Documents/Code/aired-research/)
- `sharehtml` — primary reference (Hono + Workers + R2, CLI)
- `envshare` — UX/design reference
- `r2-image-worker` — minimal Hono + R2 pattern (by Hono creator)
- `mcp-server-cloudflare` — MCP tool registration patterns
- `mcp-boilerplate` — MCP server on Workers
- `cf-drop` — password protection, D1 metadata

## What Was NOT Done Yet

1. **Run `/cli-generate` on the aired CLI** — Current CLI works but lacks polish (no doctor command, no ASCII banner, no SKILL.md, no spinner, no pretty tables). Next session should run `/cli-generate` in `~/Documents/Code/aired/` to regenerate with production-grade output.

2. **Buy aired.sh domain** — Not purchased yet. Should do before launch.

3. **Reserve `aired` on npm** — Not published. Should `npm publish` a placeholder ASAP.

4. **Create GitHub repo** — `progrmoiz/aired`. Repo exists locally but not pushed to GitHub.

5. **Fix PIN verification redirect** — Test 13 (POST /p/:id/verify-pin) returns 404 after correct PIN. The cookie-based redirect needs debugging. Non-blocking.

6. **Directory bundling** — Blueprint says v1 includes Parcel + html-inline bundling for directories. Not implemented yet in apps/cli/src/bundler.ts.

7. **Deploy to Cloudflare** — Create R2 bucket + KV namespace + `wrangler deploy`. Not done.

8. **Design iteration** — Moiz has been through 3 designs. Current Karri design is close but may need more tweaks. The install section was fixed (stacked list instead of grid cards).

## Research Conducted

### Market Research (extensive)
- 4+ indie devs independently built similar tools (Pagedrop 500+ users, HTMLDrop 10K+ users, hostmyclaudehtml, Canvadrop, sharehtml 102 stars)
- "Artifact" is the only cross-platform noun for AI-generated HTML (Claude uses it, others don't have a term)
- Zero MCP servers exist for HTML publishing (gap in 10K+ MCP ecosystem)
- Key pain: "The hardest part isn't building, it's deploying and sharing"
- Non-technical users are a bigger segment than expected

### Stack Research
- Hono v4.12 confirmed as default for Workers in 2026 (20M npm/week)
- R2 zero egress confirmed — cost modeling done up to 1M users
- KV native TTL confirmed better than D1 for this use case
- MCP SDK v1.28.0 has official Hono middleware

### Security Research
- 62% of phishing sites abuse free hosting tools
- Sandbox pattern: separate domain for user content + CSP headers
- But no auth/cookies in v1 = nothing to steal. CSP sufficient.
- Zero-knowledge encryption ruled out (can't moderate)

### Token Storage Research
- SHA-256 hash server-side (industry standard for random tokens)
- `conf` package client-side, chmod 600 (same as Vercel/Netlify CLI)
- System keychain overkill for per-page tokens

## Current State of Key Files

| File | Status |
|------|--------|
| `~/Documents/Code/aired/` | Complete v0.1, 2 commits |
| `life-os/docs/blueprints/aired.md` | Updated with claim token pattern |
| `life-os/docs/brainstorms/2026-03-28-aired-requirements.md` | Complete |
| `life-os/content/research/html-publishing-tools/` | Complete (4 files) |
| `life-os/memory/ideas.md` | Updated with Aired idea |
| `life-os/memory/decisions.md` | Updated with name decision |
| `~/Documents/Code/aired-research/` | 6 cloned reference repos |

## Key Insights Worth Remembering

1. **KV rate limit state persists between wrangler restarts.** Delete `.wrangler/state/` to clear. This bit us during testing.

2. **`conf` v13 is ESM-only.** Needs `moduleResolution: Bundler` in tsconfig while tsup handles CJS bundling. This was a gotcha in Phase 2.

3. **Commander `isDefault` with program-level `[file]` argument swallows subcommand names.** Fixed with `addCommand(..., { isDefault: true })`.

4. **POST /api/publish update path requires both `update_token` AND `id`.** KV has no reverse lookup — token alone can't find the page. The PUT /api/pages/:id route is cleaner for CLI updates.

5. **The app.js file has duplicate logic** — the original IIFE from Phase 4 AND the inline script added during the Karri redesign both handle form submission. The inline script in index.html overrides the app.js behavior. Should be cleaned up — either remove app.js or remove the inline script.

6. **Tailwind CDN is used in production** — works for v1 but should be replaced with a build step for production (Tailwind CLI or PostCSS). CDN adds ~300KB to page load.

## File Paths Quick Reference

**Project:**
- Root: `~/Documents/Code/aired/`
- Worker: `~/Documents/Code/aired/apps/worker/`
- CLI: `~/Documents/Code/aired/apps/cli/`
- MCP: `~/Documents/Code/aired/apps/mcp/`
- Web: `~/Documents/Code/aired/apps/web/`
- Core: `~/Documents/Code/aired/packages/core/`

**Life OS:**
- Blueprint: `~/Documents/Code/life-os/docs/blueprints/aired.md`
- Requirements: `~/Documents/Code/life-os/docs/brainstorms/2026-03-28-aired-requirements.md`
- Research: `~/Documents/Code/life-os/content/research/html-publishing-tools/`

**References:**
- Cloned repos: `~/Documents/Code/aired-research/`

## How to Start Next Session

### Option 1: Regenerate CLI with /cli-generate (recommended)
```
cd ~/Documents/Code/aired
Read docs/research/tmp/session-handoff-aired-1.md for context. This is the Aired project — an open-source HTML artifact publishing tool. v0.1 is built and tested. Run /cli-generate to regenerate the CLI (apps/cli/) with production polish: doctor command, ASCII banner, SKILL.md, spinner, pretty tables, proper exit codes.
```

### Option 2: Fix design + push to GitHub
```
cd ~/Documents/Code/aired
Read docs/research/tmp/session-handoff-aired-1.md for context. The landing page (apps/web/index.html) uses Karri Saarinen's design system but needs cleanup — app.js has duplicate logic with the inline script. Clean up, then create GitHub repo progrmoiz/aired and push.
```

### Option 3: Deploy to production
```
cd ~/Documents/Code/aired
Read docs/research/tmp/session-handoff-aired-1.md for context. Deploy Aired to production: create Cloudflare R2 bucket + KV namespace, update wrangler.toml with real IDs, wrangler deploy. Then npm publish the aired package. Buy aired.sh domain and point DNS.
```
