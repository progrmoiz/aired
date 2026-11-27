# Share an HTML page privately

**Add a PIN, pick a short expiry, or list exactly who may open the page.** Nobody else can find it or read it.

Source: https://aired.sh/share-html-privately

## How to do it

1. **Add a PIN** Checked on the server, before the page loads.
2. **Set when it ends** A time limit, a view limit, or both.
3. **Or name the people** Each person gets a one-time code by email.

## Four settings that keep a page private

1. **A PIN.** Type one before you publish. The page doesn't load until it's entered, and the check happens on the server. See [password-protect an HTML page](https://aired.sh/password-protect-html).
2. **A short life.** Pick 1 hour or 1 day for something quick. The link stops working when the time is up.
3. **A view limit.** With the CLI or the API, add `--reads 5` or `"reads": 5` and the page is gone after five opens.
4. **Delete it yourself.** Keep the update token from the result (a private key for that page), or sign in so your pages are listed in a dashboard where you can delete them.

## What is and isn't public

- **The link is random.** Each page gets an unguessable address like `aired.sh/p/k3J9xQ2mTa`. aired doesn't list pages anywhere for people to browse.
- **Search engines are kept out.** Pages published without an account tell search engines not to list them, and search engines can't get past a PIN at all.
- **Anyone with the link and PIN can open it.** If it's forwarded, the new person gets in too. To stop that, share with named people instead (below).
- **Without a PIN, the title shows in link previews.** Slack, WhatsApp and iMessage show the page title when the link is pasted. With a PIN, they only see the PIN screen.

## Private sharing options, compared

| Option | Viewer needs an account | Shows the page, not the code |
| --- | --- | --- |
| aired with a PIN | No | Yes |
| aired, named people only | No, a one-time code by email | Yes |
| Google Drive, shared with named people | Yes, a Google account | No, Drive shows the code |
| Email attachment | No | Often not; many mail filters block .html files |
| Claude, shared by email invite | Yes, a Claude account | Yes |

## Sharing with named people

Sign in and list who may open a page: email addresses, and on Pro whole company domains like `@client.com`. Each person types their email on the page and gets a 6-digit code that works once. They don't need an account, and someone the link is forwarded to can't get in. Free allows 3 people per page; Pro allows 500 people and 25 domains.

Set it in your dashboard's Share view, or from the command line with `aired set <id> --only alice@client.com,@client.com`. Taking someone off the list locks them out. See the [docs](https://aired.sh/docs) for the details.

## Questions

### Can I share an HTML file so only certain people can see it?

Yes. Sign in, then list their email addresses: each person types their email on the page and gets a one-time code. Free allows 3 people per page; Pro allows 500 people and whole company domains like @client.com. Or add a PIN and send it only to those people.

### Do the people I share with need an aired account?

No. They open the link in any browser and type the PIN if there is one.

### Can someone find my page on Google?

Pages published without an account tell search engines not to list them, and search engines can't get past a PIN. aired doesn't list pages publicly.

### How do I stop people opening a link I already sent?

Delete the page with its update token, or from your dashboard if you published while signed in. The link stops working at once.

### Can I see who opened it?

Signed-in users see a view count for each page. Who opened it, and when, is part of the planned Pro plan.
