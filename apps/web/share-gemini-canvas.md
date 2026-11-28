# Share a Gemini Canvas page

**Copy the code from Canvas, paste it here, and send the link.** It opens as a normal web page in any browser, with nothing from Gemini around it.

Source: https://aired.sh/share-gemini-canvas

## How to do it

1. **Copy the code** Click Code at the top right of the canvas.
2. **Paste it here** Or drop the file. No account needed.
3. **Send the link** It opens in any browser, on any phone.

## Two ways to share a Gemini Canvas

Canvas is the side panel in Gemini where it writes documents, apps and games you can see working.

### 1. Gemini's own Share button

1. Open the chat with your canvas.
2. At the top right of the Canvas panel, click **Share & export**, then **Share**.
3. Copy the `g.co/gemini/share` link and send it.

Use this when the people you send it to are fine opening it on Gemini's website, or when they should make their own copy and keep changing it with Gemini.

### 2. Publish the code as a link

1. Ask Gemini: **“Make this one self-contained HTML file.”** Gemini sometimes writes apps as React code, which won't open on its own.
2. Click **Code** at the top right of the Canvas panel, select all the code and copy it.
3. Paste it in the box above and click **Publish**.
4. Send the link. It opens in any browser, with no sign-in.

If your app uses Gemini inside it, to write text or make pictures, or saves things between visits, those parts run on Google's side. On aired the page and its scripts work, but there is no Gemini behind it.

## Or let Gemini publish it

You can connect aired to Gemini once, then ask “publish this to aired” and Gemini sends back the link. Gemini calls these custom apps. aired's address is `https://aired.sh/mcp/account`.

1. On **gemini.google.com**, open **Settings**, then **Connected Apps**.
2. Under Custom apps, click **Add a custom app** and paste the address.
3. Click **Next**, then sign in to aired and click **Allow**.

For now Google only offers custom apps to people 18 or over in the US, signed in with a personal Google account and with History turned on. You add it on the website; after that it works in the Gemini phone app too. Step by step: [connect aired to your AI app](https://aired.sh/connect).

## When Gemini's share link gets in the way

- **It opens on Gemini's website.** Google says shared Canvas links open on gemini.google.com, not in the Gemini phone app.
- **Work and school accounts often can't share it.** With Google Workspace, public links are off until an admin turns them on.
- **Anyone with the link can see it.** There's no PIN and no expiry date. The link stays until you delete it.
- **App data comes along.** Google warns that anyone with a public link to an app can view and edit the data saved in it.

## Gemini's Share vs aired

|  | Gemini's Share button | aired |
| --- | --- | --- |
| Where it opens | On gemini.google.com | Any browser, as a plain web page |
| Work or school account | Only if an admin allows public links | Works the same for everyone |
| Private | No. Anyone with the link | Optional PIN, or only the people you name |
| Expiry | Stays until you delete it | 1 hour to permanent, your choice |
| Gemini inside the app | Yes | No. Scripts run, but there is no Gemini behind it |
| Viewer can copy and edit it with Gemini | Yes | No |
| Price | Part of Gemini | Free |

Gemini details from Google's Gemini Apps Help articles on Canvas and custom apps, and the Workspace admin help, November 2026. Gemini features change often.

## The same works for Claude and ChatGPT

Claude and ChatGPT write HTML too. Ask for one self-contained HTML file, copy it and publish it the same way. See [share a Claude artifact](https://aired.sh/share-claude-artifacts) and [share HTML from ChatGPT](https://aired.sh/share-chatgpt-html).

## Questions

### Can I share a Gemini Canvas with someone who doesn't use Gemini?

Yes. Copy the code from Canvas, publish it on aired and send the link. It opens in any browser, without a Google account.

### Why is my published canvas a blank page?

It's probably React code, which needs a build step before a browser can run it. Ask Gemini to “rewrite this as one self-contained HTML file” and publish that instead.

### Why doesn't the AI part of my app work on the link?

Apps that use Gemini inside them, or save things between visits, rely on Google's servers. On aired the page and its scripts run, but there is no Gemini behind it.

### Can Gemini publish to aired for me?

Yes, if your account can add custom apps (18 or over, in the US, personal Google account). Add https://aired.sh/mcp/account in Gemini's Connected Apps settings, then ask Gemini to publish to aired.

### Can I make the link private?

Yes. Add a PIN before you publish, or sign in and list the people who may open it.

### Is it free?

Yes. Publishing and viewing are free.
