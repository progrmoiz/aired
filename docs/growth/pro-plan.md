# Aired Pro: what to charge, what's paid, what you decide

*2026-11-25. The build plan is `.forge/blueprints/pro-plan.md`. Sources are in [research/pro-plan-billing.md](research/pro-plan-billing.md), [research/pro-plan-signin-agents.md](research/pro-plan-signin-agents.md) and [research/pro-plan-paywalls.md](research/pro-plan-paywalls.md).*

## The answer

| | |
|---|---|
| **Price** | **$9/month billed yearly ($108), or $12 monthly.** One plan. |
| **Trial** | None. Free is the trial. 14-day full refund instead. |
| **What people pay for** | Their name on the work: no badge, their own domain, who opened it. |
| **Status** | Decided 2026-11-25. Phase 1 is being built. |
| **What stays free** | Publishing, viewing, PIN, read limits, expiry, permanent pages, the dashboard, CLI, MCP and API keys. |
| **First thing to build** | Checkout + webhook + "no badge, 10 MB, 500 publishes a day". About 2–3 days. |
| **How to get paid** | **Stripe** (decided): Checkout for paying, the customer portal for cancelling and switching plans. |

## Free vs Pro

| | Free | Pro |
|---|---|---|
| Publish, view, share links | ✓ | ✓ |
| PIN, read limits, expiry, permanent pages | ✓ | ✓ |
| Dashboard, projects, CLI, MCP, HTTP API | ✓ | ✓ |
| API keys for agents and CI | ✓ (5 keys) | ✓ |
| aired badge on pages | Shown | **Off** |
| Page size | 2 MB | **10 MB** |
| Publishes | 5 an hour without an account, 30 an hour signed in | **500 a day** |
| Views over time, countries, referrers | Total views only | **✓** |
| Your own domain (`share.yourco.com`) | — | **1** |
| People you send links to | Never pay, never sign up | Same |

**Ships first (phase 1):** badge off, 10 MB, 500 a day. **Then:** analytics (phase 6), custom domain (phase 7). Until they ship the pricing page tags them "Soon", and early buyers get them at no extra cost.

## Why this price

- **It's already on the pricing page.** $9 yearly / $12 monthly is live as "Coming soon", so nothing has to be re-explained.
- **It undercuts the same bundle elsewhere.** Tiiny Host charges $13 / $18 for Solo, its plan with a custom domain and password. Gamma Pro is $18 / $25. Notion is about $18–22 with a domain. Entry plans cluster at $8–13.
- **It's an easy yes for a non-technical maker.** That buyer compares it with Claude Pro and ChatGPT Plus at $20, not with developer hosting.
- **25% off yearly sits in the normal range.** Most tools discount 15–20%; Gamma goes to 28% and Webflow to 40%. Yearly plans churn less.
- **Raise it later for new buyers only.** Never for people already paying.

## What changed from the earlier proposal

1. **API keys are free, not Pro.** Agents and MCP publishes need keys so pages get an owner. Without one, tokens get lost and takedowns become manual work, as with this week's real request. Pro raises the limits a key publishes under.
2. **Read limits are already free.** The pricing page lists "view-limited links" under Pro; that line goes.
3. **No free trial.** It adds expiry emails and dunning to run alone. A refund window covers the risk.
4. **Signed-in users have their own limit.** Since `d4679ce` a signed-in publish counts against the account (30 an hour), not the anonymous 5-an-hour limit by IP. Pro adds 500 a day.

## How the money moves

```
Get Pro ─► sign in (WorkOS: Google, GitHub or email code) ─► Stripe Checkout (Stripe-hosted page)
        ─► Stripe tells aired "paid" (signed webhook) ─► aired stores the plan
        ─► the badge disappears from your pages within 5 minutes
Cancel or switch monthly↔yearly ─► Stripe customer portal ─► Pro until the paid period ends
        ─► badge comes back (pages are never deleted)
Card fails ─► Stripe retries for a few weeks, Pro stays on ─► retries run out ─► back to Free
```

Agents never pay. When one hits a limit, aired returns an upgrade link and the agent passes it to a person.

**Where Pro is offered:** the dashboard plan strip; one line under the URL after a signed-in publish ("Remove the badge with Pro"); locked previews of analytics and the custom domain in the dashboard. Never a pop-up, and never on pages your viewers see.

## Build order

| # | Phase | What people get | Size |
|---|---|---|---|
| 1 | **Take money** | Buy Pro (GitHub sign-in): no badge, 10 MB, 500/day, billing in the dashboard | 2–3 days |
| 2 | Claim pages | Pages published without an account can be added to one; a "remove my page" path for lost links | ½–1 day, can run alongside 1 |
| 3 | Sign in with WorkOS | One sign-in page with Google, GitHub and email codes; existing GitHub users keep their account and pages; CLI login for everyone | 2–3 days |
| 4 | API keys | Keys for CI and agents, from the dashboard | 1 day |
| 5 | Signed-in MCP | Agents can list, update and delete their own pages; connectors in Claude and ChatGPT | 1½–3 days |
| 6 | Analytics | Views over time, countries, referrers per page | 1–2 days |
| 7 | Custom domain | `share.yourco.com` serves your pages | 2–3 days, after the aired.page move's routing |
| 8 | Workspaces and members | Team workspaces, invites by email or link, a workspace switcher, paid editor seats | planned |
| 9 | Five fixed roles | Owner, Admin, Member (paid seats); Viewer, Guest (free) | planned |
| 10 | Page access | Share dialog: view, comment, edit, full; viewers and guests capped at comment; guests by email code | planned |
| 11 | Groups | Share with "Design" once; groups made by hand, no SSO needed | planned |
| 12 | Company domains | Verify acme.com; request-to-join or auto-join | planned |
| 13 | SSO and SCIM | Company sign-in (add-on) and directory sync (Enterprise) through WorkOS | planned |
| 14 | Audit log | Who did what, with export | planned |

Phases 1–7 total about 12–19 working days including review and testing. Phases 8–14 are planned only; they start after the workspace pricing below is decided. **Announce Pro widely after phase 3**, so people without GitHub can buy it. Phase 1 can go live quietly before that.

## Decided (2026-11-25)

1. **Billing: Stripe.** Aired is the seller, so tax registration and filing are yours. Stripe Tax is built in but switched off (see below).
2. **Price: $9/month billed yearly ($108), or $12 monthly.**
3. **API keys are free.**
4. **Refunds: 14 days, full, no questions.** Issued by hand in the Stripe dashboard.
5. **When Pro lapses:** pages stay up, the badge returns, and the custom domain redirects to aired.sh links for 30 days, then disconnects.
6. **Sign-in: WorkOS AuthKit** replaces GitHub-only login. Free up to 1M monthly active users. GitHub stays as one button; your existing accounts keep their ids and pages.
7. **One database.** The D1 database added for billing also holds workspaces, roles, groups and the audit log later.

## Still yours to decide

- **Stripe Tax: on or off.** Off by default. Turning it on (`STRIPE_AUTOMATIC_TAX=1`) makes Checkout add and collect tax for 0.5% per sale. Stripe does **not** register you or file returns; you do that wherever you're registered. Stripe Tax's threshold monitoring shows where registration becomes due. Selling digital services to EU and UK consumers usually needs registration from the first sale for sellers based outside those regions.

- **Workspace pricing (Team, Business, Enterprise).** Recommended, not decided:
  - **SSO (SAML/OIDC, e.g. Okta, Entra): a $150/mo add-on on Business, included in Enterprise.** It replaces the earlier idea of SSO inside Business, and the live pricing page still lists "SSO: SAML, Okta, Google" under Business, so that line changes when you decide.
  - **SCIM (directory sync): Enterprise only.**
  - **Why:** WorkOS charges per customer company per month, and SSO and Directory Sync (SCIM) are separate products:

    | Connections | 1–15 | 16–30 | 31–50 | 100+ |
    |---|---|---|---|---|
    | SSO, per company per month | $125 | $100 | $80 | $65 |
    | SCIM, per company per month | $125 | $100 | $80 | $65 |

    A company with both costs us **$250/mo** at the start, so SCIM goes where the floor is about $500/mo (Enterprise). SSO alone costs us $125 and sells for $150. Rule: never put a paid connection inside a plan whose floor is under about 3× its cost. Business at $20 per editor with a minimum of 3 is $60/mo, which is why SSO can't be included in it. Google, GitHub and email sign-in, and "require Google sign-in for @acme.com", cost nothing and go on every plan that needs them.
  - **Seats:** Owner, Admin and Member are paid editor seats; Viewer and Guest are free.
- **Moving old pages into workspaces.** Recommended: don't. Every existing page counts as being in its owner's personal workspace, with no rewrite of about 11,000 records. The workspace spec moves them; this plan avoids the rewrite.

## Set up (only you can)

| When | What |
|---|---|
| Before phase 1 goes live | Everything in the Stripe checklist below |
| Before phase 1 goes live | Refund policy, terms and privacy updated to name Stripe as the payment processor |
| Before the next deploy of this branch | `wrangler d1 create aired`, paste the id into `apps/worker/wrangler.toml` (a placeholder today, so `wrangler deploy` fails until it's replaced), then `wrangler d1 migrations apply aired --remote` (migrations 0001 and 0002) |
| Before phase 3 | WorkOS account (staging first, free): turn on Google, GitHub (with "return OAuth tokens") and Magic Auth in AuthKit; redirect URI `https://aired.sh/auth/workos/callback`; `wrangler secret put WORKOS_API_KEY` and `WORKOS_CLIENT_ID` |
| Before phase 6 | Cloudflare API token that can read Analytics Engine |
| Before phase 7 | Cloudflare for SaaS on aired.sh (100 hostnames free, then $0.10 each) and the content-domain routing from `.forge/blueprints/content-domain.md` |

### Stripe checklist (test mode first, then the same in live mode)

| # | Where in Stripe | What |
|---|---|---|
| 1 | Product catalog → Add product | **Aired Pro**, two recurring prices: **$12.00 USD monthly** and **$108.00 USD yearly**. Copy both `price_…` ids. |
| 2 | Developers → Webhooks → Add endpoint | URL `https://aired.sh/api/billing/webhook`. Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Copy the signing secret (`whsec_…`). |
| 3 | Developers → API keys → Create restricted key | Permissions: Checkout Sessions **write**, Customer portal **write**, Customers **write**, Subscriptions **read**. Nothing else. Copy the `rk_…` key. |
| 4 | Settings → Billing → Customer portal | Allow cancel (at the end of the period), switching between the two Pro prices, updating the payment method and seeing invoices. Default return link `https://aired.sh/dashboard`. |
| 5 | Settings → Billing → Subscriptions and emails | Turn on Smart Retries and the failed-payment emails, and set "cancel the subscription" when retries run out. |
| 6 | Settings → Tax (only if you turn Stripe Tax on) | Origin address, default tax code "SaaS" (`txcd_10000000`), then `STRIPE_AUTOMATIC_TAX=1`. |
| 7 | Terminal | `wrangler secret put STRIPE_SECRET_KEY` (the `rk_…` key), `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`, then set `BILLING_ENABLED=1` and deploy. |
| 8 | Later, if you ever change the price | Create the new prices, put the **old** price ids in `STRIPE_LEGACY_PRICE_IDS` (comma-separated) **before** switching `STRIPE_PRICE_MONTHLY`/`YEARLY`, so existing subscribers stay Pro. |

Check in test mode before live: `stripe listen --forward-to localhost:8787/api/billing/webhook`, buy with card `4242 4242 4242 4242`, and confirm the dashboard says "Pro".

## Open questions

- **Apex domains (`yourco.com`).** Cloudflare only supports them on Enterprise. v1 offers subdomains (`share.yourco.com`).
- **Team plan.** Pro is per person. Team billing is per workspace (one Stripe subscription with a seat count), planned in phase 8.
- **WorkOS on Workers.** Phase 3 starts with a short spike: does AuthKit's flow work from the Worker with plain `fetch`, and does WorkOS hand back the GitHub id so old accounts link automatically? If not, accounts link by verified email.
