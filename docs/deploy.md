# Deploying aired

There are two deploys of one Worker, both defined in
`apps/worker/wrangler.toml`.

| | Production | Staging |
|---|---|---|
| URL | https://aired.sh | https://staging.aired.sh |
| Worker | `aired` | `aired-staging` |
| KV / R2 / D1 | `6388d6b3…` / `aired-pages` / `aired` | own namespace / `aired-pages-staging` / `aired-staging` |
| Rate-limit namespaces | 1001–1006 | 2001–2006 |
| Vars | none in the file (`SITE_ORIGIN` unset → https://aired.sh) | `SITE_ORIGIN`, `AIRED_ENV=staging` (noindex), `OG_SHOT_DAILY_SECONDS=0` |
| Deployed by | `npm run deploy` from main, or CI (manual) | CI on every push to main, or `pnpm deploy:staging` |

Every absolute link the Worker writes comes from `siteOrigin(env)`
(`apps/worker/src/lib/origin.ts`):
- OAuth redirects and Stripe return URLs
- claim and upgrade links
- the badge and OG tags
- MCP replies
- the CORS allow-list

So staging links point at staging. The static pages in `apps/web/`
(canonical tags, copy) still say aired.sh, which is fine because staging
answers `X-Robots-Tag: noindex`.

## How a deploy runs

`apps/worker/scripts/deploy.sh staging|production` does the following:

1. **From a laptop only:**
   - It refuses if the tree has uncommitted changes.
   - Production must be on `main` and already pushed (override with
     `ALLOW_UNPUSHED=1`).
   - It runs `pnpm typecheck` and `pnpm test`.
2. `wrangler d1 migrations apply <db> --remote`.
3. `wrangler deploy --tag <first 12 chars of the sha> --message <commit subject>`.
   The version list in the dashboard then shows which commit is live.
4. It polls `/health` for 30 seconds and fails if it never answers 200.

```bash
cd apps/worker
```

```bash
pnpm deploy:staging
```

```bash
npm run deploy
```

Use `npm run deploy` or `pnpm deploy:production` for production. Don't use
`pnpm deploy`: that's a built-in pnpm command, not the script.

**Roll back** with `pnpm exec wrangler rollback`, or
`pnpm exec wrangler rollback --env staging` for staging. A rollback restores
the code but not D1, so keep migrations additive: add columns and tables,
and drop them in a later release.

## CI (.github/workflows/ci.yml)

- **`check`** runs on every push and PR:
  - install from the lockfile
  - typecheck
  - worker tests
  - CLI build
  - wrangler dry-run bundles of both production and staging
- **`deploy-staging`** runs after `check` on pushes to main, only once the
  repo variable `DEPLOY_STAGING` is `on`.
- **`deploy-production`** is manual. Go to Actions > CI > Run workflow, pick
  branch `main` and tick "Deploy this commit of main to production". It runs
  after `check` passes and waits for the `production` environment's
  reviewer.

## Owner setup, once

Run these from `apps/worker` while logged in to the account that owns
aired.sh (`pnpm exec wrangler whoami`). Each one creates a resource;
nothing existing changes.

### 1. Staging storage

```bash
pnpm exec wrangler kv namespace create aired-staging
```

Paste the returned id into both `[[env.staging.kv_namespaces]]` entries
(`REPLACE_WITH_STAGING_KV_ID`).

```bash
pnpm exec wrangler r2 bucket create aired-pages-staging
```

```bash
pnpm exec wrangler d1 create aired-staging
```

Paste the returned `database_id` into `[[env.staging.d1_databases]]`
(`REPLACE_WITH_STAGING_D1_ID`). Then commit `wrangler.toml`.

### 2. Staging secrets

Use **test** credentials only. Staging must never hold production Stripe or
WorkOS keys.

```bash
openssl rand -base64 32 | pnpm exec wrangler secret put SESSION_SECRET --env staging
```

```bash
echo "1970-01-01T00:00:00Z" | pnpm exec wrangler secret put SESSION_VALID_SINCE --env staging
```

GitHub sign-in needs a separate GitHub OAuth app with the callback
`https://staging.aired.sh/auth/callback`:

```bash
pnpm exec wrangler secret put GITHUB_CLIENT_ID --env staging
```

```bash
pnpm exec wrangler secret put GITHUB_CLIENT_SECRET --env staging
```

WorkOS sign-in uses the WorkOS **staging** environment. Add the redirect
URI `https://staging.aired.sh/auth/workos/callback` there, then set:

```bash
pnpm exec wrangler secret put WORKOS_CLIENT_ID --env staging
```

```bash
pnpm exec wrangler secret put WORKOS_API_KEY --env staging
```

Billing is optional on staging. To try it, use Stripe **test mode**:
- a restricted test key `rk_test_…`
- test prices
- a webhook endpoint at `https://staging.aired.sh/api/billing/webhook`

Then set these, each with
`pnpm exec wrangler secret put <NAME> --env staging`:
- `BILLING_ENABLED` (`1`)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_MONTHLY`
- `STRIPE_PRICE_YEARLY`
- `STRIPE_MANAGED_PAYMENTS` (optional)

### 3. First staging deploy

This one runs from the laptop, after committing the ids. It applies all
migrations to the new D1 database.

The `staging.aired.sh` route is a Custom Domain, so this first deploy also
creates its DNS record and certificate. Allow a few minutes before
`/health` answers. If the health check times out on this first run, rerun
it once DNS resolves.

```bash
pnpm deploy:staging
```

### 4. CI deploys

1. Create a Cloudflare API token from the "Edit Cloudflare Workers"
   template:
   - Account: aired's account.
   - Zone: `aired.sh`.
   - Add **D1: Edit**.
   - If a deploy fails on a missing permission, add that one.
2. In the GitHub repo, go to Settings > Environments and create **staging**
   and **production**.
   - Give `production` a required reviewer (you).
   - Under "Deployment branches", allow only `main` in both.
3. In each environment, add these secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
4. Under Settings > Secrets and variables > Actions > Variables, add
   `DEPLOY_STAGING` = `on`.

From then on, a push to main deploys staging. Production stays manual:
either `npm run deploy` from main on the laptop, or the workflow button.

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
  still go straight in. Leave "Require signed commits" and "Require linear
  history" off for now.
