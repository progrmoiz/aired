# Share an HTML page privately

For a draft, a client report or anything that isn't for the whole internet. Publish it with a PIN and a short expiry, send the link to the people who need it, and delete it when you're done.

Source: https://aired.sh/share-html-privately

## Four settings that keep a page private

1. **A PIN.** Type one before you publish. The page doesn't load until it's entered, and the check happens on the server. See [password-protect an HTML page](https://aired.sh/password-protect-html).
2. **A short life.** Pick 1 hour or 1 day for something quick. The link stops working when the time is up.
3. **A view limit.** With the CLI or the API, add `--reads 5` or `"reads": 5` and the page is gone after five opens.
4. **Delete it yourself.** Keep the update token from the result (a private key for that page), or sign in so your pages are listed in a dashboard where you can delete them.

## What is and isn't public

- **The link is random.** Each page gets an unguessable address like `aired.sh/p/k3J9xQ2mTa`. aired doesn't list pages anywhere for people to browse.
- **Search engines are kept out.** Pages published without an account tell search engines not to list them, and search engines can't get past a PIN at all.
- **Anyone with the link and PIN can open it.** If it's forwarded, the new person gets in too. That's the trade-off for viewers not needing an account.
- **Without a PIN, the title shows in link previews.** Slack, WhatsApp and iMessage show the page title when the link is pasted. With a PIN, they only see the PIN screen.

## Private sharing options, compared

| Option | Viewer needs an account | Shows the page, not the code |
| --- | --- | --- |
| aired with a PIN | No | Yes |
| Google Drive, shared with named people | Yes, a Google account | No, Drive shows the code |
| Email attachment | No | Often not; many mail filters block .html files |
| Claude, shared by email invite | Yes, a Claude account | Yes |

## Sharing with named people

A page on aired opens for anyone with the link, and the PIN if you set one. aired can't yet limit a page to certain email addresses. If each viewer must sign in, use Google Drive or Claude's email invites from the table above.

## Questions

### Can I share an HTML file so only certain people can see it?

Add a PIN and send it only to those people. The page won't open without it. Sharing by email address is planned for the paid plans.

### Do the people I share with need an aired account?

No. They open the link in any browser and type the PIN if there is one.

### Can someone find my page on Google?

Pages published without an account tell search engines not to list them, and search engines can't get past a PIN. aired doesn't list pages publicly.

### How do I stop people opening a link I already sent?

Delete the page with its update token, or from your dashboard if you published while signed in. The link stops working at once.

### Can I see who opened it?

Signed-in users see a view count for each page. Who opened it, and when, is part of the planned Pro plan.

Updated November 2026.
