# Blueprint: Aired Pro (paid plan, billing, sign-in, claiming, API keys)

> Based on: direct request (Pro plan study, 2026-11-25). Upstream: `docs/growth/seo-marketing-pricing.md` §5–6, `docs/research/artifacts-chatgpt-parity.md` §6 (gitignored, main checkout), `.forge/blueprints/content-domain.md`, `.forge/blueprints/aired-accounts.md` (main checkout)
> Design direction: DESIGN.md
> Status: Draft
> Date: 2026-11-25
> Depth: deep
> Review: fast

Decision summary for the owner: `docs/growth/pro-plan.md`. Research notes with sources: `docs/growth/research/pro-plan-billing.md`, `pro-plan-signin-agents.md`, `pro-plan-paywalls.md`, plus the earlier `competitor-pricing.md` and `team-pricing.md`.

---

## Purpose

A signed-in person can pay for Pro in two clicks and immediately publish pages with no aired badge, up to 10 MB, at a higher publish limit. Later phases add Google and email sign-in (so non-developers can pay), a way to claim pages published without an account, API keys and a signed-in remote MCP for agents, per-page analytics and a custom domain. Nobody who views a page ever pays or signs in.

## Requirements Trace

- R1. Pro costs **$12/month or $108/year** ($9/month, 25% off). One plan, one price. Viewers never pay.
- R2. Pro unlocks: no badge, 10 MB pages, 500 publishes/day, analytics per page, 1 custom domain. Free keeps: publishing, PIN, read limits, expiry, permanent pages, dashboard, projects, CLI/MCP/API, API keys.
- R3. Payment state is server-side truth, updated only from verified webhooks, and survives webhook retries and out-of-order delivery.
- R4. A plan lookup adds at most one cached KV read to a page view, and no KV write.
- R5. When Pro lapses, nothing is deleted: the badge comes back, new publishes use free limits, a custom domain redirects to the aired URL.
- R6. People without GitHub can sign in (Google, email link) and reach checkout.
- R7. A person who published without an account can attach those pages to an account, and a person who lost the token has a removal path that does not rely on the token.
- R8. Agents and CI authenticate with an API key or remote-MCP sign-in, and get a machine-readable upgrade link when a limit stops them. A human always does the paying.
- R9. Until billing is switched on (`BILLING_ENABLED` unset), production behaves exactly as today.

## Scope

### In Scope
- Billing: hosted checkout, customer portal, webhook, subscription store, entitlements.
- Feature gates in the worker: badge, page size, publish limits; later analytics and custom domain.
- Sign-in: Google OIDC, email magic link, an aired-native device flow for the CLI, a `/login` chooser.
- Page claiming: browser-held tokens, claim links, removal requests.
- API keys, authenticated remote MCP, upgrade responses (HTTP 402).
- Dashboard plan strip, billing, keys, analytics, domain screens. Pricing page copy and live button.

### Out of Scope
- Team and Business plans (workspaces, seats, roles, SSO, audit log). The `workspaceId` refactor from `seo-marketing-pricing.md` §6 is deliberately not in this plan; see Risks.
- Your-logo-instead-of-badge (white-label). Pro removes the badge; a custom logo comes with Team.
- Coupons, referral credits, lifetime deals, usage-based billing.
- Free trial. The free plan is the trial; Pro has a 14-day refund instead (Key Decisions).
- Moving pages to `aired.page` (separate blueprint). Phase 7 depends on its Phase 1 host router only.

## Prerequisites (owner, not a builder)

A builder must not do any of these. Each is listed where it blocks.

| # | What | Blocks | Notes |
|---|---|---|---|
| P1 | Confirm the billing route (default Polar; Paddle fallback; Stripe only with an entity in a Stripe country) and open the account | Phase 1 deploy (not build) | Build and test run in Polar's sandbox (sandbox.polar.sh). |
| P2 | Create the Pro product with two prices (monthly $12, yearly $108) and a webhook endpoint `https://aired.sh/api/billing/webhook` | Phase 1 deploy | Webhook events listed in "Billing Flow". |
| P3 | `wrangler d1 create aired` and paste the id into `wrangler.toml` | Phase 1 deploy | Local dev and tests use the local D1 that Miniflare creates. |
| P4 | Set secrets: `BILLING_SECRET_KEY`, `BILLING_WEBHOOK_SECRET`, `BILLING_PRICE_MONTHLY`, `BILLING_PRICE_YEARLY` | Phase 1 deploy | `wrangler secret put`. |
| P5 | Refund, terms and privacy updates (14-day refund, what happens on cancel, billing data) | Phase 1 launch | `docs/privacy.md` must name the payment processor before the button goes live. |
| P6 | Google Cloud OAuth client (Web), consent screen with `openid email profile` | Phase 3 deploy | Basic scopes only. |
| P7 | Turn on Cloudflare Email Sending for aired.sh (public beta; 3,000 emails/month included on Workers Paid; it sets SPF/DKIM/DMARC) | Task 3.4 deploy | Fallback: Resend. |
| P8 | Enable Cloudflare for SaaS on the aired.sh zone; add fallback origin `customers.aired.sh` (proxied `AAAA 100::`) and a `*/*` Worker route | Phase 7 deploy | 100 hostnames free, then $0.10 each. |
| P9 | Cloudflare API token for Analytics Engine SQL reads | Phase 6 deploy | Account Analytics: Read. |

## Context & Research

### Relevant Patterns (verified in this repo, 2026-11-25)
- Worker entry and mount order: `apps/worker/src/index.ts` (CORS → auth middleware → routes; `/api/me` mounted before `/api`).
- Session: `apps/worker/src/middleware/auth.ts` (cookie or `aired-Session` header → `c.get('user')`), `apps/worker/src/lib/jwt.ts` (HS256, `sub` is a number), `packages/core/src/jwt-claims.ts`.
- Users: KV `user:<githubId>` and `email:<email>` written by `upsertUser` in `apps/worker/src/routes/auth.ts:63`. `ownerId: number | null` on `PageMetadata` (`packages/core/src/metadata.ts`).
- Owner indexes: `apps/worker/src/lib/owner-index.ts` (KV `pages_by_owner:*`). Read `.forge/solutions/best-practices/kv-derived-null-bucket-count-and-pagination-traps-2026-06-02.md` (main checkout) before touching it.
- Claim: `POST /api/me/claim` and `/api/me/claim-batch` in `apps/worker/src/routes/me.ts:160` (`claimPage`, needs the update token). CLI: `apps/cli/src/commands/claim.ts` + local token store `apps/cli/src/core/store.ts`.
- Badge: `injectAiredBar` in `apps/worker/src/lib/aired-bar.ts`, called from `apps/worker/src/routes/viewer.ts`.
- Size limit: `validateHtml` + `MAX_SIZE` (2 MB) in `packages/core/src/validate.ts`, `constants.ts`.
- Rate limits: `apps/worker/src/lib/rate-limit-tiers.ts`, `apps/worker/src/middleware/rate-limit.ts`. **Gap found:** `/api/publish` and `/mcp` use `TIERS.anonymous` (5/hour per IP) even for signed-in users; `TIERS.authenticated` is defined but unused.
- Remote MCP: `apps/worker/src/routes/mcp.ts` always publishes with `ownerId: null` and never reads the session.
- Web publish: `apps/web/app.js:138` posts to `/api/publish` and shows the update token once; it is never saved. That is how the lost-token takedown request happened.
- Dashboard: `apps/web/dashboard.html`, `apps/web/dashboard.js` (vanilla JS, Tailwind tokens per DESIGN.md).
- Pricing page: `apps/web/pricing.html` (plain CSS, `site.css`; monthly/yearly toggle already in `app.js`).
- Pure, node-testable helpers: `apps/worker/src/lib/spam.ts` + `apps/worker/test/spam.test.ts`. Tests run with `node --experimental-strip-types --test 'test/*.test.ts'` and must not import Hono or anything that pulls in Workers types.

### Institutional Learnings
- KV writes are scarce; the namespace has hit write limits (`.forge/notes/anti-spam.md`). Every page view already does two KV writes (page `readCount` and `stats:live`). Billing adds **no** per-view writes; analytics goes to Workers Analytics Engine, not KV.
- KV secondary indexes break on derived buckets (solution doc above). New relational data (subscriptions, identities, keys, domains) goes in D1, not new KV indexes.
- Published pages run on the aired.sh origin inside a CSP sandbox (opaque origin). Keep new account endpoints behind the CSRF header (`apps/worker/src/middleware/csrf.ts`) like the existing ones.
- The session cookie is host-only on aired.sh. Custom domains and `aired.page` are cross-site, so sessions never reach them.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Price | **$12 monthly, $108 yearly** ($9/mo, 25% off). Shown yearly-first. | Already on the live pricing page, so no copy churn. Entry plans cluster at $8–13; the same bundle (no badge + domain + analytics) costs $13–25 elsewhere (Tiiny Solo $13/$18, Gamma Pro $18/$25, Notion Plus + domain about $18–22). Low enough for a non-technical maker to say yes. Raise later for new customers only. |
| Trial | No trial. 14-day full refund. | Free already lets people try everything except the paid gates. A trial adds expiry emails and dunning edge cases for one person to run; a refund window removes the purchase risk instead. |
| What's paid | Badge, size, volume, analytics, domain. Never access: PIN, read limits, expiry, permanent pages, API keys stay free. | Gate what a client-facing sender wants; never gate the agent wedge or safety controls. A free PIN is the clearest gap against Tiiny, Netlify and Vercel. |
| API keys | **Free** for every signed-in account, 5 keys. Pro raises the limits a key publishes under. | Changes the earlier proposal ("API key in Pro"). Keys are how agent and MCP publishes get an owner. Without them pages stay anonymous, tokens get lost and takedowns need manual work (this week's real case). Volume, not access, is the upgrade. |
| Billing API | Hosted checkout + hosted customer portal, called with `fetch` (no SDK) | Two REST calls and one webhook. No card form, no PCI scope, no SDK bundle on Workers. The portal handles cancel, card change, invoices and monthly↔yearly. |
| Billing provider | **Polar** (merchant of record) unless the owner already has a Stripe account in a Stripe country. Fallback: Paddle. Code sits behind `lib/billing/provider.ts`. | Stripe and Stripe Managed Payments only onboard businesses in their supported countries, so a founder elsewhere needs a foreign entity first (Stripe Atlas: $500 + $100/yr + US filings); Lemon Squeezy closed to new signups and shuts down 2027-03-31; Polar pays out through Stripe Connect Express even where Stripe Payments isn't offered, and files VAT/sales tax as the seller. Fee ~6.5% + 50¢ on a non-US card ($7.52 on $108). The interface is `createCheckout`, `createPortal`, `fetchSubscription`, `verifyWebhook`, so a later move to Stripe is one adapter. |
| Webhook handling | Verify the signature with Web Crypto HMAC-SHA256 (Polar uses the Standard Webhooks scheme: `webhook-id`, `webhook-timestamp`, `webhook-signature`); dedupe by `webhook-id` in D1; then **re-fetch the subscription** from the provider and store its current state | Providers retry, send duplicates and don't guarantee order. Fetch-on-webhook makes all three harmless. |
| Source of truth | **D1** (`aired` database) for users, identities, subscriptions, events, API keys, domains | Strongly consistent and relational. KV is eventually consistent (up to ~60 s) and write-limited. |
| Hot-path reads | KV projection `ent:<uid>` written by the webhook; read with `cacheTtl: 300` in the viewer and publish path | Page views stay on KV only (R4). D1 is read on account pages, not on views. |
| User ids | Keep `ownerId: number`. GitHub users keep their GitHub id. New users (Google, email) get ids from D1 starting at `1_000_000_000_000`. | No migration of 11,000 page records or owner indexes. GitHub ids are far below 10^12; JS integers stay exact. |
| Account linking | Link a new identity to an existing user only when both emails are verified and equal; otherwise ask the person to sign in with the method they used before | Prevents takeover through an unverified email. |
| CLI login | Add an aired-native device flow (`/auth/device` issues the code; the user approves at `aired.sh/device` after any sign-in). Keep the GitHub device flow for old CLI versions. | GitHub's device flow can't sign in a Google user. |
| Remote MCP auth | Publishing stays anonymous. Task 5.1: `Authorization: Bearer aired_sk_…` on `/mcp` unlocks account tools. Task 5.2: OAuth via `@cloudflare/workers-oauth-provider` for connector clients. | Claude Code and Cursor accept a static Bearer header today. ChatGPT accepts OAuth only, and Claude.ai's header support is a limited beta, so connector users need OAuth; ship it second. |
| Upgrade for agents | HTTP **402** `{error, code: "plan_limit", limit, upgrade_url}`; the MCP tool result carries the same link as text for the human | Agents relay a link; they never pay. |
| Analytics store | Workers Analytics Engine dataset `page_views`, written only for owned pages; read through the SQL API | No KV writes per view; 3-month retention matches a "last 90 days" chart. |
| Custom domain | Cloudflare for SaaS custom hostname, subdomain via CNAME to `customers.aired.sh` (e.g. `share.client.com`); all of the owner's pages at `/<id>`, optional home page at `/`. A failed hostname can be removed and doesn't count toward the limit. | Cheapest path on the current stack. Apex domains need Cloudflare's Enterprise-only apex proxying, so v1 is subdomains; customers whose DNS host flattens CNAMEs may still point an apex (unverified). |
| Lapse | Entitled until `current_period_end` + 3 days grace. After that: badge back, free limits for new publishes, custom domain 302s to the aired URL for 30 days, then detaches. Pages are never deleted. | Nothing a client has open breaks overnight (R5). |
| Badge on Pro pages | Hidden entirely. Abuse reporting stays reachable through `/abuse`, which accepts any page URL. | The badge's report link is a convenience, not the only route. |
| Kill switch | `BILLING_ENABLED` env var. Unset: no checkout, everyone treated as free, pricing page keeps "Coming soon". | R9: ship the code before the account exists. |

## Open Questions

### Resolved During Planning
- Can the viewer know the owner's plan without a D1 read? Yes, via KV `ent:<uid>` (one cached read, only when `ownerId !== null`).
- Do signed-in users get a different publish limit today? No; fixed in Task 1.6.
- Does a read limit need Pro? No. `reads` works free today (`apps/web/docs.html:244`). The pricing page's "Plus view-limited links" on Pro is wrong and is removed in Task 1.8.
- Can existing claim code be reused? Yes. `claimPage` stays the only place ownership changes; the new entry points (browser tokens, claim links) call it.

### Deferred to Implementation
- Exact provider payload field names once P1 is decided; isolated in `lib/billing/provider.ts`.
- Whether `GET /api/me` reads the plan from D1 or KV `ent:`. KV is fine unless a just-paid user sees "Free" for up to 60 s; the checkout success page polls D1 through `/api/billing/status`.
- Whether GitHub's verified email is always present for linking (`lib/github.ts:90` fetches the primary verified email; null when none).

## Schema Changes

D1 database `aired`, binding `DB`. Migrations in `apps/worker/migrations/` (`wrangler d1 migrations apply aired --local` for tests).

### New Tables

`users`: one row per person (GitHub users backfilled lazily on next sign-in)
| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | GitHub users inserted with their GitHub id; sequence seeded at 999,999,999,999 |
| email | TEXT | NULL | verified email if known |
| name | TEXT | NULL | |
| login | TEXT | NOT NULL | display handle (GitHub login, or email local part) |
| created_at | TEXT | NOT NULL | ISO |

`identities`: sign-in methods per user
| Column | Type | Constraints | Notes |
|---|---|---|---|
| provider | TEXT | NOT NULL | `github` \| `google` \| `email` |
| subject | TEXT | NOT NULL | GitHub id, Google `sub`, or lowercased email |
| user_id | INTEGER | NOT NULL REFERENCES users(id) | |
| email | TEXT | NULL | |
| email_verified | INTEGER | NOT NULL DEFAULT 0 | |
| created_at | TEXT | NOT NULL | |
| | | PRIMARY KEY (provider, subject) | |

`subscriptions`: current billing state, one row per user
| Column | Type | Constraints | Notes |
|---|---|---|---|
| user_id | INTEGER | PRIMARY KEY REFERENCES users(id) | |
| provider | TEXT | NOT NULL | |
| customer_id | TEXT | NOT NULL UNIQUE | |
| subscription_id | TEXT | NULL UNIQUE | |
| plan | TEXT | NOT NULL | `pro` |
| status | TEXT | NOT NULL | normalized: `active` \| `trialing` \| `past_due` \| `canceled` \| `unpaid` \| `incomplete` |
| interval | TEXT | NULL | `month` \| `year` |
| current_period_end | TEXT | NULL | ISO |
| cancel_at_period_end | INTEGER | NOT NULL DEFAULT 0 | |
| updated_at | TEXT | NOT NULL | |

`billing_events`: webhook idempotency
| Column | Type | Constraints | Notes |
|---|---|---|---|
| event_id | TEXT | PRIMARY KEY | provider event id |
| type | TEXT | NOT NULL | |
| received_at | TEXT | NOT NULL | prune after 30 days |

`auth_tokens`: one-time sign-in links and CLI device codes (D1, not KV, so single use is strict: `DELETE … RETURNING`)
| Column | Type | Constraints | Notes |
|---|---|---|---|
| hash | TEXT | PRIMARY KEY | SHA-256 of the link token or device code |
| kind | TEXT | NOT NULL | `email_link` \| `device` |
| payload | TEXT | NOT NULL | JSON: email + return path, or user code + approved uid |
| expires_at | TEXT | NOT NULL | 15 minutes after creation; expired rows pruned on read |

`api_keys`
| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | TEXT | PRIMARY KEY | opaque id shown in UI |
| user_id | INTEGER | NOT NULL REFERENCES users(id) | |
| name | TEXT | NOT NULL | user label |
| prefix | TEXT | NOT NULL | first 12 chars, for display |
| hash | TEXT | NOT NULL UNIQUE | SHA-256 hex of the full key |
| created_at | TEXT | NOT NULL | |
| last_used_at | TEXT | NULL | updated at most hourly |
| revoked_at | TEXT | NULL | |

`custom_domains`
| Column | Type | Constraints | Notes |
|---|---|---|---|
| hostname | TEXT | PRIMARY KEY | lowercased |
| user_id | INTEGER | NOT NULL UNIQUE REFERENCES users(id) | one per Pro user |
| cf_hostname_id | TEXT | NOT NULL | Cloudflare custom hostname id |
| status | TEXT | NOT NULL | `pending` \| `active` \| `failed` \| `detached` |
| home_page_id | TEXT | NULL | page served at `/` |
| created_at | TEXT | NOT NULL | |

### Indexes
| Table | Columns | Type | Rationale |
|---|---|---|---|
| identities | user_id | normal | list a user's sign-in methods |
| identities | email | normal | verified-email linking |
| api_keys | user_id | normal | dashboard list |

### KV (additive, small, written rarely)
| Key | Value | Written by | Read by |
|---|---|---|---|
| `ent:<uid>` | `{"plan":"pro","until":"ISO","status":"active"}` | webhook sync, admin script | viewer (owned pages), publish, `/api/me` |
| `apikey:<sha256>` | `{"uid":n,"keyId":"…"}` | key create; deleted on revoke | auth middleware |
| `host:<hostname>` | `{"uid":n,"home":"id"\|null}` | domain activation; deleted on detach | host router (Phase 7) |

### Migration Notes
- Additive only. No existing KV record changes shape. `PageMetadata` is untouched.
- `users`/`identities` are backfilled lazily (on next GitHub sign-in), plus a one-off script `apps/worker/scripts/backfill-users.mjs` that reads `user:*` KV records and inserts rows. The **owner** runs it; it only reads production KV.
- The first migration inserts `('users', 999999999999)` into `sqlite_sequence`, so the next AUTOINCREMENT id is 10^12.

## Billing Flow

```
Pricing page / dashboard "Get Pro"
   │ (signed out → /login?return=/upgrade?interval=year)
   ▼
POST /api/billing/checkout {interval}        (session + CSRF header)
   │  hosted checkout: price, customer email, client_reference_id=uid,
   │  subscription metadata uid, success_url=/dashboard?upgraded=1, cancel_url=/pricing
   ▼
hosted checkout ──► customer pays
   ▼
Provider ──► POST /api/billing/webhook  (raw body + signature header)
   1. verify HMAC-SHA256 with Web Crypto over `${webhook-id}.${webhook-timestamp}.${body}`
      (Standard Webhooks; Stripe would be `${t}.${body}`), 5-minute tolerance, constant-time compare
   2. INSERT OR IGNORE billing_events(event_id = webhook-id); already present → 200 and stop
   3. uid from metadata / client_reference_id / customer_id lookup
   4. GET the subscription from the provider (current truth, ignores event order)
   5. UPSERT subscriptions row; write KV ent:<uid>, or delete it when not entitled
   6. 200. Any failure before step 5 → 500, so the provider retries
   ▼
/dashboard?upgraded=1 polls GET /api/billing/status until plan = pro (max 30 s)
```

Events to subscribe (Polar): `subscription.created`, `subscription.active`, `subscription.updated`, `subscription.canceled`, `subscription.uncanceled`, `subscription.revoked`, `order.paid`, `order.refunded`. Map to the same handler: every event re-fetches the subscription.
Stripe equivalents if the route changes: `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`. Paddle: `subscription.created/updated/canceled`, `transaction.completed`, `transaction.payment_failed`.
User id travels as the provider's external customer id (Polar `external_customer_id`, Stripe `client_reference_id` + subscription metadata). Polar's exact field is to be confirmed in its API reference at build time.

Entitled when status is `active`, `trialing` or `past_due` and `now < current_period_end + 3 days`. `cancel_at_period_end` keeps Pro until the period ends.

## API Layer

| Endpoint | File | Auth | Input | Output |
|---|---|---|---|---|
| `GET /upgrade` | `routes/billing.ts` | session (redirects to sign-in) | `?interval=year\|month` | 302 to checkout |
| `POST /api/billing/checkout` | `routes/billing.ts` | session + CSRF | `{interval: "month"\|"year"}` | `{url}`; 409 if already Pro; 503 if `BILLING_ENABLED` unset |
| `POST /api/billing/portal` | `routes/billing.ts` | session + CSRF | — | `{url}`; 404 if no customer |
| `GET /api/billing/status` | `routes/billing.ts` | session | — | `{plan, status, interval, renewsAt, cancelAtPeriodEnd}` from D1 |
| `POST /api/billing/webhook` | `routes/billing.ts` | provider signature | raw body | 200 / 400 bad signature / 500 retry |
| `GET /api/me` | `routes/me.ts` | session or key | — | adds `plan`, `limits`, `billing` |
| `GET /auth/google`, `/auth/google/callback` | `routes/auth-google.ts` | — | — | session cookie, redirect |
| `POST /auth/email` | `routes/auth-email.ts` | — (rate-limited) | `{email, return}` | 202 always |
| `GET /auth/email/confirm` | `routes/auth-email.ts` | link token | `?t=` | page with a "Sign in" button (no auto-consume) |
| `POST /auth/email/confirm` | `routes/auth-email.ts` | link token | `t` | session cookie, redirect |
| `POST /auth/device`, `/auth/device/poll`, `/auth/device/approve` | `routes/auth-device.ts` | — / session | | aired-native device flow |
| `GET/POST /api/me/keys`, `DELETE /api/me/keys/:id` | `routes/keys.ts` | session + CSRF | `{name}` | key shown once on create |
| `GET /api/me/pages/:id/analytics` | `routes/analytics.ts` | session or key, Pro | `?days=7\|30\|90` | `{series, countries, referrers, devices}` |
| `POST/GET/DELETE /api/me/domain` | `routes/domains.ts` | session + CSRF, Pro | `{hostname}` | `{hostname, status, cname_target}` |

When a plan limit blocks a signed-in request: **402** `{"error":"This needs Pro","code":"plan_limit","limit":"page_size","upgrade_url":"https://aired.sh/pricing?ref=api"}`.

### Library Functions
| Function | File | Parameters | Returns |
|---|---|---|---|
| `entitlementsFor(sub, now)` | `lib/entitlements.ts` (pure) | subscription row \| null, Date | `{plan, badge, maxBytes, publishLimit, analytics, customDomain}` |
| `getEntitlements(env, uid)` | `lib/entitlements.ts` | Env, number \| null | same, via KV `ent:<uid>`; free when missing |
| `verifyStandardWebhook(body, headers, secret, nowSec)` | `lib/billing/signature.ts` (pure) | string, `{id, timestamp, signature}`, string, number | `boolean` |
| `createCheckout`, `createPortal`, `fetchSubscription` | `lib/billing/provider.ts` | Env, … | `{url}` / normalized subscription |
| `syncSubscription(env, uid, sub)` | `lib/billing/store.ts` | Env, number, normalized sub | writes D1 row + KV `ent:` |
| `generateApiKey()`, `parseApiKey(s)` | `packages/core/src/api-key.ts` (pure) | — / string | `aired_sk_…` with CRC32 checksum / `{ok}` |
| `resolveUser(env, identity)` | `lib/users.ts` | Env, `{provider, subject, email, verified, name, login}` | `{id, login, email, name}` (find, link or create) |

## Component Tree (web, vanilla)

```
apps/web/
  login.html              new: Continue with Google / GitHub / email link (tool-page rules)
  device.html             new: confirm the CLI code (after sign-in)
  claim.html              new: reads #<id>.<token>, claims after sign-in
  consent.html            new (Phase 5): "Let <client> publish to your aired account"
  dashboard.html/.js      plan strip, Get Pro / Manage billing, API keys panel,
                          "pages from this browser" banner, analytics drawer, domain panel
  pricing.html            live Pro button, corrected rows, billing FAQ
  app.js                  saves {id, token} to localStorage after publish; nav "Log in" → /login
```

## File-by-File Plan

### Phase 1: Take money — [DB] [API]
The smallest Pro that can charge: GitHub users can buy Pro and get no badge, 10 MB pages and higher limits. Ships dark behind `BILLING_ENABLED`. The dashboard and pricing tasks (1.7, 1.8) are small UI changes kept here so the phase ends with a working purchase.

#### Task 1.1: Add the D1 binding and billing schema
- **Size:** S
- **Acceptance criteria:**
  - [ ] `wrangler.toml` declares `[[d1_databases]]` with `binding = "DB"`, `database_name = "aired"`, `migrations_dir = "migrations"`; `Env` gains `DB: D1Database` and optional `BILLING_ENABLED`, `BILLING_SECRET_KEY`, `BILLING_WEBHOOK_SECRET`, `BILLING_PRICE_MONTHLY`, `BILLING_PRICE_YEARLY`.
  - [ ] `migrations/0001_accounts_billing.sql` creates `users`, `identities`, `subscriptions`, `billing_events` as specified and seeds `sqlite_sequence` so the next `users` id is 10^12.
  - [ ] `.dev.vars.example` lists the new variables with sandbox placeholders.
- **Files:** `apps/worker/wrangler.toml`, `apps/worker/migrations/0001_accounts_billing.sql`, `apps/worker/src/types.ts`, `apps/worker/.dev.vars.example`
- **Verification:** `cd apps/worker && npx wrangler d1 migrations apply aired --local` exits 0; `npx wrangler d1 execute aired --local --command "INSERT INTO users(email,login,created_at) VALUES('a@b.c','a','x') RETURNING id"` returns `1000000000000`.
- **Dependencies:** None

#### Task 1.2: Write the pure entitlements and signature helpers
- **Size:** S
- **Acceptance criteria:**
  - [ ] `entitlementsFor(null, now)` returns free limits (badge on, 2 MB, 30 publishes/hour); an `active` or `past_due` sub before `period_end + 3 days` returns Pro (badge off, 10 MB, 500/day); `canceled`, or past the grace, returns free.
  - [ ] `verifyStandardWebhook` accepts a correctly signed request (any `v1,<base64>` entry in `webhook-signature` matching HMAC-SHA256 of `id.timestamp.body` with the base64 secret after `whsec_`), and rejects a wrong secret, a tampered body and a timestamp older than 300 s, using Web Crypto only.
- **Files:** `apps/worker/src/lib/entitlements.ts`, `apps/worker/src/lib/billing/signature.ts`, `apps/worker/test/entitlements.test.ts`, `apps/worker/test/billing-signature.test.ts`
- **Verification:** `cd apps/worker && npm test` passes, including the new cases.
- **Dependencies:** None

#### Task 1.3: Add the billing provider client and store
- **Size:** M
- **Acceptance criteria:**
  - [ ] `provider.ts` implements `createCheckout(env, {uid, email, interval})`, `createPortal(env, customerId)` and `fetchSubscription(env, id)` with `fetch`; no SDK dependency.
  - [ ] `store.ts` `syncSubscription` upserts the D1 row and writes or deletes KV `ent:<uid>` from `entitlementsFor`; `recordEvent` returns false for a duplicate event id.
  - [ ] `getEntitlements(env, uid)` reads `ent:<uid>` with `cacheTtl: 300` and returns free for `uid === null`, a missing key, or `BILLING_ENABLED` unset.
- **Files:** `apps/worker/src/lib/billing/provider.ts`, `apps/worker/src/lib/billing/store.ts`, `apps/worker/src/lib/entitlements.ts`
- **Verification:** with Polar sandbox keys in `.dev.vars`: run `wrangler dev`, expose it with `cloudflared tunnel --url http://localhost:8787` (quick tunnel, no account), point the sandbox webhook at `<tunnel>/api/billing/webhook`, complete a sandbox test-card checkout; `npx wrangler d1 execute aired --local --command "SELECT status,plan FROM subscriptions"` prints `active|pro`.
- **Dependencies:** Task 1.1, Task 1.2

#### Task 1.4: Add checkout, portal, status and webhook routes
- **Size:** M
- **Acceptance criteria:**
  - [ ] `POST /api/billing/checkout` and `/portal` require session + CSRF header and return `{url}`; checkout returns 409 for a current Pro user and 503 when `BILLING_ENABLED` is unset. `GET /upgrade?interval=` signs the user in if needed, then redirects to checkout.
  - [ ] `POST /api/billing/webhook` reads the raw body, rejects bad signatures with 400, dedupes event ids, re-fetches the subscription and calls `syncSubscription`; returns 500 on a D1/KV failure so the provider retries.
  - [ ] Routes are mounted in `index.ts` before `/api`; the webhook needs no CSRF header.
- **Files:** `apps/worker/src/routes/billing.ts`, `apps/worker/src/index.ts`
- **Verification:** local dev: `curl -s -X POST localhost:8787/api/billing/webhook -d '{}' -H 'webhook-id: x' -H 'webhook-timestamp: 1' -H 'webhook-signature: v1,bad' -o /dev/null -w '%{http_code}'` prints `400`; replaying the same signed test event twice leaves one `billing_events` row.
- **Dependencies:** Task 1.3

#### Task 1.5: Hide the badge on pages whose owner has Pro
- **Size:** S
- **Acceptance criteria:**
  - [ ] `injectAiredBar(html, {…, badge: false})` adds the OG tags but no badge markup.
  - [ ] `viewer.ts` calls `getEntitlements(env, metadata.ownerId)` only when `ownerId !== null` and passes `badge`; anonymous pages are unchanged and do no extra KV read.
- **Files:** `apps/worker/src/lib/aired-bar.ts`, `apps/worker/src/routes/viewer.ts`, `apps/worker/test/aired-bar.test.ts`
- **Verification:** `npm test` passes (new case: `badge: false` output contains `og:title` and not `__aired-bar`); local dev with `ent:<uid>` set by hand in local KV: the owner's page has no badge, an anonymous page still does.
- **Dependencies:** Task 1.3

#### Task 1.6: Apply plan limits to publish (size and rate)
- **Size:** M
- **Acceptance criteria:**
  - [ ] `validateHtml(html, maxBytes = MAX_SIZE)`; `PRO_MAX_SIZE = 10 MB` in core constants. `/api/publish`, `PUT /api/pages/:id` and MCP `publish_html` pass the caller's `maxBytes`.
  - [ ] Publish limit by caller: anonymous 5/hour per IP (unchanged), signed-in free 30/hour per user (`TIERS.authenticated`, now used), Pro 500/day per user (new `TIERS.pro`), chosen in a new `publishLimit` middleware.
  - [ ] A signed-in free user over 2 MB or over the free rate gets 402 with `code: "plan_limit"` and `upgrade_url`; anonymous callers keep today's 400/429.
- **Files:** `packages/core/src/validate.ts`, `packages/core/src/constants.ts`, `apps/worker/src/lib/rate-limit-tiers.ts`, `apps/worker/src/middleware/publish-limit.ts`, `apps/worker/src/routes/api.ts`, `apps/worker/src/routes/mcp.ts`
- **Verification:** local dev: a 3 MB publish as a free signed-in user returns 402 JSON with `upgrade_url`; the same as a Pro user (`ent:` set by hand) returns 200; an anonymous 3 MB publish returns 400 as today.
- **Dependencies:** Task 1.3

#### Task 1.7: Show the plan and billing in /api/me and the dashboard
- **Size:** M
- **Acceptance criteria:**
  - [ ] `GET /api/me` adds `plan: "free"|"pro"`, `limits: {maxBytes, publishLimit}`, and `billing: {status, interval, renewsAt, cancelAtPeriodEnd} | null`.
  - [ ] Dashboard header plan strip: Free → "Get Pro" (calls checkout, then navigates); Pro → "Pro · renews <date>" and "Manage billing" (portal). `?upgraded=1` polls `/api/billing/status` every 2 s for up to 30 s, then shows "You're on Pro" or "Payment received. Refresh in a minute."
  - [ ] States: idle, pending (button disabled, "Opening checkout…"), error (inline text, retry); keyboard focusable; 44 px targets on touch; DESIGN.md tool-page rules.
- **Files:** `apps/worker/src/routes/me.ts`, `apps/web/dashboard.html`, `apps/web/dashboard.js`
- **Verification:** local dev signed in: the dashboard shows "Get Pro"; a test checkout returns to `/dashboard?upgraded=1`, which flips to "Pro · renews …" within 30 s; "Manage billing" opens the portal.
- **Dependencies:** Task 1.4

#### Task 1.8: Turn on the Pro button and correct the pricing page
- **Size:** S
- **Model:** sonnet
- **Acceptance criteria:**
  - [ ] When `/api/billing/status` reports billing on, Pro's "Coming soon" becomes "Get Pro" linking to `/upgrade?interval=<year|month>` from the toggle; otherwise it stays "Coming soon".
  - [ ] Copy follows "Pricing Page Copy" below: Pro list rewritten; "Plus view-limited links" removed; the API row says keys are free; analytics and custom domain marked "arriving soon" until Phases 6–7 ship; FAQ adds refunds, cancelling and taxes.
- **Files:** `apps/web/pricing.html`, `apps/web/app.js`
- **Verification:** local dev with `BILLING_ENABLED=1`: signed out, click "Get Pro" (yearly) → sign-in → hosted checkout shows $108/year; with it unset the button reads "Coming soon".
- **Dependencies:** Task 1.4

#### Task 1.9: Show the Pro offer where the badge is seen
- **Size:** S
- **Acceptance criteria:**
  - [ ] Signed-in free publish responses add `upgrade: {reason: "badge", url: "https://aired.sh/pricing?ref=publish"}`; the CLI prints one dim line "Remove the badge with Pro: <url>" under the page URL; MCP adds the same sentence to its text.
  - [ ] Anonymous and Pro responses don't carry it; JSON output (`--json`) keeps the field but prints nothing extra.
- **Files:** `apps/worker/src/routes/api.ts`, `apps/worker/src/routes/mcp.ts`, `apps/cli/src/commands/publish.ts`
- **Verification:** local dev with `BILLING_ENABLED=1`: `aired publish x.html` signed in as free prints the line; as Pro (`ent:` set) it doesn't.
- **Dependencies:** Task 1.6, Task 2.3

**Checkpoint after Phase 1:** `cd apps/worker && npm test` green; local D1 migrations apply clean; one sandbox purchase, cancellation and revoke round-trip updates `ent:<uid>`.

### Phase 2: Claim pages and recover lost ones — [API] [UI]
Independent of Phase 1; can run in parallel. Fixes the lost-token takedown class.

#### Task 2.1: Keep publish tokens in the publisher's browser
- **Size:** S
- **Acceptance criteria:**
  - [ ] After a successful anonymous web publish, `app.js` adds `{id, token, title, createdAt}` to `localStorage["aired.pages"]` (newest first, cap 200).
  - [ ] The result card says "Saved in this browser. Sign in to keep it in your account." with a sign-in link.
- **Files:** `apps/web/app.js`, `apps/web/index.html`
- **Verification:** publish from `localhost:8787/` signed out; in devtools `localStorage["aired.pages"]` holds the id and token; after a reload the entry is still there.
- **Dependencies:** None

#### Task 2.2: Offer to add browser-held pages after sign-in
- **Size:** S
- **Acceptance criteria:**
  - [ ] On dashboard load, entries from `aired.pages` show a banner "N pages you published in this browser · Add to my account"; the button calls `/api/me/claim-batch`, removes claimed entries, and lists failures as "Couldn't add".
  - [ ] "Not now" hides the banner for that set; nothing is sent to the server without the click.
- **Files:** `apps/web/dashboard.html`, `apps/web/dashboard.js`
- **Verification:** with two saved entries, sign in and click "Add to my account": both rows appear in the list, the banner disappears and the page count rises by 2.
- **Dependencies:** Task 2.1

#### Task 2.3: Return a claim link from anonymous API and MCP publishes
- **Size:** M
- **Acceptance criteria:**
  - [ ] Anonymous `POST /api/publish` responses add `claim_url: "https://aired.sh/claim#<id>.<token>"` (a fragment, so it never reaches server logs).
  - [ ] MCP `publish_html` text adds "To keep this page in an aired account, open: <claim_url>"; CLI `publish` prints it when not signed in.
  - [ ] `claim.html` reads the fragment and claims via `/api/me/claim` when signed in; otherwise keeps it in `sessionStorage`, sends the user to sign in, and finishes the claim on return.
- **Files:** `apps/worker/src/routes/api.ts`, `apps/worker/src/routes/mcp.ts`, `apps/web/claim.html`, `apps/cli/src/commands/publish.ts`
- **Verification:** local dev: an anonymous curl publish returns `claim_url`; open it signed out → sign in → land on the dashboard with the page listed.
- **Dependencies:** None

#### Task 2.4: Add a "remove my page" request for lost tokens
- **Size:** S
- **Model:** sonnet
- **Acceptance criteria:**
  - [ ] The `/abuse` form gets the reason "I published this and lost the link to manage it", stored with the existing report shape plus `reason: "owner_removal"`.
  - [ ] `scripts/abuse.mjs` lists owner-removal requests first; the page says removal is honoured on review and ownership is never transferred without the token.
- **Files:** `apps/web/abuse.html`, `apps/worker/src/routes/report.ts`, `apps/worker/scripts/abuse.mjs`
- **Verification:** submit the form with that reason in local dev; the local listing from `abuse.mjs` shows it first with `owner_removal`.
- **Dependencies:** None

**Checkpoint after Phase 2:** `npm test` green; the three claim paths (browser banner, claim link, CLI `aired claim --all`) each attach a page in local dev.

### Phase 3: Sign in without GitHub — [API] [UI]

#### Task 3.1: Resolve users across identities in D1
- **Size:** M
- **Acceptance criteria:**
  - [ ] `resolveUser(env, identity)` returns the linked user for a known identity; links to an existing user only when both emails are verified and equal; otherwise creates a user (id ≥ 10^12) and an identity.
  - [ ] The GitHub callback calls it too, inserting `users.id = githubId` on first sight, so existing accounts keep their id and pages.
  - [ ] `0002_auth_tokens.sql` creates `auth_tokens` (used by Tasks 3.4 and 3.5).
- **Files:** `apps/worker/src/lib/users.ts`, `apps/worker/src/routes/auth.ts`, `apps/worker/migrations/0002_auth_tokens.sql`, `apps/worker/test/users.test.ts`
- **Verification:** `npm test` passes (new Google user → id 10^12; Google with a verified email equal to a GitHub user's → same id; unverified match → new id).
- **Dependencies:** Task 1.1

#### Task 3.2: Add Google sign-in
- **Size:** M
- **Acceptance criteria:**
  - [ ] `/auth/google` starts an OIDC code flow with PKCE (S256), `state` and `nonce`, hand-rolled with `fetch` + `jose` (`arctic` was deprecated in July 2026); `/auth/google/callback` exchanges the code, verifies the ID token against Google's JWKS with `jose`, reads `sub`, `email`, `email_verified`, `name`, and issues the existing session cookie.
  - [ ] Return paths reuse `isAllowedReturn`, extended with `/upgrade`, `/claim` and `/device`.
- **Files:** `apps/worker/src/routes/auth-google.ts`, `apps/worker/src/lib/google.ts`, `apps/worker/src/index.ts`, `apps/worker/src/types.ts`
- **Verification:** local dev with a test OAuth client: `/auth/google?return=/dashboard` → Google consent → dashboard shows the Google name; `GET /api/me` returns an id ≥ 10^12.
- **Dependencies:** Task 3.1

#### Task 3.3: Add the /login chooser and point every "Log in" at it
- **Size:** S
- **Acceptance criteria:**
  - [ ] `login.html`: "Continue with Google", "Continue with GitHub", "Email me a sign-in link" (hidden until Task 3.4 ships); passes `return` through.
  - [ ] Nav "Log in" on marketing pages, the signed-out `/dashboard` redirect and `/upgrade` all go to `/login`.
- **Files:** `apps/web/login.html`, `apps/web/app.js`, `apps/worker/src/routes/dashboard.ts`, `apps/worker/src/routes/billing.ts`
- **Verification:** signed out, visit `/dashboard` → `/login?return=/dashboard`; each button reaches its provider and returns to the dashboard.
- **Dependencies:** Task 3.2

#### Task 3.4: Add email magic-link sign-in
- **Size:** M
- **Acceptance criteria:**
  - [ ] `POST /auth/email` (rate-limited per IP and per address) always returns 202, stores an `auth_tokens` row (`kind = email_link`, 15 minutes), and sends one email with the link and a 6-digit code (the code covers people who open mail on another device).
  - [ ] `GET /auth/email/confirm?t=` shows a page with a "Sign in" button, so link scanners can't use the token; `POST` consumes it once and signs in via `resolveUser` with `provider: 'email', verified: true`.
- **Files:** `apps/worker/src/routes/auth-email.ts`, `apps/worker/src/lib/email.ts`, `apps/web/login.html`
- **Verification:** local dev with `EMAIL_DEV_LOG=1` (prints the link instead of sending): request a link, open it, click "Sign in" → dashboard; opening it again shows "This link was already used".
- **Dependencies:** Task 3.3

#### Task 3.5: Add an aired-native device flow for the CLI
- **Size:** M
- **Acceptance criteria:**
  - [ ] `POST /auth/device` returns `{device_code, user_code, verification_uri: "https://aired.sh/device", interval}`; `device.html` (after any sign-in) approves the code; `/auth/device/poll` then returns a CLI session (365-day JWT, as today).
  - [ ] CLI `aired login --device` uses the new flow; old CLI versions keep working against the GitHub flow.
- **Files:** `apps/worker/src/routes/auth-device.ts`, `apps/web/device.html`, `apps/cli/src/commands/login.ts`, `apps/cli/src/core/client.ts`
- **Verification:** `node apps/cli/dist/index.js --api-url http://localhost:8787 login --device`, approve at `localhost:8787/device` with a Google account; `aired whoami` prints that account.
- **Dependencies:** Task 3.2

**Checkpoint after Phase 3:** `npm test` green; a Google-only user signs in on web and CLI and completes a test checkout.

### Phase 4: API keys — [DB] [API]

#### Task 4.1: Generate and parse API keys
- **Size:** S
- **Acceptance criteria:**
  - [ ] `generateApiKey()` returns `aired_sk_` + 32 base62 characters + a 6-character CRC32 checksum; `parseApiKey` rejects a wrong prefix, length or checksum without a lookup.
- **Files:** `packages/core/src/api-key.ts`, `packages/core/src/index.ts`, `apps/worker/test/api-key.test.ts`
- **Verification:** `npm test` passes (generated keys parse; one changed character fails the checksum).
- **Dependencies:** None

#### Task 4.2: Store keys and accept them in the auth middleware
- **Size:** M
- **Acceptance criteria:**
  - [ ] `migrations/0003_api_keys.sql`; `POST /api/me/keys {name}` returns the key once; `GET` lists name, prefix, created and last used; `DELETE` revokes (D1 `revoked_at`, KV `apikey:` deleted). At most 5 active keys.
  - [ ] `authMiddleware` accepts `Authorization: Bearer aired_sk_…` (checksum, then KV `apikey:<hash>`), sets `c.get('user')`, and never treats `at_` update tokens as keys. `last_used_at` updates at most hourly via `waitUntil`.
  - [ ] Key-authenticated requests don't need the CSRF header (no cookie involved); cookie requests still do.
- **Files:** `apps/worker/migrations/0003_api_keys.sql`, `apps/worker/src/routes/keys.ts`, `apps/worker/src/middleware/auth.ts`, `apps/worker/src/middleware/csrf.ts`, `apps/worker/src/index.ts`
- **Verification:** local dev: create a key, then `curl -s -X POST localhost:8787/api/publish -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{"html":"<h1>k</h1>"}'` → the page appears in `/api/me/pages`; after revoking, `GET /api/me` with the key returns 401.
- **Dependencies:** Task 4.1, Task 1.1

#### Task 4.3: Add the API keys panel and the CLI env var
- **Size:** S
- **Acceptance criteria:**
  - [ ] Dashboard "API keys" panel: create (name), copy-once dialog, list, revoke with confirm.
  - [ ] CLI and local MCP send `AIRED_API_KEY` as a Bearer header when set; docs show CI usage.
- **Files:** `apps/web/dashboard.html`, `apps/web/dashboard.js`, `apps/cli/src/core/client.ts`, `apps/mcp/src/index.ts`, `apps/web/docs.html`
- **Verification:** create a key in the dashboard; `AIRED_API_KEY=… aired publish x.html` → the page shows in the dashboard under the account.
- **Dependencies:** Task 4.2

**Checkpoint after Phase 4:** `npm test` green; key publish, revoke and 402-on-limit work in local dev.

### Phase 5: Signed-in remote MCP — [API] [CONFIG]

#### Task 5.1: Use the caller's identity in remote MCP
- **Size:** M
- **Acceptance criteria:**
  - [ ] `/mcp` with a valid Bearer key publishes with `ownerId` set, plan limits applied, and the spam filter skipped, like signed-in API publishes.
  - [ ] New tools for signed-in callers: `list_pages`, `update_page` (by id, no token for own pages), `delete_page`, `get_account` (plan, limits, `upgrade_url`).
  - [ ] Limit errors return `isError: true` with text that includes the upgrade link and says a person needs to open it.
- **Files:** `apps/worker/src/routes/mcp.ts`, `apps/worker/src/index.ts`, `apps/worker/test/abuse.test.ts`
- **Verification:** MCP Inspector against `localhost:8787/mcp` with `Authorization: Bearer <key>`: `publish_html`, then `list_pages` shows the page; without the header, `list_pages` returns "Sign in required".
- **Dependencies:** Task 4.2

#### Task 5.2: Add OAuth to the remote MCP for connector clients
- **Size:** L
- **Acceptance criteria:**
  - [ ] `/mcp` advertises OAuth protected-resource metadata; `@cloudflare/workers-oauth-provider` serves `/authorize` and `/token`, accepts Client ID Metadata Documents (preferred by the 2026-07-28 MCP spec) and dynamic registration (still used by older clients), and `/authorize` reuses the aired session (sign in via `/login`, then `consent.html`). API keys keep working on the same endpoint via `resolveExternalToken`.
  - [ ] Anonymous MCP keeps working: no token → anonymous tools only.
- **Files:** `apps/worker/src/index.ts`, `apps/worker/src/routes/mcp-oauth.ts`, `apps/web/consent.html`, `apps/worker/package.json`, `apps/worker/wrangler.toml`
- **Verification:** MCP Inspector's OAuth flow against `http://localhost:8787/mcp`: sign-in and consent complete, and `get_account` returns the signed-in user.
- **Dependencies:** Task 5.1

**Checkpoint after Phase 5:** `npm test` green; MCP Inspector works for anonymous, key and OAuth sessions.

### Phase 6: Analytics — [API] [UI]

#### Task 6.1: Record views of owned pages in Analytics Engine
- **Size:** S
- **Acceptance criteria:**
  - [ ] `wrangler.toml` adds `[[analytics_engine_datasets]]` with `binding = "PAGE_VIEWS"`; the viewer calls `writeDataPoint` for owned pages only: index `ownerId`, blobs `[pageId, country, referrerHost, deviceClass]`, double `1`. No KV change.
- **Files:** `apps/worker/wrangler.toml`, `apps/worker/src/types.ts`, `apps/worker/src/routes/viewer.ts`, `apps/worker/src/lib/view-event.ts`, `apps/worker/test/view-event.test.ts`
- **Verification:** `npm test` passes (`deviceClass` and `referrerHost` parsing cases).
- **Dependencies:** None

#### Task 6.2: Serve per-page analytics to Pro owners
- **Size:** M
- **Acceptance criteria:**
  - [ ] `GET /api/me/pages/:id/analytics?days=30` checks ownership and Pro (402 otherwise), queries the SQL API with `CF_ACCOUNT_ID` + `CF_ANALYTICS_TOKEN`, and returns daily views, top countries, referrers and devices, cached 5 minutes.
- **Files:** `apps/worker/src/routes/analytics.ts`, `apps/worker/src/lib/analytics-query.ts`, `apps/worker/src/index.ts`
- **Verification:** with a staging token, the endpoint returns a 30-element `series` for an owned page; a free owner gets 402 with `upgrade_url`.
- **Dependencies:** Task 6.1, Task 1.3

#### Task 6.3: Add the analytics drawer to the dashboard
- **Size:** M
- **Acceptance criteria:**
  - [ ] Each row gets "Stats". Pro opens a drawer: 30-day bar chart (inline SVG, no library), top 3 countries with flags, referrers, devices. Free sees the total view count and a locked preview with "Get Pro".
  - [ ] Skeleton while loading, empty state "No views yet", error with retry; focus moves into the drawer and back on close; Escape closes.
- **Files:** `apps/web/dashboard.html`, `apps/web/dashboard.js`
- **Verification:** signed in as Pro in local dev with mocked data: "Stats" opens the drawer with 30 bars; as free, the locked preview and "Get Pro" appear.
- **Dependencies:** Task 6.2

**Checkpoint after Phase 6:** `npm test` green; analytics returns data in staging for an owned page.

### Phase 7: Custom domain — [API] [UI]
Requires `.forge/blueprints/content-domain.md` Phase 1 (host classifier) to be merged first.

#### Task 7.1: Create and verify a customer hostname
- **Size:** M
- **Acceptance criteria:**
  - [ ] `migrations/0004_custom_domains.sql`; `POST /api/me/domain {hostname}` (Pro only, subdomains only, one per user) creates a Cloudflare custom hostname and returns `{status: "pending", cname_target}`; `GET` refreshes status from Cloudflare; `DELETE` removes it.
  - [ ] On `active` it writes KV `host:<hostname>`; on delete or lapse it deletes it.
- **Files:** `apps/worker/migrations/0004_custom_domains.sql`, `apps/worker/src/routes/domains.ts`, `apps/worker/src/lib/cf-custom-hostnames.ts`, `apps/worker/src/index.ts`
- **Verification:** staging zone: add a test subdomain, create the shown CNAME, and `GET /api/me/domain` reaches `active` within 10 minutes.
- **Dependencies:** Task 1.3

#### Task 7.2: Serve owner pages on the customer hostname
- **Size:** M
- **Acceptance criteria:**
  - [ ] Host router: a host with `host:<hostname>` serves `/<id>` and `/p/<id>` only for that owner's pages and `/` for `home_page_id`; everything else (including `/api`, `/auth`, `/mcp`, `/dashboard`) is 404.
  - [ ] Pages on a customer host get no sandbox shim and no badge; if the owner is no longer Pro, requests 302 to `https://aired.sh/p/<id>`.
- **Files:** `apps/worker/src/lib/content-host.ts`, `apps/worker/src/routes/viewer.ts`, `apps/worker/test/content-host.test.ts`
- **Verification:** `npm test` passes (custom host + another owner's page id → 404; custom host + `/api/me` → 404); staging: `https://<test-subdomain>/<id>` renders the page.
- **Dependencies:** Task 7.1

#### Task 7.3: Add the domain panel to the dashboard
- **Size:** S
- **Acceptance criteria:**
  - [ ] Panel: enter a hostname, see the exact record to add ("Type: CNAME · Name: share · Target: <cname_target>"), live status (pending → active), choose a home page, remove. Free users see it locked.
- **Files:** `apps/web/dashboard.html`, `apps/web/dashboard.js`
- **Verification:** staging: add a hostname, add the shown record, watch the status turn "Active"; the copy-link button now copies the custom-domain URL.
- **Dependencies:** Task 7.1

**Checkpoint after Phase 7:** `npm test` green; one staging custom hostname serves pages and refuses app routes.

## Pricing Page Copy (Task 1.8)

Pro card:
- Title **Pro**, tag "For client work"
- Line: "Send work under your own name."
- Price: **$9 / month**, "Billed yearly, $108". Monthly toggle: **$12 / month**, "Billed monthly".
- Button: **Get Pro**
- "Everything in Free, plus":
  - No aired badge on your pages
  - Pages up to 10 MB
  - 500 publishes a day
  - Views over time, countries and referrers *(tag "Soon" until Phase 6 ships)*
  - Your own domain, like share.yourco.com *(tag "Soon" until Phase 7 ships)*
- Under the cards: "People you send links to never pay. Cancel anytime. 14-day refund. Prices in USD; tax added at checkout where it applies."

Free card adds: "API keys for agents and CI".

Compare table: "Link and password" → Pro "Same as Free"; "API" → Free "HTTP API, CLI, MCP and API keys", Pro "Higher limits"; drop the Pro "Your choice per page" search claim until it exists.

FAQ additions:
- **What happens if I cancel?** "You keep Pro until the end of the period you paid for. After that your pages stay up, the badge comes back, and your own domain points back to aired.sh links."
- **Can I get a refund?** "Yes, a full refund within 14 days of paying."
- **Do my agents need Pro?** "No. Agents can publish with a free API key. Pro raises the limits and removes the badge."

## Verification Criteria
- [ ] With `BILLING_ENABLED` unset: pricing shows "Coming soon", `POST /api/billing/checkout` returns 503, and pages render exactly as before (badge on).
- [ ] Polar sandbox: a signed-in free user clicks "Get Pro" (yearly), pays with a test card, lands on `/dashboard?upgraded=1`, sees "Pro · renews <date>" within 30 s; their existing pages render without the badge within 5 minutes.
- [ ] Replaying the same webhook event returns 200 and changes nothing; a bad signature returns 400.
- [ ] Cancelling in the portal keeps Pro until the period ends; after period end + 3 days (test clock or a forced `subscription.deleted`), the badge returns and no page is deleted.
- [ ] A free signed-in user publishing 3 MB gets 402 with `upgrade_url`; an anonymous 3 MB publish gets 400 as today.
- [ ] A Google-only user signs in, publishes, buys Pro, and logs in on the CLI via `/device`.
- [ ] An anonymous publish's `claim_url` attaches the page after sign-in; browser-held pages attach from the dashboard banner.
- [ ] An API key publishes owned pages over HTTP and remote MCP; a revoked key no longer authenticates.
- [ ] A custom hostname serves only its owner's pages and returns 404 for `/api/me`.

## Estimate

| Phase | Tasks | Sizes | Range |
|-------|-------|-------|-------|
| Phase 1: Take money | 1.1–1.9 | S, S, M, M, S, M, M, S, S | 2–3 days |
| Phase 2: Claim and recover | 2.1–2.4 | S, S, M, S | 0.5–1 day |
| Phase 3: Sign in without GitHub | 3.1–3.5 | M, M, S, M, M | 2–3 days |
| Phase 4: API keys | 4.1–4.3 | S, M, S | 1 day |
| Phase 5: Signed-in remote MCP | 5.1–5.2 | M, L | 1.5–3 days |
| Phase 6: Analytics | 6.1–6.3 | S, M, M | 1–2 days |
| Phase 7: Custom domain | 7.1–7.3 | M, M, S | 2–3 days (plus content-domain Phase 1) |
| Review and manual testing (billing, auth, domains) | | | 2–3 days |
| **Total** | | | **12–19 working days** |

**Assumptions:**
- Cloudflare Workers paid plan (already in use for the Rate Limiting bindings), with D1 and Analytics Engine available.
- The billing provider has hosted checkout, a customer portal and signed webhooks.
- Owner prerequisites P1–P9 happen on time. Billing and OAuth integrations are where estimates usually double.
- No end-to-end test harness exists; verification is unit tests plus manual local and staging runs.

**Excludes:** owner account setup, legal text review, deployment, launch comms.

## Three-Tier Boundaries
### Always (builder proceeds without asking)
- Follow existing patterns (`spam.ts`-style pure helpers with node tests; CSRF header on every cookie-authenticated write).
- Keep every new gate behind `getEntitlements` and `BILLING_ENABLED`.
- Run lint and the task's Verification line per task; typecheck and build run once, at the end of the run.

### Ask First
- Any new npm dependency (expected only: `@cloudflare/workers-oauth-provider` in Task 5.2).
- Any change to `PageMetadata`, owner indexes or existing KV key shapes.
- Any change to session, JWT or CSRF behaviour beyond what a task states.
- Any change to what is free today.

### Never
- Create, configure or sign in to a billing, Google, email or Cloudflare account; run anything against production KV, R2 or D1; deploy.
- Commit secrets or real keys; log webhook bodies, email addresses or keys.
- Treat the checkout redirect as proof of payment. Only the webhook writes plan state.
- Delete pages when a subscription ends.

## Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| Provider unavailable in the owner's country, or account rejected | No way to charge | Decide P1 first; provider code isolated behind three functions; fallback named in `docs/growth/pro-plan.md`. |
| Webhook missed or delayed | Paid user stays on Free | Providers retry for days; `/api/billing/status` reads D1; an admin script re-syncs one user from the provider. |
| KV `ent:` lag (up to ~60 s) after payment | Badge visible for a minute | Success page polls D1; copy says "within a minute". |
| No `workspaceId` on pages | Team plan later needs an ownership migration | Accepted: Team is out of scope and gated on demand; Pro is per person, so `ownerId` fits. Revisit before Team. |
| Account linking by email | Takeover through an unverified email | Link verified-to-verified only; never on GitHub noreply addresses. |
| API key leaks in a public repo | Someone publishes as the user | Checksummed prefix allows secret scanning later; one-click revoke; keys can't delete the account or touch billing. |
| Custom domains serve user HTML on customer origins | Phishing on a trusted-looking domain | Pro only (paid, accountable), owner's pages only, abuse path unchanged, hostname removed on abuse. |
| Analytics Engine samples at high volume | Approximate counts | Label as approximate; exact `readCount` stays in KV. |
| Removing the badge shrinks the growth loop | Fewer referrals | Only paying users remove it; free pages, the vast majority, keep it. |
