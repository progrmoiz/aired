# Competitor pricing (read 2026-11-21)

Prices are USD, as each page showed them. "n/r" means the page loaded but the number was not in the readable text.

### Tiiny Host (https://tiiny.host/pricing)
| Plan | Price shown | Projects | Upload | Visits/mo | Bandwidth | Unlocks |
|---|---|---|---|---|---|---|
| Free | $0/mo | 1 | 3 MB (0.5 MB PDFs) | 5,000 | 5 GB | Tiiny banner shown |
| Tiny | $5/mo | 1 | 25 MB | 10,000 | 10 GB | banner removal, QR, analytics, feedback mode |
| Solo | $13/mo | 5 | 75 MB | 100,000 | 50 GB | custom domains, editing, password, API |
| Pro | $31/mo | 15 | 10 GB account | 500,000 | 100 GB | email capture, team members, priority support |
| 4th tier | n/r | unlimited | 2 TB | | | large files |

Yearly billing is "2 MONTHS FREE". I could not tell whether $5/$13/$31 are the monthly or yearly toggle. Free links stay up as long as you log in once every 3 months. **Upgrade trigger:** 1 active project, 3 MB upload, the banner, and no password below Solo.

### Netlify (https://www.netlify.com/pricing/, https://app.netlify.com/drop, https://www.netlify.com/blog/thirteen-years-of-netlify-drop)
| Plan | Price | Credits/mo | Notes |
|---|---|---|---|
| Free | "$0 forever" | 300 (hard cap) | 1 member, custom domain included, 1-day analytics |
| Personal | $9/mo | 1,000 | +$5 / 500 credits |
| Pro | base price n/r (a Members-row cell says "$20/month", but the FAQ says Pro has charged no seat fees since April 14) | 3,000 up to 20,000 tiers | unlimited members, password-protected projects, 30-day analytics |
| Enterprise | custom, billed annually | custom | SSO, SLA |

- **Password protection is Pro only.** Free and Personal show "Not included".
- Going over the limit pauses every project on the account until the next cycle.
- **Netlify Drop:** no account needed. Per Netlify's blog, the claim window went from 24 hours to one hour in 2022, with a cap of 3 anonymous sites per IP. Since 2024, anonymous drops stay password-protected until someone claims them. Unclaimed drops are suspended, then deleted a week later. So yes, anonymous drops expire.
- **Upgrade trigger:** credit cap and pause, plus password protection.

### Vercel (https://vercel.com/pricing, /docs/plans/hobby, /docs/plans/pro-plan, /legal/terms)
| Plan | Price | Key limits |
|---|---|---|
| Hobby | free | 100 GB transfer, 1M requests, 200 projects, 1 seat, 50k analytics events |
| Pro | "$20/month Pro platform fee", includes $20 usage credit and 1 deploying seat | extra seats $20/user/mo, viewer seats free, 14-day trial |

- **Commercial-use restriction.** The terms say Hobby is for "personal or non-commercial use" only.
- Password Protection is an extra "$20 per month per protected project", even on Pro.
- Hitting a Hobby limit means waiting 30 days. No annual price is published.
- **Upgrade trigger:** commercial use, team seats, and usage caps.

### Carrd (https://carrd.co/pro), billed yearly only
| Plan | /year | Sites | Gates |
|---|---|---|---|
| Free | $0 | 3 | "Made with Carrd" branding |
| Pro Lite / 10 / 25 | $9 / $14 / $29 | 3 / 10 / 25 | no branding, premium URLs, **no custom domain** |
| Pro Standard / 25 / 50 | $19 / $39 / $69 | 10 / 25 / 50 | custom domain, forms, embeds, analytics |

**Upgrade trigger:** a custom domain needs Standard ($19/yr). Branding removal starts at $9/yr.

### Notion Sites (https://www.notion.com/pricing, https://www.notion.com/help/notion-sites-availability-and-pricing)
| Plan | Price | Sites |
|---|---|---|
| Free | $0 | unlimited Sites, 1 notion.site domain, indexing allowed |
| Plus / Business | Plus $10, Business $20 per seat/mo billed yearly (**unverified**, from secondary sources; the live page did not render the numbers) | 5 notion.site domains, customization, Google Analytics |

- The custom domain add-on is "$10 per month", or $8 per month on annual billing, per domain, up to 25. It needs a paid plan.
- **Upgrade trigger:** a custom domain means paid seat plus the add-on, about $18–22/mo for one person.

### Gamma (https://gamma.app/pricing), "Save up to 28%" on annual billing
| Plan | Price (annual) | Unlocks |
|---|---|---|
| Free | $0 | 400 one-time credits, 10 slides per prompt, badge stays |
| Plus | $9/mo ($108/yr) | **remove Gamma branding**, 1,500 credits |
| Pro | $18/mo ($216/yr) | **detailed analytics**, **up to 10 custom domains**, custom branding |
| Ultra | $90/mo ($1,080/yr) | 100 custom domains |

Monthly-billed prices: n/r. **Upgrade trigger:** AI credits run out, then the badge.

### Small "share HTML / Claude artifact" tools
| Tool (URL read) | Free | Paid | Gating |
|---|---|---|---|
| htmltourl.com/pricing | free link lasts 1 hour, no signup, 20 MB | Starter $9, Pro $15, Business $25 per month (a Black Friday pre-sale was running) | editable URLs, branding removal; password from Pro; links live only "while subscribed" |
| binhtml.com/pricing | 3-day retention, unlisted, 5 GB traffic, API/MCP | Pro $10/mo or $84/yr; Lifetime $149 once | permanence, private visibility, limits |
| stacktr.ee/pricing | 3 pages lifetime, 7 days (30 days after the last visit, max 90); passcodes free | Solo $19, Studio $79, Firm $249 per month | viewer numbers, custom domain (Solo: 1), email gates |
| docklet.io | 5 Docklets, basic analytics | Pro $4, Team $9 per user per month | private visibility, versions, custom domain |
| spacesheep.dev/pricing | private, link-only or public pages, 25 MB per deploy, free AI tokens | Pro $4.50/mo | larger deploys, backups; custom domain is Enterprise only |
| send.co/pricing | "Expiring" sites | Essential, Pro, Business (prices n/r) | passcode on Essential, custom domain on Pro, webhooks on Business |
| hummingdeck.com/pricing | 5 documents, 5 links, real-time analytics only | Starter $10, Pro $25/user, Business $40/user per month | analytics history, email capture, custom domain on Business |

## Patterns
- **Expiry is the main lever for AI-artifact tools.** Netlify Drop gives 1 hour then deletion, htmltourl 1 hour, binhtml 3 days, Stacktree 7–90 days, Send "Expiring". General hosts (Tiiny, Notion, Carrd, Vercel) keep free pages up but cap their number at 1–3.
- **Entry price clusters around $4–10/mo.** Docklet $4, spacesheep $4.50, Tiiny $5, Netlify $9, htmltourl $9, Gamma $9, binhtml $10, HummingDeck $10. Carrd is the outlier at $9–19 per year. Stacktree ($19) and Vercel ($20) sit at the top.
- **Custom domains are almost always one tier above entry.** Tiiny Solo, Carrd Standard, Gamma Pro, Notion add-on at $8–10, Send Pro, HummingDeck Business, spacesheep Enterprise. Netlify is the exception and includes a custom domain on Free.
- **Password protection is often paywalled, sometimes high.** Netlify Pro only, Vercel +$20 per project, htmltourl Pro. Stacktree and spacesheep give access control away free, which sets them apart.
- **Free tiers give away a public link, basic branding, and the API/MCP.** They hold back durable links, removal of the badge or banner (Tiiny, Carrd, Gamma, htmltourl), and analytics on who viewed. Viewer analytics is the paid hook at Stacktree, Tiiny, Gamma, and HummingDeck.
