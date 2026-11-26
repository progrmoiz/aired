# Deploying aired

aired is one Worker (`aired`) on https://aired.sh, configured in
`apps/worker/wrangler.toml`. There is no staging: CI checks every commit,
and production deploys from main.

Every absolute link the Worker writes comes from `siteOrigin(env)`
(`apps/worker/src/lib/origin.ts`):
- OAuth redirects and Stripe return URLs
- claim and upgrade links
- the badge and OG tags
- MCP replies
- the CORS allow-list

Production leaves `SITE_ORIGIN` unset and gets https://aired.sh. Local dev
and self-hosted deploys set it.

## How a deploy runs

`npm run deploy` (in `apps/worker`) runs `scripts/deploy.sh`:

1. **From a laptop only:**
   - It refuses if the tree has uncommitted changes.
   - You must be on `main`, and it must already be pushed (override with
     `ALLOW_UNPUSHED=1`).
   - It runs `pnpm typecheck` and `pnpm test`.
2. `wrangler d1 migrations apply aired --remote`.
3. `wrangler deploy --tag <first 12 chars of the sha> --message <commit subject>`.
   The version list in the dashboard then shows which commit is live.
4. It polls `https://aired.sh/health` for 30 seconds and fails if it never
   answers 200.

Use `npm run deploy` or `pnpm run deploy`. Don't use `pnpm deploy`: that's
a built-in pnpm command, not the script.

**Roll back** with `pnpm exec wrangler rollback`. A rollback restores the
code but not D1, so keep migrations additive: add columns and tables, and
drop them in a later release.

## CI (.github/workflows/ci.yml)

- **`check`** runs on every push and PR:
  - install from the lockfile
  - typecheck
  - worker tests
  - CLI build
  - a wrangler dry-run bundle
- **`deploy-production`** is manual and optional. Go to Actions > CI > Run
  workflow, pick branch `main` and tick "Deploy this commit of main to
  production". It runs after `check` passes and waits for the `production`
  environment's reviewer.

Until you set it up (below), deploying from the laptop is the only way, and
that works as before.

## Owner setup for CI deploys (optional)

1. Create a Cloudflare API token from the "Edit Cloudflare Workers"
   template:
   - Account: aired's account.
   - Zone: `aired.sh`.
   - Add **D1: Edit**.
   - If a deploy fails on a missing permission, add that one.
2. In the GitHub repo, go to Settings > Environments and create
   **production**.
   - Give it a required reviewer (you).
   - Allow only the `main` branch.
3. In that environment, add these secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

## Proposed branch protection for main

Not applied. Today you push straight to main. Turn this on once CI has
been green for a while: Settings > Rules > Rulesets > New branch ruleset,
target `main`.

- **Require status checks to pass:** `Typecheck, test, build`. Also
  require branches to be up to date before merging.
- **Block force pushes** and **restrict deletions**.
- **Require a pull request before merging, with 0 required approvals.** You
  can still merge your own PRs, but every change goes through CI first.
- **Bypass list:** add yourself (repository admin) so an emergency fix can
  still go straight in.
