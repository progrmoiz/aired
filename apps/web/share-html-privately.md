# Share an HTML page privately

**Add a PIN, pick a short expiry, or list exactly who may open the page.** Nobody else can find it or read it.

Source: https://aired.sh/share-html-privately

## How to do it

1. **Add a PIN** Checked on the server, before the page loads.
2. **Set when it ends** A time limit, a view limit, or both.
3. **Or name the people** Each person gets a one-time code by email.

## Five settings that keep a page private

1. **A PIN.** Type one before you publish. The page doesn't load until it's entered, and the check happens on the server. See [password-protect an HTML page](https://aired.sh/password-protect-html).
2. **Only these people.** Signed in, list the email addresses that may open it. Each person gets a one-time code by email, so a forwarded link doesn't let anyone else in. See [below](https://aired.sh/share-html-privately#named).
3. **A short life.** Pick 1 hour or 1 day for something quick. The link stops working when the time is up.
4. **A view limit.** With the CLI or the API, add `--reads 5` or `"reads": 5` and the page is gone after five opens.
5. **Delete it yourself.** Keep the update token from the result (a private key for that page), or sign in so your pages are listed in a dashboard where you can delete them.

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

Sign in and list who may open a page: email addresses, and on Pro whole company domains like `@client.com`. This is what each person does:

1. They open the link and type their email.
2. aired emails them a 6-digit code. It works once, for 10 minutes.
3. They type the code and the page opens. That browser stays let in for 30 days.

They don't need an aired account or a password. Someone the link is forwarded to can't get in, because the code only goes to a listed address, and the page never says who is on the list. Take a person off the list and they're locked out. Webmail domains like `@gmail.com` can't be listed whole, because that would let anyone in.

Your dashboard shows each person who opened the page, with when they first and last did. Free allows 3 people per page; Pro allows 500 people and 25 domains.

Set it in your dashboard's Share view, or from the command line with `aired set <id> --only alice@client.com,@client.com`. An AI app connected to aired can set it for you too. See the [docs](https://aired.sh/docs) for the details.

### PIN or named people?

|  | PIN | Only these people |
| --- | --- | --- |
| Who gets in | Anyone you give the link and the PIN | Only the emails and domains you list |
| If the link is forwarded | The new person gets in with the PIN | They can't get in |
| What viewers do | Type the PIN | Type their email, then a code from their inbox |
| Do you need an account | No | Yes, a free one |
| See who opened it | A view count, signed in | Each person, and when |
| Limit | None | Free: 3 people a page. Pro: 500 people and 25 domains |

A page uses one or the other: choosing named people replaces the PIN.

## Questions

### Can I share an HTML file so only certain people can see it?

Yes. Sign in, then list their email addresses: each person types their email on the page and gets a one-time code. Free allows 3 people per page; Pro allows 500 people and whole company domains like @client.com. Or add a PIN and send it only to those people.

### Do the people I share with need an aired account?

No. With a PIN, they open the link and type it. With named people, they type their email and the 6-digit code aired sends them. No account, no password.

### Can someone find my page on Google?

Pages published without an account tell search engines not to list them, and search engines can't get past a PIN. aired doesn't list pages publicly.

### How do I stop people opening a link I already sent?

Delete the page with its update token, or from your dashboard if you published while signed in. The link stops working at once.

### Can I see who opened it?

With named people, yes: your dashboard lists each person who opened the page, and when. For other pages, signed-in users see a view count.

### Can I use a PIN and named people together?

No. A page has one or the other. Choosing named people replaces the PIN, and making the page public again opens it to anyone with the link.
