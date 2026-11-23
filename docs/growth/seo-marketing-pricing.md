# aired: SEO, positioning and pricing

*2026-11-21. Scope: aired.sh's own marketing pages, not user pages.*

## The decisions

1. **Rank for the job, not the jargon.** People don't search "publish HTML artifacts". They search "share html file as link", "how to share claude artifact" and "tiiny host alternative". The homepage and three new guide pages now target those phrases.
2. **Position aired for people who make things with AI, not only for developers.** New one-liner: *aired turns anything your AI makes into a link anyone can open.* Developers still reach the CLI, MCP and API through the docs and the "let your agent publish it" block.
3. **Make money from control, not access.** Publishing, viewing and PINs stay free with no view cap, and the badge stays on. Pro ($9/mo) sells your own domain, no badge, analytics on who viewed, permanent pages without limits, and an API key for CI. Team ($29/mo) sells white-label and seats to agencies.
4. **Free signup is the first conversion, so make it possible for non-developers.** Sign-in is GitHub-only today, which shuts out the audience this plan targets. Add Google sign-in (or an email magic link) before the Pro test.
5. **Test Pro with a checkout or waitlist button before building it.** Build custom domains and analytics only after people pay or join.

---

## 1. Audit findings

Pages checked: `/`, `/docs`, `/abuse`, `/llms.txt`, `/index.md`, `/.well-known/*`, and the live responses on aired.sh.

| # | Finding | Impact | Status |
|---|---|---|---|
| 1 | `sitemap.xml` returns 404. | Google finds new pages slowly. | **Fixed.** Added `apps/web/sitemap.xml` with 5 URLs. |
| 2 | `robots.txt` is only Cloudflare's managed file. It has no `Sitemap:` line and nothing hides `/api`, `/auth`, `/dashboard` or `/mcp`. | Crawl budget goes to endpoints; the sitemap can't be discovered. | **Fixed.** Added `apps/web/robots.txt`. Cloudflare puts its managed block above the origin file, so check the merged output after deploy. |
| 3 | The managed robots blocks training crawlers (GPTBot, ClaudeBot, Google-Extended and others) but allows Googlebot, Bingbot and AI *search* crawlers (OAI-SearchBot, Claude-SearchBot, PerplexityBot). | AI answers can still cite aired. | **Keep as is.** Blocking training doesn't hurt citations. |
| 4 | Title "publish HTML artifacts instantly" and H1 "Air your artifacts." contain no searched phrase. "Artifacts" is jargon for the new audience. | The homepage ranks for little beyond the brand. | **Fixed.** Title: "aired — turn any HTML file into a shareable link". H1: "Turn HTML into a link anyone can open." |
| 5 | No canonical tags; no `og:url`, `og:site_name` or `twitter:title`; `/docs` has no Open Graph tags at all. | Duplicate URLs (`/docs` vs `/docs.html`); weak link previews. | **Fixed** on every marketing page. |
| 6 | No structured data. | No eligibility for rich results; AI answers get less to work with. | **Fixed.** Homepage: Organization, WebSite, SoftwareApplication (free offer) and FAQPage. Guides: WebPage, BreadcrumbList and FAQPage. Google shows FAQ rich results only for government and health sites, so FAQ markup mainly helps Bing and AI answers. |
| 7 | Every internal "Docs" link points to `/docs.html`, which 307-redirects to `/docs`. | A redirect hop on every internal link. | **Fixed.** Links now go to `/docs`. |
| 8 | Only two indexable pages (`/`, `/docs`) and no content for non-technical searches. | Nothing to rank with. | **Partly fixed.** Three guide pages, each linked from the homepage and every footer. More are in the page plan. |
| 9 | The homepage FAQ and use cases didn't exist. | No answers to the questions people ask. | **Fixed.** A visible FAQ that matches the schema, plus use-case cards linking to the guides. |
| 10 | Page speed: the homepage pulls `cobe` from esm.sh (a third-party module plus a 1000×1000 WebGL canvas). On mobile the canvas is only hidden, so the script still loads. Google Fonts loads 3 Inter weights plus 2 mono weights as render-blocking CSS. | Slower LCP, especially on mobile. Not measured with Lighthouse in this pass. | **Open.** Load the globe after `requestIdleCallback` and only above 640px; self-host a subset of Inter 400/500 as woff2 with `preload`; drop Inter 600. |
| 11 | Unknown URLs return a 404 with an empty body. | Lost visits from broken links. | **Open.** Add `apps/web/404.html` and `not_found_handling = "404-page"` under `[assets]`. |
| 12 | `/dashboard` had no noindex. | Minor; the page already redirects. | **Fixed.** `noindex, nofollow` meta. |
| 13 | aired.sh is not verified in Search Console (checked with `gsc sites list`). | No ranking or indexing data at all. | **Open, owner.** Add a Domain property with a DNS TXT record in Cloudflare; also add Bing Webmaster Tools. Submit the sitemap in both. |
| 14 | Signed-in users' pages are indexable on aired.sh. | One spam wave on owned pages and Google can treat the domain as a host of thin third-party content, which drags the marketing pages down with it. | **Open.** This raises the priority of the parked `aired.page` move (`.forge/blueprints/content-domain.md`). Keeping user content off the brand domain protects these rankings. Keep the noindex on anonymous pages. |
| 15 | The "aired" badge on every page links to `https://aired.sh` with no tag, and the OG description it injects still says "publish HTML artifacts instantly". | The biggest growth loop can't be measured. | **Open.** Link to `https://aired.sh/?ref=badge`; change the injected description to "Shared with aired — turn any HTML into a link." (`apps/worker/src/routes/viewer.ts`). |

---

## 2. Keyword research

### Method, and what's missing

- **Autocomplete (done).** `gsug expand / compare / questions` with `--gl us` on 13 seeds returned about 2,380 suggestions. They confirm the phrasing people use: "share html file as link", "html to link converter", "can claude artifacts be shared", "claude artifacts alternative", "tiiny host alternative", "netlify drop alternative", "how to share html from claude".
- **SERP check (done).** I pulled live US Google results on 2026-11-21 for 8 target queries and judged difficulty by who ranks. A page-1 full of Reddit threads, forum answers and small tools is beatable; a page-1 full of established hosts is not.
- **Search volume (not available in this pass).**
  - The Semrush session needs a person to clear a Cloudflare check in its Chrome window.
  - The DataForSEO CLI has only a legacy proxy key, which it ignores by design.
  - The seo-research MCP's volume endpoint returned 403.
  - aired.sh isn't in Search Console.

  So the volumes below are **my estimates (unverified ranges)**. Treat them as relative sizes. Backfill them with `semrush keyword <phrase...>` once the session is logged in.

### Keyword table

| Cluster | Example queries (from autocomplete) | Est. US volume/mo (unverified) | Intent | Difficulty, with SERP evidence | Target page | Priority |
|---|---|---|---|---|---|---|
| **HTML to link** | html to link, html to url, share html file as link, upload html file and get link, how to share html file | 3k–8k combined | Do it now (tool) | **Medium.** #1 EdgeOne (big brand, thin page), #3 Tiiny, #4 htmltourl.com, then Reddit, Codecademy, Microsoft Q&A and an agency blog. One strong tool, the rest forum answers. | `/html-to-link` ✅ | P1 |
| **Share a Claude artifact** | how to share claude artifact, share claude artifact, can claude artifacts be shared, claude artifacts public, how to share html from claude | 1k–3k, rising | Solve a problem | **Easy–medium.** #1 Claude Help Center, then Reddit, send.co, Codecademy, go9x, Stacktree and Medium. Small tools already rank. | `/share-claude-artifacts` ✅ | P1 |
| **Claude artifacts alternative** | claude artifacts alternative (+free, +reddit, +open source), claude artifacts vs chatgpt canvas | 200–700 | Compare | **Easy.** Reddit, totalum, fabricate, Medium and spacesheep. No strong owner. | Section in `/share-claude-artifacts` ✅; own page if that one ranks | P2 |
| **Tiiny Host alternative** | tiiny host alternative(s), tiiny host vs netlify, tiiny host pricing, tiiny host reddit | 200–600 (the brand term "tiiny host" alone is much larger) | Switch / buy | **Easy.** No page on the first results is a real Tiiny alternatives page: techimply, Reddit and generic host lists. | `/tiiny-host-alternative` ✅ | P1 |
| **Share ChatGPT HTML** | how to share chatgpt canvas, share chatgpt html, chatgpt website link | 500–2k | Solve a problem | **Easy.** Reddit #1, then binhtml, Convika, InstaPods, HummingDeck and docklet. All small. | `/share-chatgpt-html` | P1, next |
| **HTML game hosting** | host html game free, share html game, upload html game get link | 500–1.5k | Do it now | **Medium–easy.** Reddit, itch.io docs, fylo.host and PlayFeed. Games are already aired's most-viewed real pages. | `/html-game-hosting` | P2 |
| **Free HTML hosting** | host html file free, free html hosting, publish html online free, host html online | 5k–15k | Do it now / compare | **Hard.** Netlify, GitHub Pages, Tiiny and listicles. | Homepage + `/html-to-link` (secondary) | P2 |
| **Netlify Drop alternative** | netlify drop alternative, netlify drop url | 100–400 | Switch | **Easy.** | Section in `/tiiny-host-alternative` ✅; own page later | P3 |
| **CI and headless publishing** | github actions publish html report, playwright report link, share test report url | 300–1k | Do it now (developer) | **Medium.** GitHub Pages actions and docs. | `/publish-html-from-ci` | P2, pays: API key |
| **Client reports** | share interactive report with client, send html report to client | Low and fuzzy | Buy (agencies) | The SERP for "share interactive html report with client" returned nothing relevant, so there's no search demand to win. | `/client-reports` as a **sales page** for outreach and the paid funnel, not for SEO | P2, pays: Team |
| **Password-protect HTML** | password protect html page | 1k–2k | Do it now | **Medium.** Mostly JavaScript code tutorials. | `/password-protect-html` | P3 |

### Programmatic pages: keep the set small

Build "share [tool] HTML as a link" pages only for tools whose export steps really differ: Claude, ChatGPT, Gemini, v0, Bolt, Lovable, Cursor, Perplexity (at most 8). Start them only after the first three pages are indexed. Each page needs that tool's own export steps and a screenshot, or Google treats the set as thin. Don't generate "[file type] to link" variants; the intent is the same as `/html-to-link`.

---

## 3. Page plan, ranked by intent and difficulty

| Rank | URL | Primary query | Why this rank | Funnel role | Status |
|---|---|---|---|---|---|
| 1 | `/html-to-link` | html to link / share html file as link | Biggest winnable cluster; tool intent matches the embedded form | Volume → anonymous publishes → free signups | **Built** |
| 2 | `/share-claude-artifacts` | how to share claude artifact | Rising demand, small sites rank, a direct wedge against Claude's Share button | AI makers → badge removal, analytics | **Built** |
| 3 | `/tiiny-host-alternative` | tiiny host alternative | Buyer intent, an empty SERP, and Tiiny's $13 Solo plan anchors aired Pro at $9 | Switchers → Pro | **Built** |
| 4 | `/share-chatgpt-html` | how to share chatgpt canvas | Same pattern as #2, an easy SERP | AI makers | Next |
| 5 | `/client-reports` | (sales page) | Agencies are the highest willingness to pay | Team plan | After pricing test |
| 6 | `/publish-html-from-ci` | github actions html report link | The headless wedge Claude can't serve | Pro API key | Month 1 |
| 7 | `/html-game-hosting` | host html game free | Matches the content that already gets the most views | Volume, badge impressions | Month 1 |
| 8 | `/netlify-drop-alternative`, `/password-protect-html` | — | Long tail | Volume | Later |

Every guide page embeds the real publish form, so a searcher can get a link without leaving the page. Each one links to the other guides and to `/docs`, and each is in the sitemap.

---

## 4. Positioning and homepage

### Positioning

| | |
|---|---|
| **Who it's for** | (1) People who make reports, pages and games with Claude, ChatGPT or Gemini and want to send them. (2) Agencies and freelancers sending client reports. (3) Small businesses that need a page up today. Developers and agents remain a core channel through the CLI, MCP and API. |
| **What they do today** | Email the `.html` file (blocked, or shown as code); upload it to Drive (which shows the code); use Claude's Share button (paid plans only, admin limits on Team and Enterprise, no public link for artifacts that load other websites, an "unverified" notice for viewers, nothing from the API or CI); Tiiny Host (email sign-up, 1 free project, password from $13/mo); Netlify Drop (claim within an hour or it's deleted); GitHub Pages (needs Git). |
| **What's different** | No account for the sender or the viewer. One link from any AI tool, or from an agent or CI job. A free PIN. Open source and self-hostable. |
| **The value** | What your AI made, in front of the right person, in seconds, looking like a real web page. |
| **Category** | "Turn HTML into a link" — a utility, not "web hosting". Hosting invites comparison with Netlify and Vercel on features aired doesn't need. |
| **One-liner** | aired turns anything your AI makes into a link anyone can open. |

### Homepage: what changed (implemented on this branch)

| Before | After | Why |
|---|---|---|
| Title "aired — publish HTML artifacts instantly" | "aired — turn any HTML file into a shareable link" | Contains the searched phrase; no jargon |
| H1 "Air your artifacts." | "Turn HTML into a link anyone can open." | Says the outcome in plain words |
| Sub-copy about agents, "No signup, no deploy" | "Made a report, page or game with Claude, ChatGPT or another AI tool? Paste the HTML or drop the file. You get a link to send in seconds. Free, no account." | Names the new audience and their tools |
| Agent instructions first, "Or paste HTML" second | Paste form first, then "Or let your agent publish it" | The non-technical path comes first; the agent path stays one scroll away |
| Button "Air it" | "Publish" | DESIGN.md §8.1; clearer to a newcomer |
| No FAQ, no use cases | "What people share" cards linking to the guides, plus a 6-question FAQ | Answers objections; builds internal links |
| Footer: abuse, llms.txt, GitHub | A guides row on `/`, `/docs` and `/abuse` | Internal links to every new page |

### Homepage: next changes (not built)

- **Show real examples.** Add a row of 3 published pages (a report, a game, a small-business page), with the owners' permission. Non-technical visitors need to see what "an HTML page" means.
- **After publishing, ask them to keep the link.** On the result card: "Sign in to keep this link and see who opened it." This is the step from anonymous to free account.
- **Mention client reports once Pro exists.** One line plus a link to `/client-reports`.
- Keep DESIGN.md's voice: no hype words, no exclamation marks, one purple element per view.

---

## 5. Monetization: how SEO turns into revenue

```
Search (guide page) ──► publish without an account (form on the page)
        │                         │
        │                         ▼
        │              result card: "Sign in to keep this link and see who opened it"
        │                         │
        ▼                         ▼
 badge on every shared page ◄── free account (Google or GitHub sign-in)
 (?ref=badge → new visitors)      │
                                  ▼
              upgrade moment: custom domain / remove badge /
              who viewed / CI API key  ──►  Pro $9 · Team $29
```

| Landing page | Visitor | Upgrade moment | Plan |
|---|---|---|---|
| `/html-to-link` | Anyone with a file | "Keep this link" → free account; later, remove the badge before sending to a client | Free → Pro |
| `/share-claude-artifacts`, `/share-chatgpt-html` | AI makers, consultants | Sends to a client → wants no badge, a password and to see who opened it | Pro |
| `/tiiny-host-alternative` | Price-sensitive switchers | Custom domain and password for $9 instead of Tiiny Solo's $13 | Pro |
| `/client-reports` | Agencies | Own domain, no aired branding, seats, per-client folders | Team |
| `/publish-html-from-ci` | Developers, CI | Publishing beyond the anonymous rate limit needs an API key | Pro |

Measure it with Cloudflare Web Analytics on the marketing pages (free and cookieless). Also send a `source` field with each publish from a guide page (the page path), so you can count publishes per page, signups per page and upgrades per page.

---

## 6. Plan structure

### What comparable products charge (read from live pricing pages, November 2026)

| Product | Free tier | First paid tier | What gets people to pay |
|---|---|---|---|
| Tiiny Host | 1 project, 3 MB, 5k visits/mo, banner, link kept while you log in every 3 months | Tiny $5 (no banner, analytics); Solo $13 (custom domain, password, API) | 1 project, the banner, no password |
| Netlify | 300 credits/mo hard cap; anonymous Drop has an hour to be claimed, then is deleted | Personal $9 | Credit cap; password is Pro-only |
| Vercel | Hobby is free but non-commercial only | Pro $20/seat | Commercial use; password costs $20 per project per month |
| Carrd | 3 sites, branding | Pro Lite $9/**yr**; custom domain from $19/yr | Custom domain, branding |
| Notion Sites | Unlimited sites on notion.site | Custom domain add-on $10/mo on top of a paid seat | Custom domain |
| Gamma | Credits, badge | Plus $9 (no badge); Pro $18 (analytics, custom domains) | AI credits, then the badge |
| Small HTML-share tools | htmltourl 1 h, binhtml 3 days, Stacktree 7–90 days | $4–19/mo; Stacktree $19 / $79 / $249 for agencies | Expiry, viewer analytics, custom domain |

Patterns:
- Entry price clusters at $4–10/mo.
- A custom domain usually sits one tier above the cheapest paid plan.
- Password protection is often paywalled.
- Tools that serve agencies charge $19–249/mo for viewer analytics and white-label.

Full notes, with source URLs: [competitor-pricing.md](competitor-pricing.md).

### Proposed tiers

| | **No account** | **Free account** | **Pro — $9/mo ($90/yr)** | **Team — $29/mo, 3 seats (+$8/seat)** |
|---|---|---|---|---|
| Publish | 5/hour, 2 MB | 30/hour, 2 MB | 10 MB pages, 500 publishes/day | Same as Pro, pooled |
| How long pages last | 1 hour to 30 days (default 7) | Permanent | Permanent | Permanent |
| Live permanent pages | — | 50 | Unlimited | Unlimited |
| Views | Unlimited | Unlimited | Unlimited | Unlimited |
| PIN | Free | Free | Free, plus real passwords and links that expire after N views | Same |
| Badge | On | On | Off, or your logo | Off; PIN page white-labelled too |
| Analytics | View count | View count | Views over time, countries, referrers, per-recipient links ("Acme opened it Tuesday") | Same, per client folder |
| Domain | aired.sh/p/… | aired.sh/p/… | 1 custom domain | 5 custom domains |
| Edit at the same link | Update token | From the dashboard | Version history | Version history |
| API | Anonymous HTTP API | Same, with your account | API key for CI and agents | Keys per member |
| Team | — | — | — | Shared workspace, client folders, roles |
| Self-host | MIT, free | | | Paid support later, if asked |

### Why each limit

- **No view cap on any tier.** Views are the badge's impressions; capping them caps the growth loop. Serving cost on Workers and R2 is negligible per view.
- **The PIN stays free.** It's the clearest gap against Tiiny ($13), Netlify (Pro only) and Vercel ($20 per project), and it's the line non-technical sharers repeat. Real passwords and view-limited links go to Pro.
- **Anonymous pages get at most 30 days; permanent requires a free account.**
  - It turns the most common wish ("keep this link") into a signup instead of a payment.
  - It stops anonymous spam from living forever on the domain.
  - The spam cleanup on 2026-11-20 removed 3,621 pages; long-lived anonymous pages are where that risk sits.
  - This is the one change that removes something free today. Pages already permanent stay permanent.
- **50 live permanent pages on a free account.** High enough that real people never hit it; it caps abuse. Expiring pages stay unlimited.
- **The badge stays on all free pages.** Every shared page is an ad. Removing it is the cheapest thing to pay for (Gamma and Tiiny both lead with it). Link it with `?ref=badge` so you can see what it's worth.
- **The custom domain is in Pro, not a higher tier.** At $9 it undercuts Tiiny Solo ($13) and Gamma Pro ($18), which is the pitch on `/tiiny-host-alternative`. Cloudflare for SaaS custom hostnames keep the cost low.
- **Analytics on who viewed is the agency hook.** Per-recipient links are what Stacktree and HummingDeck charge $19–40 for. They justify Team, and they're the line in the post-publish nudge.
- **The API key is in Pro.** The CI and headless-agent wedge is aired's moat: Claude's own artifacts can't publish from the API, Bedrock, Vertex, the Agent SDK or CI. Teams that rely on it will pay.
- **Team at $29 instead of $79+.** Stacktree's $79 Studio shows agencies pay more. Start low to learn, then raise it once client folders and white-label exist.

### Testing it before building

1. Add a `/pricing` page with the four columns. Pro and Team buttons go to a Stripe checkout ("billing starts when the features ship, cancel anytime") or a waitlist. Link to it from the dashboard and the result card.
2. Show the Pro features as locked items in the dashboard (custom domain, analytics, no badge). Count clicks.
3. Decision rule: build custom domains and analytics if, within 30 days, 20 or more people pay or join or 3% of active free accounts click a locked feature. Otherwise rethink the bundle before writing code.

---

## 7. Prioritized checklist

### Done on this branch (`claude/seo-growth-59c8e2`)
- [x] `robots.txt` with `Sitemap:`; disallow `/api/`, `/auth/`, `/dashboard`, `/mcp`; `/p/` left crawlable so the noindex header is seen
- [x] `sitemap.xml` (5 URLs)
- [x] Canonical, Open Graph and Twitter tags on `/`, `/docs` and the guides; canonical on `/abuse`; noindex on `/dashboard`
- [x] JSON-LD: Organization, WebSite, SoftwareApplication and FAQPage on `/`; WebPage, BreadcrumbList and FAQPage on the guides
- [x] New homepage title, meta description, H1 and sub-copy; form first; "Publish" button; use-case cards; visible FAQ
- [x] Guide pages `/html-to-link`, `/share-claude-artifacts` and `/tiiny-host-alternative`, each with the working publish form
- [x] Internal links: `/docs.html` → `/docs`; a guides row in the footers; guide URLs added to `llms.txt`
- [x] DESIGN.md pattern log entry; `style.css` rebuilt

### Owner, before or at deploy
- [x] Claude sharing claims on `/share-claude-artifacts` checked against Anthropic's "Share artifacts" help article (2026-11-23): link sharing is paid-only; Team and Enterprise need an owner to allow outside sharing; artifacts that connect to other websites can't get a public link; Claude-powered parts don't work for link viewers. The "unverified" notice is confirmed by third-party reports, not the article.
- [ ] Review and deploy, then confirm `curl https://aired.sh/robots.txt` shows the `Sitemap:` line under Cloudflare's managed block.
- [ ] Verify aired.sh in Search Console (Domain property, DNS TXT) and Bing Webmaster Tools; submit `https://aired.sh/sitemap.xml`; request indexing for the three guides.
- [ ] Turn on Cloudflare Web Analytics for aired.sh.
- [ ] Clear the Semrush Cloudflare check (`semrush login --chrome`) so the volume column above can be filled in.

### Next 2 weeks
- [ ] Badge link `?ref=badge`, and new copy for the injected OG description (`viewer.ts`)
- [ ] Google sign-in (or an email magic link) next to GitHub
- [ ] Result-card nudge: "Sign in to keep this link and see who opened it"
- [ ] `/share-chatgpt-html`, then `/html-game-hosting`
- [ ] A `404.html` page, plus `not_found_handling = "404-page"` in wrangler
- [ ] Speed: lazy-load the globe on desktop only; self-host Inter 400/500 as woff2; run Lighthouse before and after
- [ ] Answer, honestly, the Reddit threads that rank for these queries (r/ClaudeAI, r/BuildWithClaude, r/ChatGPT, r/CodingHelp, r/godot). They sit at #1–2 on most target SERPs.

### Next 30 days
- [ ] `/pricing` page plus the Pro and Team checkout or waitlist test, with the decision rule from section 6
- [ ] Anonymous pages capped at 30 days; permanent pages for free accounts
- [ ] `/client-reports` sales page and `/publish-html-from-ci`
- [ ] Move user pages to `aired.page` (`.forge/blueprints/content-domain.md`) before owned pages scale up
- [ ] Listings: AlternativeTo (under Tiiny Host, Netlify Drop and Claude), awesome-claude lists, a Product Hunt relaunch aimed at non-technical makers
- [ ] Backfill real search volumes and re-rank the page plan; after 6 weeks, check Search Console for queries in positions 8–20 and expand those pages
