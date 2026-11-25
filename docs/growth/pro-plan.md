# Aired Pro: what to charge, what's paid, what you decide

*2026-11-25. The build plan is `.forge/blueprints/pro-plan.md`. Sources are in [research/pro-plan-billing.md](research/pro-plan-billing.md), [research/pro-plan-signin-agents.md](research/pro-plan-signin-agents.md) and [research/pro-plan-paywalls.md](research/pro-plan-paywalls.md).*

## The answer

| | |
|---|---|
| **Price** | **$9/month billed yearly ($108), or $12 monthly.** One plan. |
| **Trial** | None. Free is the trial. 14-day full refund instead. |
| **What people pay for** | Their name on the work: no badge, their own domain, who opened it. |
| **Status** | Decided 2026-11-25. Phases 1 and 2 are built; Phase 1 passed a real Stripe sandbox checkout. |
| **What stays free** | Publishing, viewing, PIN, read limits, expiry, permanent pages, the dashboard, CLI, MCP and API keys. |
| **First thing to build** | Checkout + webhook + "no badge, 10 MB, 500 publishes a day". About 2–3 days. |
| **How to get paid** | **Stripe with Managed Payments** (decided): Link, Stripe's checkout, is the seller and handles tax. Checkout for paying, the customer portal for cancelling and switching plans. |

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

1. **Billing: Stripe with Managed Payments.** Link, Stripe's checkout, is the merchant of record: it collects and files sales tax, VAT and GST, so you don't register anywhere. It costs a Managed Payments fee on top of Stripe's usual fees. Customers see "Sold through Link", their local currency, tax as its own line, and Link on their receipt and card statement. Your account already has it on (you picked "Let us handle it" in Stripe onboarding). Stripe Tax is not used.
2. **Price: $9/month billed yearly ($108), or $12 monthly.**
3. **API keys are free.**
4. **Refunds: 14 days, full, no questions.** Issued by hand in the Stripe dashboard. **To refund the unused part** (an account you close for something other than serious abuse, a change that removes something they pay for, or a terms change they reject): in Stripe, open the subscription → **Cancel subscription → Immediately → Refund prorated amount**. That cancels it, so `customer.subscription.deleted` ends Pro. A prorated refund is partial, so refunding from the payment page instead would leave Pro on. **Until the refund handling on this branch is deployed: refund the payment and cancel the subscription immediately** (Subscriptions → Cancel → Immediately). After it's deployed, a dispute or an early fraud warning always cancels the subscription and ends Pro automatically. A full refund ends Pro only when it refunds the payment for the current period and nothing else pays for that period: refunding a duplicate charge, or an earlier month while the current one is paid, keeps Pro. A partial refund never ends it.
5. **When Pro lapses:** pages stay up, the badge returns, and the custom domain redirects to aired.sh links for 30 days, then disconnects.
6. **Sign-in: WorkOS AuthKit** replaces GitHub-only login. Free up to 1M monthly active users. GitHub stays as one button; your existing accounts keep their ids and pages.
7. **One database.** The D1 database added for billing also holds workspaces, roles, groups and the audit log later.
8. **Tax setup.** Tax category **SaaS, business use** (`txcd_10103001`) on Aired Pro, and **tax-exclusive** prices (`tax_behavior=exclusive`): tax is added on top of $12 / $108 at checkout. The pricing page, terms and refund drafts say "plus tax where applicable". Already set in the sandbox.
9. **New update token on claim.** When a page is added to an account, it gets a new update token and the old one (in claim links, CLI output, transcripts) stops working. The CLI stores the new one; the dashboard and claim link manage the page through the sign-in. Claimed pages are recorded in the D1 database, so this holds even when Cloudflare KV serves an old copy of the page.
10. **Early fraud warnings are refunded automatically** (decided 2026-11-25). The warning ends Pro and refunds the charge in full, once (idempotent), unless it's already refunded or disputed, and only for a Pro charge. The refund uses reason "fraudulent", which adds the card and email to Radar's block lists: if a customer says a flag was a mistake, remove them under Radar → Lists before they buy again. If the key lacks Refunds write (log `billing_efw_refund_not_permitted`) or Stripe refuses the refund for good (log `billing_efw_refund_refused`, for example a charge too old to refund), the log names the charge and it needs a manual refund.
11. **Page PINs are stored hashed** (decided 2026-11-25): PBKDF2-SHA256, a salt per page, 20,000 iterations (to fit the free plan's CPU time; raise it if you move to Workers Paid). Old pages' PINs become hashes the first time someone enters them correctly. The PIN cookie is a signed token, not the PIN. PIN guesses are limited to 10 a minute per page and visitor (IPv6 counted by /64) and 60 a minute per page, and 30 wrong PINs in 15 minutes (counted in D1 across all locations) locks PIN entry on that page (people who already entered it aren't affected).
12. **Fonts are self-hosted** (decided 2026-11-25): Inter and JetBrains Mono (latin, variable, from Google Fonts, SIL Open Font License) live in `apps/web/fonts/`, cached for a year by file name. No page asks Google for anything, and the privacy draft no longer mentions Google Fonts.

## Still yours to decide

- **Stripe can refund without you.** As the seller, Stripe may refund a payment within 60 days, for example to settle a complaint. It asks your support email first; if nobody answers within 48 hours, it may refund anyway. A refund of the current period's payment also ends Pro automatically, the same as one you issue.

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

- **Pages claimed before token rotation ships.** Claiming now gives a page a new token (decided and built, see Decided 9). Pages claimed earlier keep their original token, which may still sit in old claim links and transcripts. A one-off sweep could rotate them, but it can't tell them apart from pages published while signed in, whose token a CI job or agent may use. Recommended: leave them, unless a leak is reported.
- **Legal pages (drafts at /terms, /privacy, /refunds, noindex, with the draft banner).** The legal review of 2026-11-25 is applied: entity M&S CapitalSoft LLC (Casper, Wyoming), Wyoming law, Natrona County / D. Wyo. with 30 days' notice before claims, minimum age 16 (adults buy Pro), liability cap of the greater of 12 months of Pro or $50, dashboard and email notice of changes, support@aired.sh, copyright complaints, auto-renewal and dispute terms, data transfers, and the narrower promises. Left for you: approve going live (then remove the banner and noindex, set "Last updated", and link the pages next to the buy button), and register a DMCA agent with the US Copyright Office ($6). Fraud refunds, hashed PINs and self-hosted fonts are now built (Decided 10 to 12). For an attorney: each provider's Data Privacy Framework status, whether EU or UK representatives are needed (GDPR Art. 27, DSA), the DMCA registration, and the liability clause.

## Set up (only you can)

| When | What |
|---|---|
| Before phase 1 goes live | Everything in the Stripe checklist below |
| Done 2026-11-25 | **Support email** `support@aired.sh` via Cloudflare Email Routing, set as Stripe's support email. Managed Payments sends refund requests there and refunds on its own after 48 hours without an answer. |
| Before phase 1 goes live | Terms, refund and privacy drafts filled in and taken out of draft (the list above) |
| Before the next deploy of this branch | `wrangler d1 create aired`, paste the id into `apps/worker/wrangler.toml` (a placeholder today, so `wrangler deploy` fails until it's replaced), then deploy with `npm run deploy` in `apps/worker`, which now applies the D1 migrations (0001–0005) before deploying. Updating or deleting any page now reads D1, so the database must exist and be migrated before this branch is live. The deploy also starts a Cron Trigger every 5 minutes that deletes expired pages' files from R2 (a file goes after its page has been gone for at least a day, seen twice); watch the `expired_sweep_pass_done` log, and raise the batch size if a pass ever takes more than about 14 days |
| Before deploying phases 3–5 (branch `claude/api-keys-mcp`) | Nothing to switch on. `npm run deploy` applies migrations 0006 (API keys) and 0007 (sign-in tables); both only add tables and one empty column. Sign-in stays GitHub until the WorkOS secrets below are set. First run `wrangler d1 execute aired --remote --command "SELECT * FROM sqlite_sequence WHERE name='users'"` and check `seq` is at least 999999999999, so new accounts get ids from 10^12. |
| To try WorkOS locally | Put the staging API key (`sk_test_…`) in `apps/worker/.dev.vars` as `WORKOS_API_KEY`, next to `WORKOS_CLIENT_ID` (see `.dev.vars.example`). Never in a committed file. |
| Before turning WorkOS on in production | See the WorkOS checklist below. |
| Before phase 6 | Cloudflare API token that can read Analytics Engine |
| Before phase 7 | Cloudflare for SaaS on aired.sh (100 hostnames free, then $0.10 each) and the content-domain routing from `.forge/blueprints/content-domain.md` |

### WorkOS checklist (staging first, then production)

Sign-in switches to WorkOS only when both `WORKOS_CLIENT_ID` and `WORKOS_API_KEY` are set. Until then every "Log in" goes to GitHub as today. To turn it off again, delete either secret.

| # | Where | What |
|---|---|---|
| 1 | WorkOS → Authentication | Magic Auth on, Email + Password off. Google, GitHub, Microsoft and Apple with **aired's own** OAuth apps in production (the demo credentials are staging only). |
| 2 | WorkOS → GitHub connection | **Return the GitHub OAuth token.** aired reads the GitHub id with it to find a GitHub-era account. Without it every "Continue with GitHub" fails with a "GitHub unavailable" message rather than risk making a second account. Check it once in staging: sign in with GitHub and confirm you land on your existing account. |
| 3 | WorkOS → Redirects | Add `https://aired.sh/auth/workos/callback` (staging already has the localhost ones). |
| 4 | Terminal | `node apps/worker/scripts/link-report.mjs --remote` (read-only) to see how many accounts will link by email and how many only through GitHub. It prints counts and ids, never emails. |
| 5 | Terminal | `wrangler secret put WORKOS_API_KEY` (production `sk_live_…`), then `wrangler secret put WORKOS_CLIENT_ID`. Sign-in switches over on the next request; no deploy needed. |
| 6 | Site copy | Once it's on: "Sign in with GitHub" on the home page, claim page, `/html-to-link` and terms becomes "Sign in"; the privacy page names WorkOS as the sign-in provider and says what it receives (email, name). |

### Stripe checklist (a sandbox first, then the same in live mode)

Use a separate Stripe **sandbox** for each environment (local, staging), not the shared test mode, so test customers and webhooks don't mix.


| # | Where in Stripe | What |
|---|---|---|
| 1 | Product catalog → Add product | **Aired Pro**, two recurring prices: **$12.00 USD monthly** and **$108.00 USD yearly**. **Required: set the product tax code to `txcd_10103001`** (SaaS, business use); without it every checkout fails with a 400 ("product tax code is missing … required for Managed Payments"). **Set `tax_behavior` to `exclusive` on both prices when you create them**: Stripe won't let you change it once a price has it, so a wrong value means making new prices. Copy both `price_…` ids. |
| 2 | Developers → Webhooks → Add endpoint | URL `https://aired.sh/api/billing/webhook`. Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`, `radar.early_fraud_warning.created`. Copy the signing secret (`whsec_…`). |
| 3 | Developers → API keys → Create restricted key (or edit the one you made earlier: it needs the new permissions before this version is deployed, or refund events fail for 3 days and are then dropped) | Permissions: Checkout Sessions **write**, Customer portal **write**, Customers **write**, Subscriptions **write** (cancels after a refund, dispute or fraud warning), Invoices **read** (and Invoice Payments read, if the Dashboard lists it separately), Charges **read**, **Refunds write** (new: refunds a charge that gets an early fraud warning; without it those refunds fail and you'd have to refund by hand). Nothing else. Copy the `rk_…` key. The Worker refuses `sk_` keys. **Add Refunds write to the live key before this version is deployed.** |
| 4 | Settings → Billing → Customer portal | Allow cancel (at the end of the period), switching between the two Pro prices, updating the payment method and seeing invoices. Default return link `https://aired.sh/dashboard`. |
| 5 | Settings → Billing → Subscriptions and emails | Turn on Smart Retries and the failed-payment emails, and set "cancel the subscription" when retries run out. |
| 6 | Settings → Business → Public details | Support email: the real address from Set up. Managed Payments sends refund requests there. No tax registrations are needed: Link files tax as the seller. |
| 7 | Terminal | `wrangler secret put STRIPE_SECRET_KEY` (the `rk_…` key), `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`, then set `STRIPE_MANAGED_PAYMENTS=1` and `BILLING_ENABLED=1` and deploy. Leave `STRIPE_AUTOMATIC_TAX` unset. |
| 8 | Later, if you ever change the price | Create the new prices, put the **old** price ids in `STRIPE_LEGACY_PRICE_IDS` (comma-separated) **before** switching `STRIPE_PRICE_MONTHLY`/`YEARLY`, so existing subscribers stay Pro. |

Check in the sandbox before live (Stripe CLI 1.55+ won't run `stripe listen` without `--events`):

```bash
stripe listen --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed,charge.refunded,charge.dispute.created,radar.early_fraud_warning.created --forward-to localhost:8787/api/billing/webhook
```

Buy with card `4242 4242 4242 4242` and confirm the dashboard says "Pro". **Done once on 2026-11-25:** checkout, the three webhooks, the dashboard ("Pro · renews 25 Nov 2027") and the portal all worked under Managed Payments. **Not yet tried:** a refund, a dispute and switching monthly↔yearly in the portal; try those in the sandbox before live.

## Open questions

- **Stripe API version.** The code pins `2025-03-31.basil`, but sandbox events already arrive as `2026-11-18.endive`. That works because aired re-fetches every object from Stripe instead of trusting the event. Moving the pin to endive is a follow-up, with its own sandbox run of refunds, disputes and plan switches.

- **Apex domains (`yourco.com`).** Cloudflare only supports them on Enterprise. v1 offers subdomains (`share.yourco.com`).
- **Team plan.** Pro is per person. Team billing is per workspace (one Stripe subscription with a seat count), planned in phase 8.
- **WorkOS on Workers.** Built with plain `fetch` and tested against a stand-in for WorkOS; not yet run against the real staging environment, which needs the staging API key. GitHub-era accounts link by GitHub id (WorkOS checklist, step 2) or by verified email; an email held by two accounts, an unverified one or a GitHub noreply address never links.
