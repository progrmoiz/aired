# Pages in D1

D1 `pages` (`apps/worker/migrations/0010_pages.sql`) is the source of truth
for every page's facts, owner and update token. Code:
`src/lib/pages-store.ts` (queries), `src/lib/page-write.ts` (the one
create, update, delete and lookup every route uses) and
`src/lib/pages-backfill.ts`.

## Where each fact lives now

| Fact | Source of truth | Copies |
|---|---|---|
| Owner, update token, claim | `pages` row | KV `page:<id>` (viewer badge and indexing), `page_claims` (kept for a rollback) |
| Title, size, expiry, PIN, view limit, project | `pages` row | KV `page:<id>` |
| The owner's page list and project counts | queries on `pages` | KV `pages_by_owner:`, `pages_by_owner_project:`, `projects_by_owner:` (kept for a rollback) |
| View count | KV `page:<id>` | — (WP9 moves it) |
| HTML | R2 `pages/<id>/index.html` | — |

- **Writes.** Create writes R2, then the row, then the KV record; a failure
  undoes the others. Update writes the row first, then R2, then the KV
  record rebuilt from the row. Delete removes R2 and KV, then marks the row
  deleted; if marking fails, a retry with the same token finishes it.
- **Reads.** Publish-update, PUT, DELETE, the anonymous MCP tool, claims,
  previews and tiles all go through `loadPage`. It reads the row, makes it
  from the KV record (and any `page_claims` row) if the page has none yet,
  and treats deleted or expired rows as not found. A D1 error answers 503.
  It never falls back to KV.
- **Viewer.** It still reads only KV `page:<id>`, as its cache.
- **Account deletion.** It releases the account's pages in D1 in one
  statement, before the account rows are deleted. A failure there leaves
  the account intact to retry. KV records and the old indexes follow in
  the background.
- **Sweep.** The expired-page sweep keeps a file whose page D1 has as live,
  even if KV doesn't.

The KV indexes and `page_claims` are still written, best-effort, so rolling
back the code loses nothing. Nothing reads them for decisions. Retire them
after a release with no rollback (see the end).

## Rollout (production)

Each step is safe to stop after.

1. **Back up first.** WP11 must be live, with last night's snapshot
   finished:
   ```bash
   cd apps/worker && node --experimental-strip-types scripts/backup-restore.ts status --env production
   ```
   Note the D1 Time Travel bookmark too:
   ```bash
   npx wrangler d1 time-travel info aired
   ```
2. **Deploy** from main with `npm run deploy`. `scripts/deploy.sh` applies
   migration 0010 before the code. Old pages keep working right away:
   anything that touches one makes its row first.
   - Until step 4 finishes, the dashboard lists only pages that already
     have a row (new pages, and old ones touched since). Run steps 3 and 4
     straight after the deploy.
3. **Dry run.** Set a one-off admin secret (32+ characters) and run the
   backfill without `--apply`:
   ```bash
   openssl rand -hex 32 | tee /dev/stderr | npx wrangler secret put ADMIN_TOKEN
   ```
   ```bash
   ADMIN_TOKEN=<that value> node --experimental-strip-types scripts/pages-backfill.ts --origin https://aired.sh --out ../../backfill-dry-run.json
   ```
   Check the report:
   - `scanned` is about the KV page count (~11k).
   - `corrupt` is 0 or explained.
   - `toInsert + alreadyInD1 = scanned - corrupt - vanished`.
4. **Apply.** The same command with `--apply`. It's idempotent: run it again
   if it stops, and a second run should report `inserted: 0`.
5. **Check.**
   - A few accounts' dashboards list the same pages as before.
   - Compare row counts:
     ```bash
     npx wrangler d1 execute aired --remote --command "SELECT count(*), sum(owner_id IS NOT NULL), sum(deleted_at IS NOT NULL) FROM pages"
     ```
6. **Remove the secret**, which turns `/api/admin/*` off again:
   ```bash
   npx wrangler secret delete ADMIN_TOKEN
   ```

## Rollback

- `pnpm exec wrangler rollback` restores the previous code. Leave D1 as it
  is: migration 0010 only added a table.
- The old code reads `page_claims` and the KV indexes, which this code kept
  up to date. Pages published, updated, claimed or deleted in between look
  the same to it.
- One gap: a page created after the deploy whose index write failed
  (best-effort, as before) won't be in the old dashboard list.
- To roll forward again, deploy and rerun the backfill. It never
  overwrites a row that exists, so changes the old code made in between to
  pages that already had rows need copying across:
  - Title, size and expiry are rewritten by the page's next update.
  - Deletions and claims are not. Run this once after the redeploy:
    ```sql
    UPDATE pages SET owner_id = c.owner_id, token_hash = c.token_hash, prev_token_hash = c.prev_token_hash, claimed_at = c.claimed_at
    FROM page_claims c WHERE c.page_id = pages.id AND c.claimed_at > coalesce(pages.claimed_at, 0) AND c.token_hash <> 'deleted';
    UPDATE pages SET deleted_at = c.claimed_at, token_hash = 'deleted'
    FROM page_claims c WHERE c.page_id = pages.id AND c.token_hash = 'deleted' AND pages.deleted_at IS NULL;
    ```

## Retiring the old copies (a later change)

After one release with no rollback:
1. Stop writing the KV indexes (`indexForOwner`, and the removals in
   `deletePage`) and `page_claims` (`mirrorClaim`, `tombstoneClaim`,
   `releaseClaimsForOwner`).
2. Drop the account-deletion walk over the KV owner index, and the
   `resolvePage` fallback that reads `page_claims`.
3. Delete the index keys with a one-off script. Keep `page_claims` in D1:
   dropping a table isn't additive.
