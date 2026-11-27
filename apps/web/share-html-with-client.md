# Send an HTML page to a client

A report, a dashboard, a landing page mockup or a proposal built with Claude or ChatGPT. Publish it here and send one link that opens on their phone or laptop, with no download and no sign-in.

Source: https://aired.sh/share-html-with-client

## How to send it

1. **Give it a clear title.** The `<title>` is what your client sees in the browser tab and in the Slack or email preview, so make it "Q3 report for Acme", not "index".
2. **Paste or drop the file above.** One HTML page up to 2 MB. Put images in the page, or use `npx aired ./folder` to bundle a folder.
3. **Add a PIN if it's confidential.** Send the PIN in a separate message.
4. **Pick how long it lasts.** 30 days covers most review rounds. Choose permanent for something they'll come back to.
5. **Publish, open the link yourself on your phone, then send it.**

## Why a link beats an attachment

- Company mail filters often block `.html` attachments because they're used in phishing.
- On a phone, an attached HTML file opens as code or a download, not a page.
- You can fix a typo after sending. The client doesn't end up with three versions in their inbox.

## Change it after you send it

Keep the update token shown after you publish: it's a private key for that page. With it, the CLI, the API or your AI agent can replace the page and the link stays the same:

- CLI: `npx aired update <id> report.html`. The CLI saves the token when you publish, so you don't have to paste it.
- Claude Code or Cursor: in the same conversation, ask it to "update the aired page with these changes". See the [docs](https://aired.sh/docs) to connect your agent.

Sign in and your pages are listed in a dashboard, with a view count for each, so you can tell whether the client has opened it.

## How it looks to your client

They see your page exactly as you built it, full screen, in their own browser. Free pages show a small "Shared with aired" badge in the bottom-right corner. Your own domain and no badge are part of the planned [Pro plan](https://aired.sh/pricing).

## Good for

- Monthly SEO, ads or analytics reports
- Landing page and email mockups for sign-off
- Proposals and one-page pitches
- Dashboards built from a spreadsheet with [Claude](https://aired.sh/share-claude-artifacts) or [ChatGPT](https://aired.sh/share-chatgpt-html)

## Questions

### Does my client need an account to open the link?

No. It opens in any browser on any device, and they never need to sign up.

### Can I update the page without sending a new link?

Yes. Keep the update token from the first publish. The CLI, the API or your AI agent can use it to replace the page at the same link.

### Can I tell if the client opened it?

If you publish while signed in, your dashboard shows a view count for each page. Who opened it, and when, is planned for the Pro plan.

### Can I remove the aired badge?

Not yet. Removing it, or replacing it with your logo, is part of the planned Pro plan.

### Is it free?

Yes. Publishing, PINs and viewing are free, and there's no limit on views.

Updated November 2026.
