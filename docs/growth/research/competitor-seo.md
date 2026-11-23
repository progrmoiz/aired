# Competitor SEO and marketing study for aired.sh

Date: 2026-11-23. Scope: tiiny.host, htmltourl.com, static.app, stacktr.ee (Stacktree), Netlify Drop, EdgeOne Pages/Makers, binhtml.com, send.co, docklet.io, pagedrop.io. Added because they kept showing up: artifactsend.com, linkyhost.com, host-html.com, pagelive.io.

## How the data was collected

- **Sitemaps:** fetched each sitemap.xml and walked any sitemap index (script at `scratchpad/scripts/sm.py`). Direct curl failed for some hosts in the sandbox (static.app returned a Cloudflare 403, htmltourl and binhtml would not resolve), so those went through the r.jina.ai reader. Counts are as of today and include locale copies unless I say otherwise.
- **SERPs:** the seo-research MCP (SerpAPI) failed every call with a DNS error (`nodename nor servname provided`). I used Jina `search_web` instead, which returns Google results (`engine: google`, gl=us). The positions below are Google organic order from that feed. They may differ slightly from a logged-out browser and leave out SERP features such as video packs and AI Overviews.
- **Semrush CLI:** tried once. The session had expired and the overview came back all null, so I stopped. The Semrush public pages (`semrush.com/website/<domain>/overview/`) worked only for tiiny.host. The other domains returned 404 because they are too small to have a public page.
- **Similarweb:** blocked (CloudFront 403). I only have Google snippets of its pages.
- **Product Hunt:** the API works but you have to guess post slugs. The PH website is behind a Cloudflare challenge, and I did not try to get around it.
- **dataforseo:** skipped (no token).

---

## 1. SEO page inventory per competitor

### tiiny.host: 916 URLs (sitemap index with 15 child sitemaps)

This is the reference implementation of a page factory. Categories:

| Type | Count | Examples |
|---|---|---|
| Blog | 360 (incl. 34 pagination pages). 38 are vs/alternatives posts and 16 are AI/Claude/ChatGPT posts | https://tiiny.host/blog/tiiny-host-vs-netlify-drop/ , https://tiiny.host/blog/claude-artifacts/ , https://tiiny.host/blog/html-file-hosting/ , https://tiiny.host/blog/netlify-alternatives/ , https://tiiny.host/blog/create-website-using-chatgpt/ |
| Glossary (programmatic) | 199 (`/web-hosting/glossary/*`) | https://tiiny.host/web-hosting/glossary/cache/ , /http2/ , /zone-file/ , /quota/ , /linux-hosting/ |
| `/deploy/<framework>` (programmatic) | 63 | https://tiiny.host/deploy/hugo/ , /deploy/nextjs/ , /deploy/astro-app/ , /deploy/storybook/ , /deploy/react-app/ |
| `/use-case/*` (job-to-be-done tool landings) | 56. About 12 are AI-specific | https://tiiny.host/use-case/host-claude-artifact/ , /use-case/publish-ai-generated-html/ , /use-case/host-chatgpt-code/ , /use-case/host-lovable-export/ , /use-case/resume-link/ |
| `/host/*` (file type or tool host pages) | 39 | https://tiiny.host/host/json-hosting/ , /host/webflow-hosting/ , /host/pdf-portfolio/ , /host/free-php-hosting/ , /host/lottie/ |
| `/viewer/<filetype>` (free tools) | 28 | https://tiiny.host/viewer/docx/ , /viewer/csv/ , /viewer/psd/ , /viewer/json/ , /html-viewer/ |
| `/upload/<filetype>` + `/publish/<filetype>` | 23 + 3 | https://tiiny.host/upload/zip-file/ , /upload/pdf-flipbook/ , /upload/json/ , /publish/docx/ , /publish/ppt/ |
| Core tool landings | about 15 | https://tiiny.host/host-html-file/ (ranks #1–3 for 5 of my 10 queries), /free-static-website-hosting/ , /test-html/ , /html-validator/ , /webpage-to-pdf/ |
| Localized copies | 125 (ja, es-es, fr-fr, ar-sa, pt-br) | https://tiiny.host/ja/... |
| Other | /affiliates, /examples, /chatgpt-prompts/ , /web-editor/ | |

### htmltourl.com: 78 URLs (about 13 unique pages × 6 locales)

| Type | Count | Examples |
|---|---|---|
| Homepage tool (exact-match domain) | 1 (+5 locales) | https://htmltourl.com/ |
| "Templates", really tool variants | 3 (+locales) | https://htmltourl.com/templates/html-code-to-url , /templates/html-file-to-url , /templates/html-preview-online |
| Guides (cluster on "html viewer") | 19 | https://htmltourl.com/guides/how-to-convert-html-to-url , /guides/how-to-host-html-file , /guides/github-html-to-url , /guides/best-html-viewers , /guides/html-viewer-for-iphone-and-ipad |
| Compare | 3 | https://htmltourl.com/compare/htmltourl-vs-w3schools-tryit , /compare/htmltourl-vs-codeshack-html-viewer |
| Tool | 1 | https://htmltourl.com/tools/html-viewer |
| Locales | zh-CN, zh-TW, ja, bn, ru | |

The domain matches the query exactly and the site is thin. It still ranks #2 for "html to link" and #1 for "upload html get link".

### static.app: 264 URLs (121 are the /es locale, so about 143 English)

| Type | Count | Examples |
|---|---|---|
| `<platform>-hosting` AI/framework landings (programmatic) | 23 | https://static.app/claude-hosting , /chatgpt-hosting , /lovable-hosting , /v0-hosting , /cursor-hosting (also gemini, kimi, manus, bolt-new, codex, replit, react, nextjs…) |
| `<competitor>-alternative` | 8 | https://static.app/tiiny-host-alternative (#1 for "tiiny host alternative"), /netlify-alternative , /vercel-alternative , /github-pages-alternative , /cloudflare-drop-alternative |
| Free dev tools (link bait) | about 35 | https://static.app/html-viewer , /html-validator , /json-beautifier , /open-graph-checker , /sitemap-generator |
| Tool landings ("X to link") | about 12 | https://static.app/html-file-upload , /free-website-hosting , /pdf-to-link , /video-to-link , /resume-link , /portfolio-link |
| Guides | 35. 20 of them are programmatic `transfer-domain-from-<registrar>` | https://static.app/guides/host-claude-artifact , /guides/what-are-claude-artifacts , /guides/where-to-host-claude-apps , /guides/what-is-chatgpt-canvas , /guides/transfer-domain-from-godaddy |
| Domains (TLD pages) | 13 | https://static.app/domains/ai , /domains/dev |
| Product/feature | about 15 | https://static.app/mcp , /mcp/docs , /api , /workspaces , /github-action |

### stacktr.ee (Stacktree): 196 URLs, all English. This is the closest positioning match to aired.

| Type | Count | Examples |
|---|---|---|
| Alternatives (`/<x>-alternative`) | 20 | https://stacktr.ee/tiiny-host-alternative , /static-app-alternative , /display-dev-alternative , /here-now-alternative , /claude-teams-artifact-sharing-alternative |
| Compare | 4 (+hub) | https://stacktr.ee/compare/tiiny-host-vs-netlify , /compare/vercel-drop-vs-netlify-drop , /compare/github-pages-vs-vercel |
| "Share X with client" problem pages | 11 `share-*` plus about 25 client-delivery pages | https://stacktr.ee/share-claude-artifacts , /share-html-file-with-client , /share-gemini-canvas-with-client , /send-client-report-as-link , /client-view-without-account |
| Privacy/security intent pages | about 6 | https://stacktr.ee/private-html-hosting , /password-protect-html-page , /password-protect-website , /one-time-view-links , /make-claude-artifact-private |
| Per-agent pages | about 10 | https://stacktr.ee/claude-code , /codex , /cursor , /chatgpt , /mcp-publish-html , /deploy-html-from-claude-code , /n8n |
| Explainers ("what is…") | about 8 | https://stacktr.ee/what-is-a-claude-artifact , /what-is-claude-cowork , /claude-cowork-vs-claude-code |
| Workflows + templates | 8 + 5 | https://stacktr.ee/workflows/rescue-claude-artifact , /workflows/agent-publishes-its-own-report , /templates/business-proposal |
| Blog (news-jacking on agent platform changes) | 66 | https://stacktr.ee/blog/claude-artifact-cannot-republish , /blog/what-is-chatgpt-sites , /blog/claude-artifact-too-large-to-share , /blog/chatgpt-sites-private-sharing , /blog/what-is-cloudflare-drop |
| Glossary, changelog, made-with (badge landing) | | https://stacktr.ee/made-with |

The robots.txt welcomes GPTBot, ClaudeBot and Google-Extended explicitly. The pages carry very fresh dates (Nov 2026) and already rank in 5 of my 10 queries.

### EdgeOne Pages / Makers (pages.edgeone.ai): 1,476 URLs (about 470 English, the rest zh/ko/ja/vi/th/pt/ms/id)

| Type | Count (EN) | Examples |
|---|---|---|
| `/use-cases/*` (programmatic "X to URL" and hosting landings) | 78 | https://pages.edgeone.ai/use-cases/html-to-url (#1 for "html to link"), /use-cases/upload-html-file , /use-cases/free-html-hosting , /use-cases/pdf-to-link , /use-cases/password-protect-web-page |
| Templates (gallery) | 176 | https://pages.edgeone.ai/templates/claude-agent-starter-python , /templates/vitepress-template |
| Docs | 174 | https://pages.edgeone.ai/document/... |
| Resources/blog | 42 | https://pages.edgeone.ai/resources/edgeone-pages-mcp-turns-ai-code-into-live-websites , /resources/announcing-pages-drop-free-static-website-hosting , /resources/pages-deploy-chatgpt-apps |
| Solutions | 9 | https://pages.edgeone.ai/solutions/vibe-coding |
| Drop tool | 1 | https://pages.edgeone.ai/drop |

It has Tencent's domain authority behind it, and each use-case page sits on a literal query such as "html to url" or "mp3 to link". About 30 of the use-case pages target AI agent topics (agent hosting, LLM gateway), so it is also building a second cluster.

### send.co: 245 URLs

| Type | Count | Examples |
|---|---|---|
| Use cases (by doc type × persona, programmatic) | 77 | https://www.send.co/use-cases/sales-proposal , /use-cases/client-report , /use-cases/investor-memo , /use-cases/deal-room , /use-cases/property-listing |
| Blog, programmatic "top alternatives to / competitors for <X>" | 32 | https://www.send.co/blog/top-alternatives-to-docsend , /blog/top-competitors-for-papermark , /blog/top-alternatives-to-pandadoc |
| Blog, programmatic "how to share <tool> across teams" | 18 | https://www.send.co/blog/how-to-share-notion-pages-across-teams , /blog/how-to-share-figma-files-across-teams |
| Blog, programmatic "capture phone numbers on shared <X>" | 9 | https://www.send.co/blog/capture-phone-numbers-on-shared-google-docs |
| Blog, Claude cluster | 4 | https://www.send.co/blog/best-ways-to-share-claude-artifacts (ranks #4 for "how to share claude artifact"), /blog/how-to-send-html-from-claude , /blog/best-claude-connectors , /blog/how-to-make-a-data-room-in-claude |
| Integrations (source type) | 14 | https://www.send.co/integrations/notion-pages , /integrations/loveable , /integrations/gamma-docs |
| Features (problem pages) | 9 | https://www.send.co/features/create-a-link-to-a-pdf , /features/pdf-too-large-to-email |
| Alternatives | 3 | https://www.send.co/alternatives/docsend-alternative , /alternatives/papermark-alternative |
| Not in sitemap: "Top 100 Claude Connectors" directory (link bait) | | https://www.send.co/connectors |

Send is positioned as a DocSend replacement and treats HTML from Claude as one more doc type. Its main distribution is being a listed connector in Claude's directory.

### binhtml.com: 147 URLs (closest technical twin to aired: API + MCP, agent-first)

| Type | Count | Examples |
|---|---|---|
| Compare (`binhtml-vs-<x>`) | 17 | https://binhtml.com/compare/binhtml-vs-tiiny-host , /compare/binhtml-vs-claude-artifacts , /compare/binhtml-vs-chatgpt-canvas , /compare/binhtml-vs-netlify , /compare/binhtml-vs-htmlsave |
| Alternatives | 11 | https://binhtml.com/alternatives/tiiny-host , /alternatives/claude-artifacts , /alternatives/chatgpt-canvas , /alternatives/codepen |
| Migrate (`from-<x>`) | 8 | https://binhtml.com/migrate/from-tiiny-host , /migrate/from-netlify-drop , /migrate/from-email-attachments |
| For (persona) | 7 | https://binhtml.com/for/agencies , /for/data-teams , /for/qa-teams |
| Tool/intent landings | about 10 | https://binhtml.com/share-claude-html-artifacts , /share-chatgpt-html , /share-html-online , /html-artifact , /sandboxed-ai-generated-html-security |
| Blog (agent-workflow how-tos, about 56 posts) | 65 incl. pagination | https://binhtml.com/blog/publish-html-from-claude-code-with-mcp , /blog/share-ai-generated-html-in-slack , /blog/publish-generated-html-from-cursor , /blog/how-can-i-share-my-html-file , /blog/return-links-not-html-mcp-tool-results |
| Docs + machine-readable | 12 docs + llms.txt, llms-full.txt, openapi.json, `.well-known/mcp/server-card.json` | https://binhtml.com/docs/mcp |

It has a complete alternatives/compare/migrate matrix, but none of it showed up in my 10 SERPs. Page templates do not rank on a new domain without authority.

### docklet.io: 8 URLs

https://docklet.io/share-chatgpt-canvas-with-a-client.html (ranks #2 for "share chatgpt canvas"), /share-claude-artifact-with-a-client.html , /claude-publish-vs-docklet.html , /publish-claude-artifact-without-netlify.html , /client-feedback-on-a-live-page.html , /connect-claude.html. So a handful of sharply targeted pages can rank on an under-served query.

### pagedrop.io: 99 URLs, all user-generated subdomains

Examples: https://iskraburgers.pagedrop.io , https://vitamin-c-calculator.pagedrop.io , https://nursing.pagedrop.io. The sitemap indexes user pages and has no marketing pages. The homepage returned 429 to the fetcher. PageDrop gets nothing from SEO. It is also a spam/abuse risk, which is the reason Netlify password-gates unclaimed drops.

### Netlify Drop

https://app.netlify.com/drop is not in Netlify's sitemap (2,719 URLs: 1,353 blog, 541 changelog, 295 integrations, 159 agency directory). Drop lives on brand and word of mouth. Supporting content: https://www.netlify.com/blog/thirteen-years-of-netlify-drop , https://www.netlify.com/blog/introducing-netlify-drop-chatgpt-plugin/ , and the "with" pages (11, e.g. https://www.netlify.com/with/claude). Its distribution is the official Claude connector (https://claude.com/marketplace/connectors/netlify) and the 2023 ChatGPT plugin.

### Extras that kept showing up

- **artifactsend.com (143 URLs):** 116 guides. 22 are DocSend/Papermark alternative or vs pages and 30 are "share <tool>" pages, e.g. https://artifactsend.com/guides/share-chatgpt-canvas (#9 for "share chatgpt canvas"), /guides/share-claude-artifact-privately , /guides/password-protect-html-page , /html-to-link , /mcp.
- **linkyhost.com (370 URLs):** a tiiny.host clone strategy. 238 glossary pages, 36 use-cases, 25 viewers, 11 uploads, 9 publish, plus https://www.linkyhost.com/compare/linkyhost-vs-tiiny-host. It ranks in 6 of my 10 queries.
- **host-html.com:** https://host-html.com/vs/tiiny-host , /blog/share-claude-artifact-live-url , homepage ranks #3 for "host html file free".
- **pagelive.io:** https://pagelive.io/tools/html-to-url ranks #4 for "html to link" and "upload html get link".

---

## 2. SERPs: the 10 queries (Google US, positions 1–10)

1. **html to link:** pages.edgeone.ai/use-cases/html-to-url, htmltourl.com, tiiny.host/host-html-file, pagelive.io/tools/html-to-url, htmltowebsite.com/html-to-url, reddit r/HTML, w3schools, youtube (hyperlink tutorial), linkyhost.com/blog/html-to-website-converter, engr.colostate.edu
2. **share html file:** reddit r/CodingHelp, tiiny.host/host-html-file, learn.microsoft.com, sharinghtml.com, youtube (Tiiny Host tutorial da6KxMVvEGg), automatonagency.com ("the one your AI just made you"), shareduo.com/blog, linkyhost.com/use-cases/html-viewer, youtube, pages.edgeone.ai/use-cases/upload-html-file
3. **host html file free:** tiiny.host/host-html-file, reddit r/webdev, host-html.com, pages.edgeone.ai/use-cases/free-html-hosting, static.app/free-website-hosting, linkyhost.com/use-cases/free-website-hosting, paste.page/free-html-hosting, dplooy.com, youtube, fylo.host
4. **how to share claude artifact:** support.claude.com, reddit r/BuildWithClaude, youtube (LSE), send.co/blog/best-ways-to-share-claude-artifacts, codecademy.com, youtube, go9x.com/blog, stacktr.ee/share-claude-artifacts, code.claude.com/docs/en/artifacts
5. **share chatgpt canvas:** reddit r/ChatGPT, docklet.io, ai-toolbox.co, youtube playlist, youtube ("canvas is gone", promotes ArtifactSend), learn.chatgpt.com (Sites), academy.openai.com, guideflow.com, artifactsend.com/guides/share-chatgpt-canvas, coursera.org
   - Note: per ai-toolbox.co, ChatGPT Canvas shut down in May 2026 and ChatGPT **Sites** replaced it. The query now has "canvas is gone" intent.
6. **tiiny host alternative:** static.app/tiiny-host-alternative, reddit r/selfhosted, tinidrop.com/blog (listicle), boomurl.com/compare, livesend.io/guides, g2.com, host-html.com/vs/tiiny-host, stacktr.ee/tiiny-host-alternative, brewpage.app, semrush.com/website/tiiny.host/competitors
7. **upload html get link:** htmltourl.com, pages.edgeone.ai/use-cases/html-to-url, tiiny.host/host-html-file, pagelive.io, display.dev/upload-html, reddit r/HTML, dplooy.com, miinideck.com/try, youtube (Tiiny), linkyhost.com/blog
8. **password protect html page:** stackoverflow, pagecrypt.maxlaumeister.com, reddit r/HTML, answers.netlify.com, supergeekery.com, translateabook.com/staticrypt, render.com/blog, community.softr.io, stacktr.ee/password-protect-html-page, news.ycombinator.com
9. **share html with client:** reddit r/CodingHelp, youtube (Tiiny), tiiny.host/host-html-file, automatonagency.com, linkyhost.com/use-cases/html-viewer, stackoverflow, facebook group, superuser, stacktr.ee/share-html-file-with-client, sololearn
10. **share html privately:** tiiny.host/host-html-file, reddit r/CodingHelp, stacktr.ee/private-html-hosting, stackoverflow, youtube (Tiiny), superuser, facebook, sharable.link/blog, linkyhost.com/use-cases/free-website-hosting, softwarerecs.stackexchange

Bonus queries:
- **share claude artifact privately:** support.claude.com, reddit, youtube, stacktr.ee, guideflow, go9x, codecademy, send.co, support.claude.com, youtube
- **publish html from claude code:** reddit, stacktr.ee/claude-code, youtube, gitshare.me/blog, tiiny.host/use-case/publish-ai-generated-html, animaapp.com, youtube, htmlaunch.com
- **host chatgpt generated html:** help.openai.com (Sites), wix.com/blog, youtube, reddit, static.app/chatgpt-hosting, host-html.com/blog, tiiny.host/use-case/host-chatgpt-code, mindstudio.ai, learn.chatgpt.com, youtube

### Who shows up repeatedly (out of the 10 core queries)

| Domain | Queries present | Notes |
|---|---|---|
| reddit.com | 10/10 | Old threads (2021–2022) for generic queries, and fresh 2026 threads for AI queries. Several AI-query threads look seeded with a "workaround I use" pitch. |
| youtube.com | 9/10 | A Tiiny Host tutorial (watch?v=da6KxMVvEGg) appears in 4 queries. |
| tiiny.host | 6/10 (+4 via its YouTube video) | A single page, /host-html-file, does almost all of it. |
| linkyhost.com | 6/10 | A tiiny.host copycat, ranking on mid-tail queries. |
| stacktr.ee | 5/10 (+2 bonus) | Owns the "private / client / password" cluster with pages dated Nov 2026. |
| pages.edgeone.ai | 4/10 | Owns the literal "html to url/link" and "upload html" queries. |
| static.app | 2/10 (+1 bonus) | #1 for "tiiny host alternative". |
| htmltourl.com, pagelive.io, host-html.com, dplooy.com, automatonagency.com | 2 each | |
| send.co, docklet.io, artifactsend.com, display.dev | 1 each | |
| binhtml.com, pagedrop.io, netlify drop, **aired.sh** | 0 | |

Takeaways:
- **Generic queries** ("html to link", "upload html", "host html free") go to old authority (tiiny, EdgeOne/Tencent) and exact-match domains (htmltourl).
- **AI queries** ("share claude artifact", "share chatgpt canvas") are still mostly Claude and OpenAI help docs plus Reddit and YouTube. A fresh, specific page can get into the top 10 within weeks: Stacktree and Docklet pages from Aug–Nov 2026 already rank.
- **"Private / client / password"** is the softest cluster. The results are StackOverflow threads from 2010–2021, with Stacktree as the only modern product page. It also matches aired's private-link positioning.

---

## 3. Traffic estimates

- **tiiny.host:**
  - Semrush public page: 730.58K visits in October 2026, +21.53% vs September. Average session 07:46. Desktop 68.24%. Top countries are US, then India, then Brazil. Source: https://www.semrush.com/website/tiiny.host/overview/
  - Systemaic teardown (Similarweb-style model): about 966K monthly visits. Channel split is 50.3% direct, 36.9% organic, 3.8% referral, 3.4% gen-AI referrals, 2.9% social and 1.7% email.
  - Its top organic keywords are branded: "tiiny host" 13,390/mo, "tinyhost" 6,990/mo, "tiny host" 5,780/mo.
  - Use-case pages (PDF-to-link, resume-link, unzip-online) drive about 25K/mo organic.
  - Revenue: about $1M ARR by early 2026, with a team of about 9 and very little paid spend (24 Meta ads and 36 Google ads seen). Source: https://www.systemaic.com/teardowns/tiiny-host
  - Founder's AMA: $450K ARR and on the way to $1M. Source: https://www.reddit.com/r/SaaS/comments/1h3742v/
  - Similarweb (Google snippet): top competitor by audience overlap is pdfdeck.com, then static.app. Source: https://www.similarweb.com/website/tiiny.host/competitors
- **linkyhost.com:** Similarweb rank #181,790 globally and #693 in "Graphics Multimedia and Web Design" (Oct 2026). That probably means low six figures of visits a month, but this is a rough inference.
- **Netlify Drop:** no visit numbers. Among users who signed up in June 2026, more than 60% made their first deploy through Drop. About 14M unclaimed anonymous drops existed by early 2025. Since 2024 Netlify password-gates unclaimed drops because of phishing abuse. Source: https://www.netlify.com/blog/thirteen-years-of-netlify-drop
- **static.app, htmltourl, send.co, stacktr.ee, edgeone, binhtml, docklet, pagedrop, artifactsend:** I found no free estimates. Semrush public pages return 404, which usually means traffic is too small to model, and Similarweb was blocked. Treat all of these except EdgeOne (which rides edgeone.ai's authority) as under roughly 50K/mo.

---

## 4. Marketing channels

### Product Hunt

| Product | Date | Votes / comments | Notes |
|---|---|---|---|
| Tiiny Host | 2020-03-25 (featured) | 178 / 31 | Over 1,500 visitors on the day and its first paying customer (per Systemaic). |
| Pagedrop | 2025-05-29 (not featured) | 8 / 1 | "A place to instantly post AI generated HTML" |
| HTML to URL (htmltourl) | 2026-05-27 (not featured) | 1 / 1 | |
| Docklet | 2026-08-10 (not featured) | 2 / 1 | |
| Stacktree | 2026-10-06 (not featured) | 3 / 2 | |
| ArtifactSend | 2026-11-01 (not featured) | 8 / 2 | Hunted by an investor (Vela) |
| Static.app | Product page exists (https://www.producthunt.com/products/static-app), but I could not get launch stats past the Cloudflare challenge | | |
| send.co, binhtml, EdgeOne Pages, Netlify Drop | No launch found via the API | | Tencent EdgeOne has a PH product page for the CDN. |

The pattern: none of the AI-era HTML-sharing launches in 2025–2026 got featured, and all of them landed under 10 votes. Product Hunt is not a meaningful channel in this category any more, unless the launch is a heavily prepared, featured one. For any of these products its main value is the backlink and the "Alternatives" page.

### Lifetime deals and AppSumo

- Tiiny Host ran its own lifetime deal in Sept 2020: $59 for life, limited quantity, about $1,000 in 3 days. It turned the story into Reddit and IndieHackers posts. Sources: https://www.reddit.com/r/SaaS/comments/j374pk/ , https://www.indiehackers.com/post/how-i-made-over-1-000-in-sales-in-3-days-with-tiiny-host-1a649be7d8
- AppSumo has a competitor, HTML Pub, which also has a TAAFT listing (https://theresanaiforthat.com/ai/html-pub). I found no AppSumo listing for tiiny, static, stacktree or the others.

### Affiliate programs

- Tiiny Host pays 20% recurring through a referral link: https://tiiny.host/affiliates . The `?fpr=` robots disallow shows it runs on FirstPromoter.
- I found no public affiliate program for static.app, Stacktree, Send or binhtml.

### YouTube

- Tiiny Host has many tutorial and review videos, and some are clearly creator or sponsored content ("Try Tiiny.host for free: https://tiiny.host"). Examples: https://www.youtube.com/watch?v=da6KxMVvEGg (ranks in 4 of my queries), /watch?v=DxKgTaQnWbI , /watch?v=pdDbVEc9Fu8 (Tiiny vs Netlify), /watch?v=V8TzM0Gj2Gk , /watch?v=BkWbdSXATnE (Claude + Chrome extension).
- Static.app has its own channel: https://www.youtube.com/@staticapp
- Stacktree uses a PH video (youtu.be/M6636tdvz9U). ArtifactSend shows up through a "canvas is gone" video (https://www.youtube.com/watch?v=KOhG7i0iZZ8). Generic "how to share Claude artifacts" videos rank for the Claude queries.
- So YouTube tutorials get extra Google real estate on "share/host html" queries.

### Reddit

- Tiiny founder Elston Baretto posted on Reddit from 2019: feedback posts in r/SideProject, r/HTML and r/Frontend, then "tool dump" and lifetime-deal posts in r/EntrepreneurRideAlong (126 upvotes) and r/SaaS, and an AMA. The founder also posts a lot on X (@_baretto, about 12K followers). One YC-rejection thread got about 47K views.
- New AI-era threads that rank for queries look like stealth marketing. The pattern is "the workaround I use: copy the HTML, drop it into a private link…" (r/BuildWithClaude), and r/ChatGPT has a "How do you share ChatGPT Canvas outputs" thread. Reddit ranks for 10 of 10 queries, so being mentioned in the threads that rank is worth a lot.

### Directories

- AlternativeTo has a tiiny.host page with 12 alternatives (https://alternativeto.net/software/tiiny-host). G2 has tiiny competitors (https://www.g2.com/products/tiiny-host/competitors/alternatives).
- TAAFT has a "Web hosting" search with 39 tools and lists HTML Pub. I did not find tiiny, stacktree or binhtml on TAAFT.

### Integrations and marketplaces (the strongest AI-era channel)

- **Claude connectors directory:**
  - Netlify is an official connector (https://claude.com/marketplace/connectors/netlify).
  - Send is listed, and its blog says to "search for Send in Claude's connector directory".
  - Canva's connector now publishes websites from Claude.
  - grtwo-docs publishes HTML/Markdown to share links (https://claude.com/marketplace/connectors/grtwo-docs).
- **Tiiny Host:**
  - MCP server and custom connector launched July 2026, pushed with a paid press release syndicated to USA Today (https://www.usatoday.com/press-release/story/37189/...) and covered by hostingdiscussion.com.
  - It also has a Chrome extension for publishing from Claude, a LinkedIn and Facebook video push, and a "Tiiny Host x Claude" post.
- **EdgeOne:**
  - Open-source MCP repo with 440 stars (https://github.com/TencentEdgeOne/edgeone-makers-mcp), listed on Glama and mcpservers.org.
  - Dify Marketplace plugin, a ChatGPT store app (https://pages.edgeone.ai/resources/pages-chatgpt-store), and an r/mcp launch post.
- **binhtml:** listed on Smithery (https://smithery.ai/servers/bin/html) and mcpbundles. It publishes llms.txt, openapi.json and an MCP server card.
- **Static.app:** /mcp page and docs, plus a GitHub Action.
- **Stacktree:** n8n node, Slack app, "skills" page, ChatGPT/Codex/Cursor pages and a "made-with" badge landing page (https://stacktr.ee/made-with), which is viral attribution on every shared page.
- **ArtifactSend:** ChatGPT app (https://artifactsend.com/guides/artifactsend-chatgpt-app) and an MCP server.
- **Netlify:** the 2023 ChatGPT plugin, then Bolt and other partners deploying through the claim flow. Netlify presents "deploy anonymously, claim later" as the agent pattern it pioneered.

### Other channels

- **Paid:** tiiny tests meme-style Meta and Google ads in small batches (about 24 Meta and 36 Google ads seen).
- **Listicles:** third-party "best tiiny alternatives" lists (tinidrop, sharable.link) are how small players get into the alternatives SERP.

---

## 5. Implications for aired

What wins:
1. **One strong core tool page on a literal query** (tiiny /host-html-file, edgeone /use-cases/html-to-url, htmltourl home). Each has the working uploader above the fold. Aired already has /html-to-link with the form, which is the right shape.
2. **Fresh, specific AI problem pages** ("share chatgpt canvas with a client", "share claude artifact privately", "password protect html page"). These rank within weeks, as Stacktree and Docklet show. The competing results are help docs, old StackOverflow and Reddit.
3. **Alternatives pages** work only with some authority (static.app #1, stacktree #8, host-html #7). binhtml's full 36-page matrix does not rank yet.
4. **Big programmatic sets** (glossary, deploy/<framework>, viewer/<filetype>) support tiiny and linkyhost through long-tail volume and internal links, but they are slow and low-intent. They are a later-stage play.

Recommended actions, ranked:
1. **Get listed in Claude's connectors directory and ChatGPT apps, plus MCP registries** (Smithery, Glama, mcpservers.org, PulseMCP). Do it with a launch post. This is the channel every serious AI-era competitor (Netlify, Send, Tiiny, EdgeOne, ArtifactSend) is using, and directory listings rank and send intent-rich traffic.
2. **Build the "private / client / password" cluster first:** share-html-privately, password-protect-html-page, share-html-with-client, share-claude-artifact-privately and make-claude-artifact-private. Only Stacktree competes here, and it matches aired's private-link angle.
3. **Ship per-source problem pages:** share-chatgpt-canvas (with the "canvas is gone, Sites replaced it" angle), share-chatgpt-site, share-gemini-canvas, publish-from-claude-code, publish-from-cursor/codex. Use the Docklet/Stacktree format: one problem, one fix, the working publish form, and a current date.
4. **Add a "made with aired" footer link on free pages, and seed Reddit and YouTube.** Stacktree's /made-with and Tiiny's founder-led Reddit posts plus YouTube tutorials are why they are everywhere. Reddit is in 10 of 10 SERPs and YouTube in 9 of 10. One 60-second "share an HTML file from Claude" video can rank in several queries.
5. **Grow alternatives/compare and literal "X to link" pages gradually:** tiiny-host-alternative (exists), netlify-drop-alternative, static-app-alternative, claude-artifacts-alternative, plus upload-html-file and pdf-to-link if aired supports them. Add a 20% recurring affiliate program like Tiiny's once there is a paid tier. Skip the big glossary/programmatic sets and Product Hunt-first launches for now. No AI-era HTML-sharing launch got featured, and all landed under 10 votes.
