# Paywall gates: trials, domains, badges, lapse, refunds, claiming (read 2026-11-25)

*Research notes for [../pro-plan.md](../pro-plan.md), read from public pages on 2026-11-25. No accounts were created.*

This fills the gaps left by `competitor-pricing.md` (2026-11-21) and `team-pricing-comparison.md` (2026-11-23). It does not repeat their price tables. Public pages only, read with `wit read` / `wit search`. Bracketed keys like [T1] point to the source list at the bottom. "unverified" means I could not find it on a primary page.

**Changes since the earlier notes**
- Carrd now has three Pro plans: Lite $9/yr, Standard $19/yr and Plus $49/yr. Password protection is Plus only [C2].
- Vercel Drop has worked without an account since 2026-10-19. Those deploys expire after 1 hour [V6].
- Netlify CLI added `--allow-anonymous` on 2026-03-31 [N11].
- Tiiny's top plan is now Pro Max ($89/mo or $888/yr) [T2].

---

## 1. Free trial

| Product | Trial? | Length | Card? | Notes |
|---|---|---|---|---|
| Tiiny Host | Only for some accounts, shown as a dashboard pop-up and banner | 7 days, Solo or Pro | **Yes**, then it auto-converts to paid | One per email. Pro trial needs a work email. **No custom domains during the trial** [T1] |
| Netlify | No ("We do not have a free trial") | | | The free plan stands in for a trial [N1] |
| Vercel | Yes, Pro trial | 14 days or until the usage caps, whichever is first; $20 credit | **No**. Without a card it falls back to Hobby | One per user. Free first-year domain excluded [V1] |
| static.app | Yes, and it is the only free tier | 7 days, 1 site on a static subdomain | unverified | "After the trial, publishing needs a paid plan" [S3] |
| Carrd | Yes, a subset of Pro | 7 days | **No** ("no payment or credit card information required") | Includes custom domain and no branding [C1] |
| Glitch | none found (unverified) | | | Hosting shut down (see §5) |
| htmltourl | No. A free 1-hour guest link instead | | | Paid one-time extensions of 30, 90 or 365 days [H2] |
| Gamma | none found (unverified) | | | Free plan gives 400 one-time credits (earlier notes) |
| Claude / ChatGPT Sites | n/a | | | Sites is not on ChatGPT Free or Go [OA1] |

## 2. Annual discount

| Product | Discount | Detail |
|---|---|---|
| Tiiny Host | Labelled "2 months free", but the real discount is **18–44%** | Tiny $9 → $5 (44%), Solo $18 → $13 (28%), Pro $38 → $31 (18%), Pro Max $89 → $74 (17%) [T2] |
| Netlify | **None**. Personal and Pro are "Billed monthly" | Enterprise is billed annually [N2] |
| Vercel | **None**. "Only monthly payments are supported" | Annual billing only on Enterprise [V2] |
| static.app | "2 months free" (17%) | $60 / $120 / $180 per year [S1] |
| Carrd | Yearly only | $9 / $19 / $49 per year [C2] |
| Glitch (historical) | 20% | $10/mo or $96/yr [G2] |
| htmltourl | Regular yearly price unverified | A Black Friday banner offers "30% off yearly, 10% off monthly for 3 months" [H2] |
| Gamma | "Save up to 28%" | Plus $12 → $9 (25%), Pro $25 → $18 (28%) [GA6] |

## 3. Custom domains

| Product | Plan / count | How you connect | Apex? | SSL | Sells domains? |
|---|---|---|---|---|---|
| Tiiny Host | Solo+ (5 / Pro 15 / Pro Max 25). Not during the trial | Automatic DNS via **Entri** (log in to your registrar and approve) or manual records. CNAME to target | **Partial.** Tiiny serves `www` (or another subdomain) and redirects the bare domain; A record `@` → 18.168.91.127 | AWS certificate, confirmed with a DNS record. You cannot bring your own | Yes, Solo+, card only, non-refundable, counts toward the limit, contact email must be verified within 15 days [T3][T4][T5][T6] |
| Netlify | **Free plan includes it** | Netlify DNS (recommended), or external: ALIAS/flattening to `apex-loadbalancer.netlify.com` or A 75.2.60.5, plus `www` CNAME → `site.netlify.app` | Yes (Netlify recommends making `www` primary on external DNS) | Automatic | Yes [N2][N3] |
| Vercel | **Hobby includes it**, 50 per project | Apex: A record. Subdomain: per-project CNAME. Or Vercel nameservers. A TXT record proves access if another account uses the domain | Yes (it suggests adding `www`) | Automatic, wildcards via NS delegation | Yes. Paid Pro gets a free first-year domain [V3][V1] |
| static.app | Starter ($5/mo yearly) and up: "Free & Custom Domains" | Settings → Domains. DNS guides for Cloudflare and Wix. Record types unverified | unverified | Auto-issued, no renewals | unverified [S1][S3] |
| Carrd | Pro Standard ($19/yr) and up, plus the trial | Two A records on `@` and a CNAME `www` → bare domain. The unused form auto-redirects | **Yes** | Let's Encrypt, usually within an hour | No (unverified) [C2][C3] |
| htmltourl | **No custom domains.** Paid plans get a custom `*.htmltourl.app` label | | | | [H1] |
| Gamma | Pro and up, **10 domains** (Ultra 100). No add-ons; pending and failed domains count toward the cap | "Automatic Setup (recommended)" or manual: two A records (3.136.232.26, 3.137.108.170) plus `www` CNAME → `sites.gamma.app`. Subdomain: one CNAME | Yes | Issued after verification, up to 24 h | Yes ("How do I buy a custom domain") [GA1][GA2] |
| ChatGPT Sites | Plans that have Sites (Plus and up). Not on Enterprise at launch | DNS records plus a verification TXT | Yes ("apex domain or subdomain") | implied | **No** ("does not register a domain for you") [OA1][OA2] |
| Claude Artifacts | No custom domain option documented (unverified) | | | | [CL1] |

## 4. Badge / branding removal

| Product | Plan that removes it | Own logo instead? |
|---|---|---|
| Tiiny Host | **Any paid plan** (Tiny, $5 yearly / $9 monthly). "There's no other way to switch it off." Trial pages ship without the bar too [T7] | No logo in the bar. You can change the favicon/"project logo" (64×64) and the share preview image; the docs name no plan [T8] |
| Netlify / Vercel | No badge on any plan | n/a |
| static.app | No badge documented (unverified) | n/a |
| Carrd | **Pro Lite ($9/yr)** removes "Made with Carrd" | No replacement badge. Site icons and share images are on all Pro plans [C2] |
| htmltourl | **Starter ($9/mo)** removes HTMLtoURL branding [H1] | No |
| Gamma | **Plus** removes the "Made with Gamma" badge from shared and exported content [GA1] | **Pro** adds headers and footers plus "custom branding" [GA1][GA6] |
| Claude / ChatGPT Sites | No badge documented (unverified) | n/a |

## 5. When a subscription lapses

| Product | What happens |
|---|---|
| Tiiny Host | **Harshest.** After cancelling, projects stay live to the end of the period, then the **account and projects are deleted permanently**. There is no downgrade to free: you sign up again and re-upload. Backups are kept 90 days but are restored only if you resubscribe. **Failed payment:** retries, then the account is suspended and pages show a "suspended" notice. You have 30 days to pay and get everything back, then everything is deleted, custom domain settings included. Domains bought through Tiiny stop renewing. Cancelling a trial drops you to free and archives projects the free plan can't hold. The cancel flow offers a 1–3 month pause, during which projects are archived [T9][T10][T12][T16][T17][T1] |
| Netlify | Downgrade schedules for the end of the cycle [N1]. Running out of credits pauses **every** project on the team, and visitors see "Site not available" [N1]. What happens to a custom domain after a paid plan lapses is unverified, but Free includes custom domains, so it probably stays |
| Vercel | A renewal must be paid within **14 days** or "all deployments on your account will be paused" [V2]. When a trial ends without a card, the team reverts to Hobby: members are removed and over-limit projects are paused. Upgrading restores them [V1] |
| static.app | "Your website remains live until the pre-paid period ends; you'll lose paid-only features once your plan expires." After the trial, publishing requires a paid plan [S1][S3] |
| Carrd | unverified. Auto-renew is optional (pay as you go), and a plan simply ends unless you renew [C5][C6]. You can't downgrade until you remove features the lower plan lacks, such as custom domains or forms [C5] |
| htmltourl | Paid URLs are "Online while subscribed". When coverage ends, URLs outside the allowance lose edit access and paid features, get a **7-day grace period**, then enter recovery. Fixed-term content is kept up to 60 days. Paid URLs never become permanent free URLs [H1][H3] |
| Gamma | The plan stays active to the end of the period. After a downgrade, "features not included in your new plan will no longer be available. **Your content is not deleted.**" Cancel at least 30 days before renewal to avoid the next charge. What happens to the domain and badge after a lapse is unverified [GA4][GA5] |
| Glitch | Project hosting and profiles shut down on **2025-07-08**. New Pro sales stopped at the announcement, existing Pro was honoured until shutdown, and unused time was refunded. Subdomain redirects were promised through at least the end of 2026. Dashboards were open for code download until early 2026 [G1][G3]. Pro ("Boost") was $10/mo: up to 5 boosted apps, always-on, private projects [G2] |
| PageDrop | Winding down. New sales ended, Creator Passes could be redeemed until 2026-10-31, and unused uses expire without refund. Pages stay up until their stated expiry [P1] |
| Claude Artifacts | On Team and Enterprise, turning off external sharing breaks existing public links (earlier notes, [CL1]). What happens when a Pro plan lapses is unverified |

## 6. Refund policy

| Product | Policy |
|---|---|
| Tiiny Host | **7-day money-back, any reason**, counted from the upgrade (or from the first charge after a trial). Self-serve form at `/manage/refund`. **An approved refund closes the plan and permanently deletes the account and projects.** Domain purchases are non-refundable [T11][T6] |
| Netlify | The Self-Serve Agreement says fees are non-refundable (§5.2). Support has still refunded case by case, for example a Pro charge used for one day after the trial. Upgrades get a prorated refund of the old plan [N4][N1] |
| Vercel | No refund policy on the docs I read. "Refunds are not provided" when paying with the wrong card [V2]. Community threads show prorated credits on downgrade and broken refund forms (unverified) |
| static.app | **14 days** from purchase, framed around malfunctions [S2] |
| Carrd | Not required to refund "for any reason". The prorated credit from a downgrade may be refunded at Carrd's discretion [C4] |
| htmltourl | Non-refundable unless the law or the checkout says otherwise. Chargebacks remove the entitlement [H3] |
| Gamma | **3 days**, and only below a credit-usage threshold (Plus under 300 credits, Pro under 600). No refund or proration on downgrade [GA3][GA5] |

## 7. Claiming anonymous work

| Product | No-account path | Window | Proof to claim | If the link is lost |
|---|---|---|---|---|
| **Netlify Drop** (browser) | Drag a folder with no login. The site is **password-protected until claimed** (since 2024) | **1 hour** (24 h until 2022). 3 anonymous sites per IP | Being in the **same browser session**, then log in or sign up | No self-serve recovery. One user who "lost the original browser session/tab" had to ask the forum to release the name [N8]. Staff: "those websites are gone after an hour" [N9]. Unclaimed sites are suspended, then deleted a week later [N5][N7] |
| Netlify CLI | `netlify deploy --allow-anonymous`. No functions | 1 hour | Log in or create an account | unverified [N6][N11] |
| Netlify partners / agents | The partner deploys into **its own** account and mints a JWT claim URL. An optional `claim_webhook` fires on claim | Unclaimed sites stay in the partner's account | Possession of the claim URL | The partner can mint a new one [N10] |
| **Vercel Drop** / `vercel deploy --temporary` | Static sites only in the browser. The CLI builds frameworks locally | **1 hour** for Drop (the CLI timer is set by the server) | **The claim URL is a bearer token** ("anyone with it can claim the project"). Log in or sign up, pick a team, Transfer, accept the terms | The link appears only on the success page in the browser you used, or in CLI output. **After expiry it can't be claimed**; you redeploy with an account [V4][V5][V6] |
| Vercel platform claim | `POST /projects/:id/transfer-request` returns a code **valid 24 h**. Then `vercel.com/claim-deployment?code=…&returnUrl=…`. Neon, Supabase and Prisma resources move with the project | 24 h code | URL possession plus a Vercel login | Generate a new code [V4][V7] |
| Tiiny Host | The free plan needs an email sign-up. API: `x-email` header, a ~1-hour preview, and a new upload replaces the earlier preview for that address. Signing in uses a 4-character emailed code that returns an API key | ~1 hour | **Email ownership** | unverified [T13][BH] |
| htmltourl | Guest link, no signup | 1 hour, then 30 days in which it can be restored or extended | A specific "ownership and promotion flow". An account does **not** auto-claim URLs made in the same browser | Paid one-time extension (30, 90 or 365 days) on the same URL [H2][H3] |
| PageDrop | No signup, TTL set at upload | Paid TTL extensions (now ended). Likes extend a page's life | n/a | n/a [P1] |
| Cloudflare (third-party report) | `wrangler deploy --temporary` / Cloudflare Drop | Deleted after 60 min unless claimed | unverified | unverified [BH] |
| Carrd, Gamma, Claude, ChatGPT Sites, static.app | No anonymous publishing. An account comes first. Claude Free can't share by link at all [CL1] | | | |

## 8. Where the upgrade prompt appears

| Product | Placement (documented) |
|---|---|
| Tiiny Host | A trial **pop-up on dashboard login, sometimes one "you can't close"**, plus a banner [T1]. The free-page branding bar works as the ad [T7]. The cancel flow offers a 1–3 month pause first, then a cheaper plan [T12][T1]. Suspended pages ask the visitor's owner to re-subscribe [T10] |
| Netlify | **Email and in-app alerts at 50%, 75%, 90% and 100%** of credits. When credits run out, visitors see a "Site not available" page [N1] |
| Vercel | The Drop success page shows a **live countdown and a "Claim Project" button**. The CLI prints "Claim it to keep it live (don't share this link)". Dropping a framework project triggers a sign-up wall [V5]. A trial is offered when you create a team [V1] |
| Gamma | Free users get an **upgrade banner where the Billing tab would be** [GA4]. The downgrade modal **lists the benefits you'll lose** [GA5]. The main gates are credits running out and the badge |
| htmltourl | When a guest link expires, the prompt is a one-time extension purchase or a subscription. Countdown deal banners [H2] |
| Carrd | A "Start Pro Trial" CTA on the /pro page and docs [C1]. In-builder placement unverified |
| Claude / ChatGPT | Link sharing is missing on Claude Free [CL1]. Sites is missing on ChatGPT Free and Go [OA1]. Exact UI placement unverified |

---

## Patterns that matter for Aired Pro (one price, ~$9–12/mo)

- **Removing the badge is the cheapest gate everywhere, and nobody lets you put your own logo in it at that price.** Tiiny (any paid plan, $5–9), Carrd ($9/yr), htmltourl ($9) and Gamma Plus ($9–12) all sell plain removal. A custom logo or "custom branding" starts at Gamma Pro ($18–25). Aired Pro should sell "no badge". A custom badge or logo can wait for Team.
- **A custom domain at $9–12 would undercut the field.** It costs Tiiny Solo $13/$18, Gamma Pro $18/$25 and ChatGPT Plus $20, while Netlify and Vercel include it free (and so define the setup norm). The norm is a CNAME for subdomains, A records for the apex, and automatic SSL. Tiiny and Gamma also offer Entri-style automatic DNS. Tiiny only half-supports apex domains (it serves `www` and redirects the bare domain). Gamma counts failed domains toward the cap, which creates support load. Aired should support the apex and let a failed domain be removed.
- **Lapse policy is where trust is won or lost.** At one end, Tiiny deletes the account and pages at the end of the period, and even a refund triggers deletion; htmltourl takes pages offline after a 7-day grace. At the other end, Gamma keeps content and only switches features off, and Netlify and Vercel fall back to their free tiers. Aired's free tier is permanent, so the consistent rule is: on lapse, pages stay up, the badge returns, and the custom domain detaches after a short grace (Tiiny's 30-day suspension window and htmltourl's 7-day grace bracket it).
- **Claim windows are short and the claim link is the only proof.** Netlify Drop, Vercel Drop and htmltourl all give 1 hour, and a lost tab means the work is gone (see the Netlify forum post). Nobody offers email-based recovery except Tiiny's email-keyed previews. Aired keeps anonymous pages up permanently with a badge, so "claim" is not urgent. It can be tied to the CLI/MCP token plus an optional email, with recovery by email. That is a real difference from the competition.
- **Use a refund promise instead of a trial.** Trials split into card-required (Tiiny, selective, and without custom domains) and no-card (Vercel 14 days, Carrd 7 days). Refunds range from none (Netlify on paper, Carrd, htmltourl) through 3 days with usage caps (Gamma) and 14 days (static.app) to 7 days for any reason (Tiiny). Aired's free tier already works as a permanent trial, so a non-destructive 7–14-day refund beats a trial. Never copy Tiiny's "refund deletes everything".
- **Annual discount: use about 25%, not "2 months free".** static.app (17%) and Glitch (20%) are mild. Gamma (25–28%) and Tiiny (18–44%; its "2 months free" label understates the cheap tiers) go deeper. Netlify and Vercel offer no annual plan. **$12 monthly / $9 yearly** matches Gamma Plus exactly and stays in the $9–12 band.
- **Put the paywall at the moment of value, not in a pricing-page maze.** Examples: Vercel's countdown and Claim button on the success page, Netlify's 50/75/90/100% usage emails, Gamma's "benefits you'll lose" downgrade modal, and Tiiny's pause-before-cancel offer. Tiiny's un-closable trial pop-up is the version to avoid. For Aired, the natural spots are the publish result in CLI/MCP output ("live at … — remove badge / add domain with Pro"), an owner-only hover on the badge, and a pause option in the cancel flow.

---

## Sources
- [T1] https://helpdesk.tiiny.host/en/article/does-tiiny-host-offer-a-free-trial-1co7lv4/
- [T2] https://helpdesk.tiiny.host/en/article/pricing-plans-1i3vkky/
- [T3] https://helpdesk.tiiny.host/en/article/how-to-connect-a-domain-you-already-own-1sfq7hh/
- [T4] https://helpdesk.tiiny.host/en/article/common-custom-domain-problems-axztwk/
- [T5] https://helpdesk.tiiny.host/en/article/do-you-provide-ssl-certificates-2rbpwf/
- [T6] https://helpdesk.tiiny.host/en/article/how-to-buy-a-domain-through-tiiny-host-tzyl67/
- [T7] https://helpdesk.tiiny.host/en/article/how-to-remove-the-tiiny-host-branding-bar-i5io46/
- [T8] https://helpdesk.tiiny.host/en/article/how-to-change-your-projects-logo-g9xmf6/
- [T9] https://helpdesk.tiiny.host/en/article/how-to-cancel-your-subscription-a6zag/
- [T10] https://helpdesk.tiiny.host/en/article/what-to-do-if-your-payment-fails-1x29pwm/
- [T11] https://helpdesk.tiiny.host/en/article/refunds-and-our-7-day-money-back-guarantee-ghtpu0/
- [T12] https://helpdesk.tiiny.host/en/article/how-to-pause-your-subscription-1iad111/
- [T13] https://tiiny.host/docs/guides/email-previews/
- [T16] https://helpdesk.tiiny.host/en/article/why-has-my-project-been-deleted-1pjvdkr/
- [T17] https://helpdesk.tiiny.host/en/article/how-to-switch-to-a-free-account-zsn46j/
- [N1] https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/
- [N2] https://www.netlify.com/pricing/
- [N3] https://docs.netlify.com/manage/domains/get-started-with-domains/
- [N4] https://answers.netlify.com/t/how-to-get-a-refund/119846
- [N5] https://docs.netlify.com/start/quickstarts/netlify-drop-quickstart/
- [N6] https://docs.netlify.com/start/quickstarts/deploy-from-ai-code-generation-tool/
- [N7] https://www.netlify.com/blog/thirteen-years-of-netlify-drop
- [N8] https://answers.netlify.com/t/requesting-release-of-unclaimed-site-name-parn-mike-wedding/169785
- [N9] https://answers.netlify.com/t/how-do-i-restore-my-uploaded-website-for-one-hour/89433
- [N10] https://answers.netlify.com/t/claimable-sites-limit/144390 and https://www.netlify.com/changelog/site-claiming-webhook-support/
- [N11] https://www.netlify.com/changelog/2026-03-27-create-and-deploy-anything-netlify-clis-improved-ax/
- [V1] https://vercel.com/docs/plans/pro-plan/trials
- [V2] https://vercel.com/docs/plans/pro-plan/billing
- [V3] https://vercel.com/docs/domains/working-with-domains/add-a-domain
- [V4] https://vercel.com/docs/deployments/claim-deployments
- [V5] https://vercel.com/docs/deployments/deploy-without-logging-in
- [V6] https://vercel.com/changelog/deploy-with-vercel-drop-without-an-account
- [V7] https://vercel.com/changelog/claim-deployments
- [S1] https://static.app/pricing · [S2] https://help.static.app/article/48-can-i-request-a-refund · [S3] https://static.app/help
- [C1] https://carrd.co/docs/pro/trial · [C2] https://carrd.co/docs/pro/plans · [C3] https://carrd.com/docs/sites/using-a-custom-domain and https://carrd.com/docs/sites/troubleshooting
- [C4] https://carrd.com/docs/general/terms · [C5] https://carrd.com/docs/pro/changing and https://carrd.co/docs/pro/troubleshooting · [C6] https://carrd.com/docs/pro/auto-renewing
- [G1] https://blog.glitch.com/post/changes-are-coming-to-glitch · [G2] https://help.glitch.com/hc/en-us/articles/16287527364365-Glitch-Pro · [G3] https://blog.glitch.com/post/goodbye-glitch
- [H1] https://htmltourl.com/pricing · [H2] https://htmltourl.com/ · [H3] https://htmltourl.com/terms-of-service
- [GA1] https://help.gamma.app/en/articles/8077107-how-can-i-upgrade-my-gamma-subscription
- [GA2] https://help.gamma.app/en/articles/17683486-how-do-i-connect-and-troubleshoot-a-custom-domain
- [GA3] https://help.gamma.app/en/articles/11048496-what-is-gamma-s-refund-policy-and-how-do-i-request-a-refund
- [GA4] https://help.gamma.app/en/articles/8568920-how-do-i-manage-or-cancel-my-gamma-subscription
- [GA5] https://help.gamma.app/en/articles/15197946-how-do-i-downgrade-my-gamma-subscription
- [GA6] https://gamma.app/pricing (as read in team-pricing-comparison.md, 2026-11-23)
- [P1] https://pagedrop.io
- [CL1] https://support.claude.com/en/articles/9547008-share-artifacts
- [OA1] https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites · [OA2] https://learn.chatgpt.com/docs/sites/managing-a-site
- [BH] https://beacon.host/vs/netlify-drop-tiiny-host-surge (third party and a competitor, tested 2026-10-01; secondary)
