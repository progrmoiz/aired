# Pages in D1

D1 `pages` (`apps/worker/migrations/0010_pages.sql`) is the source of truth
for every page's facts, owner and update token. Code:
`src/lib/pages-store.ts` (queries), `src/lib/page-write.ts` (the one
create, update, delete and lookup every route uses) and
`src/lib/pages-backfill.ts`.

## Where each fact lives now

| Fact | Source of truth | Copies |
|---|---|---|
| Owner, update token, claim | `pages` row | KV `page:<id>` (viewer badge and indexing). `page_claims` is retired: read for old pages with no row, never written |
| Title, size, expiry, PIN, view limit, project | `pages` row | KV `page:<id>` |
| The owner's page list and project counts | queries on `pages` | — (the KV `pages_by_owner:`, `pages_by_owner_project:` and `projects_by_owner:` indexes are retired; see the end) |
| View count | KV `page:<id>` | — (WP9 moves it) |
| HTML | R2 `pages/<id>/index.html` | — |

- **Writes.**
  - Create writes the row, then R2, then the KV record. A failure undoes
    the others.
  - Update writes the row first, then R2, then the KV record rebuilt from
    the row. It then reads the row again: if a delete marked it meanwhile,
    the update removes what it wrote; if a claim changed it, the KV record
    is rebuilt.
  - Delete marks the row deleted first, so no token works from then on,
    then removes R2 and KV, retrying in the background if needed. If the
    mark fails, nothing has changed, and a retry works.
- **Reads.** Publish-update, PUT, DELETE, the anonymous MCP tool, claims,
  previews and tiles all go through `loadPage`. It reads the row, makes it
  from the KV record (and any `page_claims` row) if the page has none yet,
  and treats deleted or expired rows as not found. A D1 error answers 503.
  It never falls back to KV.
- **Viewer.** It still reads only KV `page:<id>`, as its cache.
- **Account deletion.** It releases the account's pages in D1 in the
  same batch that deletes the account rows, so both happen or neither
  does. KV records follow in the background, and the account's keys in
  the retired KV indexes are deleted.
- **Sweep.** The expired-page sweep keeps a file whose page D1 has as live,
  even if KV doesn't.

The KV indexes and `page_claims` are no longer written (see "Retiring the
old copies" at the end).

## Rehearsal

Done on staging on 2026-11-26, before staging was removed:
- Pages were seeded through the old code: owned pages, anonymous pages,
  claims, deletes, and a claimed page whose KV record was written back
  stale.
- The dry run counted them exactly. Applying it inserted every page, and a
  second run inserted 0.
- Dashboard lists and project counts were identical before and after.
- 28 end-to-end checks passed: token, owner, claim, MCP, delete and
  tombstone paths.

To rehearse again without staging, run `pnpm dev` (local KV and D1), seed
pages through the API, and use `--origin http://localhost:8787`. Set
`ADMIN_TOKEN` in `.dev.vars` first.

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

This section is about rolling back past the pages-in-D1 release itself.
Since the old copies were retired (below), that also needs the old copies
rebuilt, so treat it as a last resort.

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
  - Deletions, claims, claim retries and account deletions are not. Run
    this once after the redeploy, in this order:
    ```sql
    -- Claims made under the old code.
    UPDATE pages SET owner_id = c.owner_id, token_hash = c.token_hash, prev_token_hash = c.prev_token_hash, claimed_at = c.claimed_at
    FROM page_claims c WHERE c.page_id = pages.id AND c.claimed_at > coalesce(pages.claimed_at, 0) AND c.token_hash <> 'deleted';
    -- Token reissues (same owner, new token).
    UPDATE pages SET token_hash = c.token_hash
    FROM page_claims c WHERE c.page_id = pages.id AND c.owner_id = pages.owner_id AND c.token_hash <> pages.token_hash AND c.token_hash <> 'deleted';
    -- Account deletions (claims released).
    UPDATE pages SET owner_id = NULL
    FROM page_claims c WHERE c.page_id = pages.id AND c.owner_id IS NULL AND pages.owner_id IS NOT NULL AND c.token_hash <> 'deleted';
    -- Deletions.
    UPDATE pages SET deleted_at = c.claimed_at, token_hash = 'deleted'
    FROM page_claims c WHERE c.page_id = pages.id AND c.token_hash = 'deleted' AND pages.deleted_at IS NULL;
    -- Pages that were never claimed but whose account was deleted under the old code.
    UPDATE pages SET owner_id = NULL WHERE owner_id IS NOT NULL AND owner_id NOT IN (SELECT id FROM users);
    ```
    The last statement relies on D1 `users` holding every account. Check
    that first: `SELECT count(*) FROM users` against the number of
    `user:` keys in KV. If D1 is short, skip that statement.

## Retiring the old copies

Done after the pages-in-D1 release had run several releases with no
rollback (branch with the durable limits and API contract, 2026-11-27):

1. **Writes stopped.** Nothing writes the KV indexes (`pages_by_owner:`,
   `pages_by_owner_project:`, `projects_by_owner:`) or `page_claims` any
   more: `indexForOwner`, the index removals in `deletePage`, `mirrorClaim`,
   `tombstoneClaim` on delete and `releaseClaimsForOwner` are gone, and so
   is `src/lib/owner-index.ts`.
2. **Reads left, on purpose.** `resolvePage` still makes a row from KV and
   `page_claims` for a page that somehow has none, and account deletion
   still finds such pages through `page_claims` (read only, `claimedPageIds`)
   and the KV owner index, deleting that account's index keys as it goes.
   Both are harmless and go once the keys below are deleted.
3. **Rollback.** Rolling back one release (to code that dual-wrote) is fine:
   that code already decided from D1 `pages`. Rolling back further, to code
   from before `pages`, would read indexes and claims that stopped changing
   here; don't.
4. **Keep `page_claims`** in D1: dropping a table isn't additive.

### Deleting the old index keys (not run yet)

`apps/worker/scripts/retire-kv-indexes.mjs` lists the keys and prints the
delete commands; it deletes nothing itself. From `apps/worker`, signed in
with `wrangler login`:

1. Check last night's KV snapshot finished (docs/backups.md), so the keys
   are in a backup.
2. List them (read only). It writes the key names as JSON arrays of up to
   10,000 (one `wrangler kv bulk delete` call each) and prints the counts:
   ```bash
   node scripts/retire-kv-indexes.mjs list --out /tmp/aired-retire
   ```
   Expect roughly one `pages_by_owner:` key per owned page made before
   2026-11-27, fewer `pages_by_owner_project:` keys, and one
   `projects_by_owner:` key per account that used projects.
3. Print the delete commands, read them, then run them yourself
   (`wrangler kv bulk delete` asks before deleting):
   ```bash
   node scripts/retire-kv-indexes.mjs delete --out /tmp/aired-retire
   ```
4. Each key deleted is one KV write against the daily limit; spread a big
   run over days if needed.
5. Afterwards, the reads in step 2 above can go: drop the KV index walk in
   account deletion. `page_claims` reads stay until every page is known to
   have a row (`SELECT count(*) FROM page_claims c WHERE NOT EXISTS
   (SELECT 1 FROM pages p WHERE p.id = c.page_id)` is 0).
