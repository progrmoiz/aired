# Aired Pro: what to charge, what's paid, what you decide

*2026-11-25. The build plan is `.forge/blueprints/pro-plan.md`. Sources are in [research/pro-plan-billing.md](research/pro-plan-billing.md), [research/pro-plan-signin-agents.md](research/pro-plan-signin-agents.md) and [research/pro-plan-paywalls.md](research/pro-plan-paywalls.md).*

## The answer

| | |
|---|---|
| **Price** | **$9/month billed yearly ($108), or $12 monthly.** One plan. |
| **Trial** | None. Free is the trial. 14-day full refund instead. |
| **What people pay for** | Their name on the work: no badge, their own domain, who opened it. |
| **What stays free** | Publishing, viewing, PIN, read limits, expiry, permanent pages, the dashboard, CLI, MCP and API keys. |
| **First thing to build** | Checkout + webhook + "no badge, 10 MB, 500 publishes a day". About 2–3 days. |
| **How to get paid** | **Polar** as merchant of record, unless you already have a Stripe account in a Stripe country. Paddle is the fallback. |

## Free vs Pro

| | Free | Pro |
|---|---|---|
| Publish, view, share links | ✓ | ✓ |
| PIN, read limits, expiry, permanent pages | ✓ | ✓ |
| Dashboard, projects, CLI, MCP, HTTP API | ✓ | ✓ |
| API keys for agents and CI | ✓ (5 keys) | ✓ |
| aired badge on pages | Shown | **Off** |
| Page size | 2 MB | **10 MB** |
| Publishes | 30 an hour (signed in) | **500 a day** |
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
4. **Signed-in users finally get their own limit.** Today every publish, signed in or not, shares the anonymous 5-an-hour limit by IP.

## How the money moves

```
Get Pro ─► sign in (Google, GitHub or email link) ─► hosted checkout (Polar)
        ─► Polar tells aired "paid" (signed webhook) ─► aired stores the plan
        ─► the badge disappears from your pages within 5 minutes
Cancel ─► customer portal ─► Pro until the paid period ends ─► badge comes back
          (pages are never deleted)
```

Agents never pay. When one hits a limit, aired returns an upgrade link and the agent passes it to a person.

**Where Pro is offered:** the dashboard plan strip; one line under the URL after a signed-in publish ("Remove the badge with Pro"); locked previews of analytics and the custom domain in the dashboard. Never a pop-up, and never on pages your viewers see.

## Build order

| # | Phase | What people get | Size |
|---|---|---|---|
| 1 | **Take money** | Buy Pro (GitHub sign-in): no badge, 10 MB, 500/day, billing in the dashboard | 2–3 days |
| 2 | Claim pages | Pages published without an account can be added to one; a "remove my page" path for lost links | ½–1 day, can run alongside 1 |
| 3 | Sign in without GitHub | Google and email-link sign-in, CLI login for those accounts | 2–3 days |
| 4 | API keys | Keys for CI and agents, from the dashboard | 1 day |
| 5 | Signed-in MCP | Agents can list, update and delete their own pages; connectors in Claude and ChatGPT | 1½–3 days |
| 6 | Analytics | Views over time, countries, referrers per page | 1–2 days |
| 7 | Custom domain | `share.yourco.com` serves your pages | 2–3 days, after the aired.page move's routing |

Total: about 12–19 working days including review and testing. **Announce Pro widely after phase 3**, so people without GitHub can buy it. Phase 1 can go live quietly before that.

## Decide

Each item has a recommendation; reply with a different choice only if you disagree.

1. **Billing provider.** Recommended: **Polar**.
   - Stripe and Stripe Managed Payments only accept businesses in their supported countries.
   - Lemon Squeezy has stopped taking new sign-ups and shuts down on 31 March 2027.
   - Polar is the seller of record: it charges and files VAT and sales tax worldwide, and it pays out through Stripe Connect Express even where Stripe itself isn't available.
   - It costs about $7.52 on a $108 yearly sale with a non-US card.
   - Fallback: **Paddle** (5% + 50¢, pays by Payoneer or wire, 5–7 day website review).
   - If you already run a Stripe account for another product in a supported country, use Stripe Checkout instead. It's cheaper, but then you register and file taxes yourself.
2. **Is the price $9 / $12?** Recommended: yes, as already shown.
3. **Free API keys?** Recommended: yes (see above).
4. **Refund window.** Recommended: 14 days, full refund, no questions.
5. **The page reported this week (39tPSZbj3x).** Someone says they published it and lost the link. Recommended: remove it now; the new removal path makes this routine.
6. **What a lapsed Pro keeps.** Recommended: pages stay up and the badge returns. The custom domain redirects to aired.sh links for 30 days, then disconnects.

## Set up (only you can)

| When | What |
|---|---|
| Before phase 1 goes live | Polar account (sandbox first), the Pro product with a $12 monthly and a $108 yearly price, a webhook to `https://aired.sh/api/billing/webhook`, the D1 database (`wrangler d1 create aired`), and the secrets |
| Before phase 1 goes live | Refund policy, terms and privacy updated to name the payment processor (Paddle and Polar check for these) |
| Before phase 3 | Google Cloud OAuth client with the `openid email profile` scopes only, and Cloudflare Email Sending on aired.sh for sign-in links |
| Before phase 6 | Cloudflare API token that can read Analytics Engine |
| Before phase 7 | Cloudflare for SaaS on aired.sh (100 hostnames free, then $0.10 each) and the content-domain routing from `.forge/blueprints/content-domain.md` |

## Open questions

- **Polar's user-id field.** Its checkout API takes an external customer id, but the exact field name isn't confirmed. The build checks it first, and matching by email is the fallback.
- **Apex domains (`yourco.com`).** Cloudflare only supports them on Enterprise. v1 offers subdomains (`share.yourco.com`).
- **Team plan.** Pro is per person, so pages stay owned by a person. Team needs pages to belong to a workspace, which is a migration. Do it before Team, not before Pro.
