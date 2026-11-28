# When something goes wrong

API errors are JSON: `{ "error": { "code": "...", "message": "..." } }`. Act on `code`; `message` is for people.

| Status and code | What it means | What to do |
|---|---|---|
| 400 `invalid_input` | A field is missing or past its limit (`field` says which) | Fix that field |
| 400 `invalid_html` | Empty, relative file paths, or too large | Inline the files, or make it smaller |
| 401 `token_required` | No credential, or a bad or revoked API key | Pass the update token, or sign in |
| 402 `plan_limit` | Free can't do this (a page over 2 MB, too many publishes, more live data) | Give the `upgrade_url` to the person |
| 403 `invalid_token` | The update token doesn't match this page | Use the token from this page's publish |
| 403 `not_owner` | Signed in, but it's not your page | Use the page's update token |
| 403 `owner_required` | The page has collected responses, so only its owner can replace or restore it; or a PDF asked for speaker notes with only the update token | Sign in as the owner (`aired login` or `AIRED_API_KEY`), or leave out `notes` |
| 404 `not_found` | No such page, or it expired | Publish again |
| 410 | The page reached its view limit | Raise it with `aired set <id> --reads <n>` or `--clear-reads` |
| 413 `too_large` | The page is too big to turn into a PDF | Make it smaller |
| 413 `payload_too_large` | The request body is too big (21 MB for publish and MCP, 1 MB for other calls; live data has its own limit) | Send less |
| 422 `spam_rejected` | It looks like spam or phishing | Don't retry the same content |
| 429 `rate_limited` | Too many requests | Wait (CLI exit 3); sign in for higher limits |
| 429 `check_budget` | Today's browser time for checks is spent | Try after 00:00 UTC |
| 503 `check_busy` / `unavailable` | Busy for a moment | Retry after `Retry-After` |
| 429 `pdf_budget` | Today's browser time for new PDFs is spent | Try after 00:00 UTC; PDFs made before still download |
| 503 `pdf_busy` | The PDF browser is busy | Retry after `Retry-After` |

## Common problems

- **Blank page after publishing a build:** code-split chunks didn't load. See `bundling.md`.
- **Images or scripts missing:** relative paths. Publish the folder, inline them, or use full URLs. `aired check` lists each failed file.
- **Saved data gone after reload:** the page used `localStorage`, which is in memory only in aired's sandbox. Use `aired.collect` (the `aired-forms` skill).
- **A form does nothing:** pages can't submit forms to a URL. Handle `submit` in JavaScript with `event.preventDefault()` and save with `aired.collect.save`.
- **`sign_in_required` from `aired.collect` or `aired.data`:** the page was published anonymously. Publish it again signed in.
- **Can't update a page:** the token is on another machine, or the page has responses and you're not signed in as its owner.
- **A short expiry became 7 days:** updating a page that expires sets it to 7 days from then. Run `aired set <id> --ttl 24h` again.
