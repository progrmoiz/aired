# Password-protect an HTML page

Paste the HTML or drop the file, type a PIN in the box below and publish. Anyone who opens the link has to enter the PIN before the page loads. No code, no server and no account.

Source: https://aired.sh/password-protect-html

## How to put a password on an HTML page

1. **Add the page.** Paste the code or drop the `.html` file on the box above.
2. **Type a PIN.** Use the PIN field next to the expiry. Up to 20 characters; longer is harder to guess.
3. **Choose how long it lasts.** 7 days by default, or anything from 1 hour to permanent.
4. **Publish and send the link and the PIN separately.** For example, the link by email and the PIN by text message.

Visitors see a short PIN screen first. After the right PIN, the page opens and stays open in that browser for an hour.

## Why a JavaScript password doesn't protect anything

Most tutorials for "password protect HTML" add a script that asks for a password and then shows the page. The page itself is still in the file. Anyone can open the source, or turn off JavaScript, and read it.

On aired the check happens on the server. Until the PIN is right, the browser never receives your HTML, so there is nothing in the source to find.

## Ways to password-protect HTML, compared

| Method | Really hides the page | Setup | Cost |
| --- | --- | --- | --- |
| aired PIN | Yes, checked on the server | Type a PIN, publish | Free |
| JavaScript prompt in the page | No, the content is in the source | Paste a script | Free |
| StatiCrypt, a free tool that encrypts the file | Yes, the file is encrypted | Run a command, then host the file somewhere | Free, open source |
| A password on your own web server (.htaccess) | Yes | A web server you manage | Your hosting |
| [Tiiny Host](https://aired.sh/tiiny-host-alternative) | Yes | Sign up, upload | Solo plan, $13/mo billed yearly |

Tiiny Host price from tiiny.host/pricing, November 2026.

## Add a PIN from the command line or an AI agent

The same PIN works everywhere you can publish:

- CLI: `npx aired report.html --pin 4821`
- API: send `"pin": "4821"` with `POST /api/publish`
- Claude Code, Cursor and other agents: ask to "publish this to aired with a PIN". See the [docs](https://aired.sh/docs) to connect them.

With the CLI or API you can also set a view limit, so the link stops working after a set number of opens.

## What a PIN doesn't do

- **It's one PIN for everyone.** Anyone you forward it to can open the page. To cut off access, delete the page or publish a new one with a new PIN. To let in only certain people, each with their own email code, [share with named people](https://aired.sh/share-html-privately) instead.
- **It isn't for regulated data.** Don't publish medical, financial or personal records on any public link service, PIN or not.

More options for keeping a page between you and a few people are in [share HTML privately](https://aired.sh/share-html-privately).

## Questions

### Can I password-protect an HTML file for free?

Yes. Add a PIN when you publish on aired. Publishing, PINs and viewing are free, with no account.

### Is a PIN on aired the same as a password?

It works like one: any text up to 20 characters. It's shared by everyone who has the link, rather than one password per person.

### Can someone read the page without the PIN by viewing the source?

No. aired checks the PIN on the server and only sends the page after it's right.

### Can I change the PIN later?

Publish the page again with a new PIN and send the new link. Delete the old page with its update token (the private key you got when you published), or from your dashboard if you were signed in.

### Will Google index a password-protected page?

No. Search engines can't type the PIN, so they never see the page. Pages published without an account also tell search engines not to list them.

Updated November 2026.
