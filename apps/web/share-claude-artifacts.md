# Share a Claude artifact with anyone

**Ask Claude for one HTML file, publish it here, and send the link.** It opens for anyone, including people who don't use Claude.

Source: https://aired.sh/share-claude-artifacts

## How to do it

1. **Ask Claude for one file** Interactive artifacts often need this to open on their own.
2. **Paste or drop it here** Copy the code, or download the file.
3. **Send the link** It opens in any browser, with no sign-in.

## Two ways to share a Claude artifact

### 1. Claude's own Share button

1. Open the artifact in Claude.
2. Click **Share** and choose who can open it.
3. Copy the link and send it.

Use this when the people you're sharing with also use Claude, or when you want them to make their own copy of the artifact and change it in their own chat.

### 2. Publish the HTML as a link

1. Ask Claude: **"Give me this as a single HTML file."** This matters for interactive artifacts, which Claude often writes as a React component that won't open on its own.
2. Copy the code, or download the file.
3. Paste it in the box above, or drop the file, and click **Publish**.
4. Send the link. It opens in any browser, with no sign-in.

Using Claude Code? Add aired once with `npx skills add progrmoiz/aired -g` and then just say "publish this to aired". Claude Desktop and other apps can connect to `https://aired.sh/mcp`. See the [docs](https://aired.sh/docs) for each setup.

## When Claude's built-in sharing gets in the way

- **It depends on your plan.** Sharing a new artifact by link needs a paid plan. On Team and Enterprise, artifacts stay inside the organization unless an owner allows outside sharing.
- **Some artifacts can't get a public link.** Claude won't share an artifact that connects to other websites with "Anyone with the link".
- **It isn't there outside the Claude apps.** Pages made through the API, Amazon Bedrock, Google Vertex, the Agent SDK (Anthropic's kit for building your own agents) or an automated build have no Share button.
- **Viewers see less.** For people opening the link, the parts that use Claude or connected apps don't work, some content waits for them to sign in, and they can see a notice that the content is user-generated and unverified. That is awkward in front of a client.
- **There's no control over the page.** You can't set an expiry, add a password or put it on your own domain.

## Claude artifacts vs aired

If you're looking for a Claude artifacts alternative for sharing, this is the honest split. Keep building in Claude; use aired for the link.

|  | Claude's Share button | aired |
| --- | --- | --- |
| Who can open the link | Depends on plan and admin settings. Not available on the Free plan | Anyone with the link |
| Viewer needs Claude | Usually not, but some content needs sign-in and an "unverified" notice can show | No |
| Page can load other websites | Then it can't be shared by public link | Yes |
| Works from API, Claude Code, CI | No | Yes, through the CLI, MCP or HTTP API |
| Password | No. Email invites work, but each person needs a Claude account | Optional PIN |
| Expiry | Stays until you unpublish | 1 hour to permanent, your choice |
| Page can call Claude | Yes, but not for people opening a public link | No. Scripts run, but there is no Claude inside |
| Price | Part of your Claude plan | Free |

Claude details from Anthropic's help center article "Share artifacts", November 2026. Claude features change often.

## The same works for ChatGPT and Gemini

ChatGPT and Gemini can write HTML too. ChatGPT replaced Canvas with code blocks in May 2026, so ask it for "one self-contained HTML file" in a code block; Gemini can still build pages in Canvas. Copy the code and publish it the same way. See [share HTML from ChatGPT](https://aired.sh/share-chatgpt-html).

## Questions

### Can I share a Claude artifact with someone who doesn't use Claude?

Yes. Ask Claude for the artifact as a single HTML file, publish it on aired and send the link. It opens in any browser without a Claude account.

### Why is my copied artifact a blank page?

Interactive artifacts are often React components, which need a build step to run. Ask Claude to "rewrite this as one self-contained HTML file" and publish that instead.

### Can Claude publish the artifact for me?

Yes. In Claude Code, install the aired skill with `npx skills add progrmoiz/aired -g`. In apps that support MCP (the standard way to plug tools into AI apps), add `https://aired.sh/mcp`. Then ask Claude to publish to aired.

### Can I password-protect a shared artifact?

Yes. Add a PIN before you publish. Visitors type it before the page loads.

### How long does the link last?

Seven days by default. You can choose 1 hour, 1 day, 30 days or permanent.

### Is it free?

Yes. aired is free and open source.
