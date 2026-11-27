# A Tiiny Host alternative for quick HTML links

Tiiny Host is a solid host for small sites. If what you mostly do is send one HTML page, from Claude, ChatGPT or your own files, aired gets you a link without an email sign-up, and password protection is free.

Source: https://aired.sh/tiiny-host-alternative

## The short answer

- **Pick aired** to share single pages fast: reports, AI-made pages, games and previews, with no account and a free PIN.
- **Pick Tiiny Host** if you need your own domain, PDF or zip hosting, or files bigger than 2 MB.

## aired vs Tiiny Host

|  | Tiiny Host | aired |
| --- | --- | --- |
| Sign-up to publish | Email verification | None |
| Free projects | 1 | No fixed limit (5 publishes an hour without an account) |
| Free upload size | 3 MB | 2 MB per page |
| Free visits | 5,000 a month | No platform cap |
| Branding on free pages | Tiiny banner | Small corner badge |
| Password protection | Solo plan: $13/mo billed yearly, $18 monthly | Free PIN |
| How long free links last | While you log in every 3 months | 1 hour to permanent, you choose |
| Custom domain | Solo plan: $13/mo billed yearly, $18 monthly | Not yet |
| Visitor analytics | Tiny plan: $5/mo billed yearly, $9 monthly | View count on every page |
| Publish from AI agents | API on Solo and up; MCP connector | Free: command line, MCP server for AI apps, and HTTP API |
| File types | HTML, zip, PDF and more | HTML (folders bundled by the CLI) |
| Open source | No | Yes |

Tiiny Host details from tiiny.host/pricing, November 2026. Their prices may change.

## When Tiiny Host is the better choice

- You want the page on your own domain today.
- You're sharing a PDF, a zip of many files, or anything over 2 MB.
- You need email capture or several team members on one account.

## How to move a page from Tiiny Host to aired

1. Download your HTML file from Tiiny Host, or open the original file on your computer.
2. Drop it in the box above, choose how long the link lasts and add a PIN if you need one.
3. Click **Publish** and send the new link.

For a folder with separate CSS, JavaScript or images, run `npx aired ./folder`. The CLI puts everything into one page for you. See the [CLI docs](https://aired.sh/docs#cli).

## What about Netlify Drop?

Netlify Drop also works without an account, but an anonymous drop is password-protected until you claim it, you get an hour to claim it, and unclaimed drops are deleted. It suits whole sites you plan to keep on Netlify. For a link you can send right away, use aired or read [how to turn an HTML file into a link](https://aired.sh/html-to-link).

## Questions

### Is aired a free alternative to Tiiny Host?

Yes. Publishing, viewing and PIN protection are free, with no email sign-up.

### Can I use my own domain on aired?

Not yet. Pages live at `aired.sh/p/…`. If you need a custom domain today, Tiiny Host offers one on its Solo plan.

### Can I upload a zip file?

The web form takes one HTML file. To publish a folder, run `npx aired ./folder`, which bundles CSS, JavaScript and images into a single page.

### Does aired work with pages made by ChatGPT or Claude?

Yes. Copy the HTML from the chat and paste it in, or connect your AI tool so it can publish for you. See [sharing Claude artifacts](https://aired.sh/share-claude-artifacts).

### Do aired pages expire?

Only if you want them to. The default is 7 days, and you can choose 1 hour, 1 day, 30 days or permanent.

Updated November 2026.
