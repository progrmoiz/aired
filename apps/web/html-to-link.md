# Turn an HTML file into a link

Paste the code or drop the `.html` file. You get a link to send by email, Slack or WhatsApp. The person who opens it sees the page, not the code, and they don't need an account.

Source: https://aired.sh/html-to-link

## How to share an HTML file as a link

1. **Get the HTML.** Drop the file on the box above, or copy the code from Claude, ChatGPT, Gemini or your editor and paste it in.
2. **Pick how long it lasts.** Links last 7 days unless you change it. Choose 1 hour for something quick, or permanent for a page you want to keep.
3. **Add a PIN if it's private.** Visitors then type the PIN before they see the page.
4. **Publish and send.** Copy the link and share it. It opens on any phone or computer.

Keep the update token shown after you publish. It's a private key for that page: with it you can replace or delete the page later. If you [sign in with GitHub](https://aired.sh/auth/login?return=/dashboard), your pages are also listed in a dashboard where you can see views and delete them.

## Why emailing the .html file doesn't work

An HTML file is a web page that needs a browser to open it. Sent as an attachment it often goes wrong:

- Phones and email apps show it as code or a download, not a page.
- Many company mail filters block `.html` attachments because they are used in phishing.
- Images, styles and scripts kept in separate files don't come along, so the page looks broken.

A link avoids all three. The page loads in their browser exactly as you built it.

## Ways to share HTML, compared

| Option | Account needed | Time to a link | Good for |
| --- | --- | --- | --- |
| aired | No | Seconds | One page from an AI tool or your editor, sent to anyone |
| Google Drive or Dropbox | Yes | A minute | Sending the file itself. Drive shows the code, not the page |
| Netlify Drop | To keep it | A minute | Whole folders that you plan to keep as a site |
| GitHub Pages | Yes | 10+ minutes | Developers who already use Git |
| [Tiiny Host](https://aired.sh/tiiny-host-alternative) | Email sign-up | A minute | Small sites with a custom domain on a paid plan |

## What you can publish

- Reports and dashboards you made for a client or your team
- Pages, slides and one-pagers built by [Claude](https://aired.sh/share-claude-artifacts), ChatGPT or Gemini
- Browser games, quizzes and small tools
- Landing pages and menus for a small business
- Email templates you want someone to preview

Each publish is one HTML page up to 2 MB. Put images in the page itself, or use the [command-line tool](https://aired.sh/docs#cli) to bundle a whole folder: `npx aired ./my-site`.

## Questions

### Is it free to turn HTML into a link?

Yes. Publishing and viewing are free, and you don't need an account.

### How long does the link last?

Seven days by default. You can pick 1 hour, 1 day, 30 days or permanent before you publish.

### Can I change the page after I share the link?

Yes. Keep the update token you get after publishing. With it, the aired CLI, the API or your AI agent can replace the page and the link stays the same.

### Can I keep the page private?

Add a PIN and only people who know it can open the page. Pages published without an account are also hidden from search engines.

### Does the link work on phones?

Yes. It is a normal web page, so it opens in any browser on any phone, tablet or computer.

### My page uses separate CSS, JavaScript or image files. Will it work?

Put everything in one HTML file, or publish the folder with `npx aired ./folder`, which puts the styles, scripts and images inside the page for you.

Updated November 2026.
