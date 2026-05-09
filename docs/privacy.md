# privacy

## what we store

- GitHub numeric user id (your permanent GitHub identity, stable across renames)
- GitHub login (username)
- Display name (if set on your GitHub profile)
- Primary email — only if your GitHub account has a verified primary email that is not a GitHub-generated noreply address. If your email is private or noreply, we store null.

We never see your password. Authentication is delegated entirely to GitHub.

## what we do not request

OAuth scopes are limited to `read:user` and `user:email`. We do not request any repository, organization, gist, or write scope of any kind.

## session storage

**Web:** Session is a signed JWT stored in an HttpOnly, Secure, SameSite=Lax cookie on `aired.sh`. It is not accessible from JavaScript.

**CLI:** Session is stored in `~/.config/aired/session.json`, created with mode `0o600` (owner-read-only). Other users on the same machine cannot read it.

Sessions expire after 30 days of inactivity.

## account deletion

Send a `DELETE /api/me` request (authenticated). This will:

1. Revoke your current session immediately.
2. Delete your user record and email index.
3. Null out the `ownerId` field on any pages you published — they survive as anonymous pages.

There is no undo.

## github noreply addresses

GitHub generates a noreply email address (e.g. `12345+user@users.noreply.github.com`) for accounts with private email settings. We detect this pattern and store `null` in place of the noreply address, even if GitHub returns it.

## data requests

Contact moiz@webfx.com for data access, correction, or deletion requests.
