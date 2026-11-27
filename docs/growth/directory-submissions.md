# Directory submissions: Claude and ChatGPT

Everything to paste into the two submission forms. The owner submits; both need a paid account.

## Shared listing text

- **Name:** aired
- **Server URL:** `https://aired.sh/mcp/account` (OAuth sign-in, dynamic client registration)
- **Short description:** Turn pages your AI makes into links you can send.
- **Long description:**
  Ask your AI to publish a report, slide deck, dashboard or page and get back a link anyone can open on any device, with no account needed to view it. Add a PIN, set it to expire, update it at the same link, or delete it. Pages land in your aired dashboard so you can find them later.
- **Example prompts (3):**
  1. "Turn this report into a link I can send to my client."
  2. "Publish this page with the PIN 4821 and make it expire in 7 days."
  3. "Update the page you published yesterday with these new numbers."
- **Docs URL:** https://aired.sh/connect (setup) and https://aired.sh/docs#mcp (reference)
- **Privacy policy:** https://aired.sh/privacy
- **Terms:** https://aired.sh/terms
- **Support contact:** support@aired.sh
- **Icon:** export `apps/web/favicon.svg` at the size each portal asks for
- **Category:** productivity / publishing

## Tools (all have a title and read-only or destructive labels)

| Tool | Title | Kind |
| --- | --- | --- |
| publish_html | Publish HTML | write |
| get_page | Get a page | read-only |
| set_options | Change page settings | write |
| list_versions | List a page's versions | read-only |
| restore_version | Restore a page version | write |
| check_page | Check a page in a browser | read-only |
| send_feedback | Send feedback to aired | write |
| list_pages | List your pages | read-only |
| update_page | Update a page | destructive |
| delete_page | Delete a page | destructive |
| get_responses | Read a page's responses | read-only |
| update_data | Push live data to a page | destructive |
| get_account | Get your account | read-only |

## Claude directory

1. Add `https://aired.sh/mcp/account` as a custom connector on a personal Claude account and call each tool once (the form asks you to confirm this).
2. Make a test aired account with a few sample pages. Reviewers ask for test access by email if the listing goes to Verified review. Don't put the password in the portal.
3. Open https://claude.ai/directory/manage → Submit new → MCP connector, paste the text above.
4. Anthropic scans it and lists it as a Community connector. The listing link becomes `https://claude.ai/directory/connectors/<slug>`; swap it into the Add to Claude buttons on /connect, the homepage and docs once live.

Later: submit a plugin bundle (aired skill + this connector) so the skill comes along with one click.

## ChatGPT directory

1. Complete individual or business developer verification in the OpenAI organization settings, so the listing shows your name.
2. Build the plugin ZIP with the server URL above and the aired skill (`apps/cli/SKILL.md`). OpenAI's Plugin Creator in the plugin directory helps with the package format.
3. Upload it on the Plugins page, fix any automated findings, connect and scan the MCP server, then submit for review.
4. Check it works in the ChatGPT phone app before submitting: the guidelines require desktop and mobile.
5. Once live, change the ChatGPT row on /connect from "Coming soon" to a link to the listing.

Sources (read 27 Nov 2026): claude.com/docs/connectors/building/submission, claude.com/docs/connectors/building/review-criteria, developers.openai.com/apps-sdk/deploy/submission, developers.openai.com/apps-sdk/app-submission-guidelines.
