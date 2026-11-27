# Password-protect an HTML page

**Add a PIN when you publish.** aired checks it on the server, so nobody sees your page until they type it. Free, with no account and no code.

Source: https://aired.sh/password-protect-html

## How to do it

1. **Drop your page** The file, or the code from Claude, ChatGPT or your editor.
2. **Type a PIN** Up to 20 characters. Longer is harder to guess.
3. **Send them apart** So one forwarded message isn't enough to get in.

## Why a JavaScript password doesn't protect anything

Most tutorials for "password protect HTML" add a script that asks for a password and then shows the page. The page is still inside the file, so anyone can open the source, or turn off JavaScript, and read it.

On aired the check happens on the server. Until the PIN is right, the browser never receives your HTML, so there's nothing in the source to find. After the right PIN, the page stays open in that browser for an hour.

## Ways to password-protect HTML, compared

| Method | Really hides the page | Setup | Cost |
| --- | --- | --- | --- |
| aired PIN | Yes, checked on the server | Type a PIN, publish | Free |
| JavaScript prompt in the page | No, the content is in the source | Paste a script | Free |
| StatiCrypt, a free tool that encrypts the file | Yes, the file is encrypted | Run a command, then host the file somewhere | Free, open source |
| A password on your own web server (.htaccess) | Yes | A web server you manage | Your hosting |
| [Tiiny Host](https://aired.sh/tiiny-host-alternative) | Yes | Sign up, upload | Solo plan, $13/mo billed yearly |

Tiiny Host price from tiiny.host/pricing, November 2026.

## From the command line or an AI agent

The same PIN works everywhere you can publish:

- CLI: `npx aired report.html --pin 4821`
- API: send `"pin": "4821"` with `POST /api/publish`
- Claude Code, Cursor and other agents: ask to "publish this to aired with a PIN". The **Copy page** menu at the top sets them up.

With the CLI or API you can also set a view limit, so the link stops working after a set number of opens.

## What a PIN doesn't do

- **It's one PIN for everyone.** Anyone you forward it to can open the page. To let in only certain people, each with their own email code, [share with named people](https://aired.sh/share-html-privately) instead.
- **It isn't for regulated data.** Don't publish medical, financial or personal records on any public link service, PIN or not.

## Questions

### Can I password-protect an HTML file for free?

Yes. Add a PIN when you publish on aired. Publishing, PINs and viewing are free, with no account.

### Is a PIN on aired the same as a password?

It works like one: any text up to 20 characters. It's shared by everyone who has the link, rather than one password per person.

### Can I change the PIN later?

Publish the page again with a new PIN and send the new link. Delete the old page with its update token (the private key you got when you published), or from your dashboard if you were signed in.

### Will Google index a password-protected page?

No. Search engines can't type the PIN, so they never see the page. Pages published without an account also tell search engines not to list them.
