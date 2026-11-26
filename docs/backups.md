# Backups and restore

What is backed up, where it lives, how long it's kept, and how to put it
back. Code: `apps/worker/src/lib/backup.ts`, `src/lib/backup-bindings.ts`
and `scripts/backup-restore.ts`.

## What's covered

| Data | Copy | Kept | Restore with |
|---|---|---|---|
| D1 (`aired`): accounts, identities, billing, API keys, page claims, page shots | D1 Time Travel, built in | 30 days on Workers Paid, 7 on Free | `wrangler d1 time-travel restore` (below) |
| D1, again | Nightly snapshot in the backup bucket | 30 days | `backup-restore.ts prepare`, then `wrangler d1 execute` |
| KV page records, accounts and indexes | Nightly snapshot in the backup bucket | 30 days | `backup-restore.ts prepare`, then `wrangler kv bulk put` |
| R2 page files removed by the expired-page sweep | Copied to `trash/` just before the sweep deletes them | 14 days | `backup-restore.ts untrash` |
| R2 page files otherwise | None. R2 is durable, and only a deliberate delete removes a file | — | — |

KV prefixes in the snapshot (`BACKUP_KV_PREFIXES`): `page:`, `user:`,
`email:`, `ent:`, `svs:`, `projects_by_owner:`, `pages_by_owner:` and
`pages_by_owner_project:`. Everything else in the namespace is short-lived
(sign-in state, device codes, revoked jtis, rate counters) or the MCP OAuth
grant store; after a full KV loss, users reconnect their MCP apps.

D1 tables in the snapshot: every table except `d1_migrations` and
`sweep_candidates`.

Not covered: files a user deletes (gone on purpose), MCP OAuth grants, and
the `stats:live` counter.

## Buckets

| Env | Pages bucket | Backup bucket | D1 |
|---|---|---|---|
| production | `aired-pages` | `aired-backups` | `aired` |
| staging | `aired-pages-staging` | `aired-backups-staging` | `aired-staging` |

The Worker binds the backup bucket as `BACKUP_BUCKET`. Layout:

```
state.json                                    progress of the latest snapshot
snapshots/<YYYY-MM-DD>/kv/<prefix>/<n>.json    KV entries ([{key, value, expiration?}])
snapshots/<YYYY-MM-DD>/d1/<table>/<n>.json     D1 rows ({table, columns, rows})
snapshots/<YYYY-MM-DD>/manifest.json           written last: every file and count
trash/pages/<id>/<file>                         sweep copies
```

A snapshot without `manifest.json` didn't finish. Don't restore from it.

Retention is two lifecycle rules on each backup bucket, not code:

```bash
npx wrangler r2 bucket lifecycle list aired-backups
```

Expected: `snapshots-30d` (prefix `snapshots/`, 30 days) and `trash-14d`
(prefix `trash/`, 14 days). To recreate them:

```bash
npx wrangler r2 bucket lifecycle add aired-backups snapshots-30d snapshots/ --expire-days 30 -y
```

```bash
npx wrangler r2 bucket lifecycle add aired-backups trash-14d trash/ --expire-days 14 -y
```

The privacy policy (`apps/web/privacy.html`, "Backups") states these
windows. Change both together.

## How the nightly snapshot runs

- There's no separate trigger. Every cron run (every 5 minutes in
  production, hourly on staging) does the expired-page sweep, then
  `runBackup`.
- A new snapshot starts once per UTC day, on the first run at or after
  03:00 UTC.
- Each run writes up to 4 chunks of 1,000 entries, then saves its progress
  to `state.json`. Production's ~11k pages plus indexes take a few runs, so
  the snapshot finishes well within the hour.
- A chunk's file name depends only on its position. A run cut short just
  writes the same chunk again on the next run.
- Logs: `backup_started`, `backup_step` and `backup_done` (with counts per
  prefix and table). `backup_stale` is an alert: a snapshot started over
  36 hours ago and still isn't done.

Check the latest one:

```bash
cd apps/worker && node --experimental-strip-types scripts/backup-restore.ts status --env production
```

## The expired-page sweep can't lose a page

The sweep (`lib/expired-sweep.ts`) deletes a page's R2 files once its KV
record has been missing on two runs a day apart. A KV record lost by
mistake looks the same as an expiry. So before deleting, the sweep copies
each file to `trash/` in the backup bucket, and only deletes files whose
copy succeeded. If the backup bucket is missing or failing, the sweep
deletes nothing and logs `expired_sweep_kept_uncopied`.

## D1 Time Travel

Time Travel is always on and covers every write. Retention depends on the
Workers plan: 30 days on Paid, 7 days on Free. Wrangler refuses
timestamps older than 30 days.

Status on 2026-11-27: the production database `aired` was created on
2026-11-25 13:24 UTC, so restore points only go back to then. Which plan the
account is on isn't confirmed. Check under Workers & Pages > Plans in the
dashboard. On Free, the nightly D1 snapshot is the only copy older than 7
days.

```bash
npx wrangler d1 time-travel info aired --timestamp=2026-11-27T03:00:00Z
```

That prints the bookmark for the moment you name. Restoring **overwrites
the whole database** with its state at that point, and every write since is
lost. It prints a bookmark you can restore to undo the restore:

```bash
npx wrangler d1 time-travel restore aired --bookmark=<bookmark>
```

Try it on staging first (`aired-staging`, `--env staging`).

## Restore steps

Rehearse on staging before touching production. Every command below runs
from `apps/worker`. Add `--env staging` to wrangler commands for staging.

### One page the sweep removed

```bash
node --experimental-strip-types scripts/backup-restore.ts untrash --env production --id <pageId>
```

That copies `index.html`, `shot.jpg` and `tile.jpg` back from `trash/`. The
page also needs its KV `page:<id>` record. Take it from the last snapshot
that has it, in `kv/page/*.json`, and put it back with
`wrangler kv key put`. Leave out `expiration` (or set it in the future),
or KV drops the page again.

### KV lost or corrupted

1. Pause the sweep, which would read missing records as expiries: set
   `crons = []` under `[triggers]` and deploy. The `trash/` copies cover
   you if you can't.
2. Download the newest finished snapshot and prepare it:
   ```bash
   node --experimental-strip-types scripts/backup-restore.ts download --env production --date 2026-11-27 --out ../../restore
   ```
   ```bash
   node --experimental-strip-types scripts/backup-restore.ts prepare --dir ../../restore
   ```
   `prepare` drops entries that have already expired, and writes
   `kv-bulk-<n>.json` files of up to 10,000 entries each.
3. Run the `wrangler kv bulk put ... --binding PAGES_KV --remote` lines it
   prints. Bulk put overwrites keys that exist, so pages updated since the
   snapshot go back to their snapshot state. Restore only the prefixes you
   lost by trimming the files first if KV is only partly gone.
4. Put the cron back and deploy.

Anything published after the snapshot has R2 files but no KV record. Find
them by listing `pages/` in R2 against the restored records.

### D1 lost or corrupted

1. Use Time Travel (above) if the damage is inside its window. It's exact
   to the minute.
2. Otherwise, use the snapshot. Apply the migrations to an empty database,
   then load the rows:
   ```bash
   npx wrangler d1 migrations apply aired --remote
   ```
   ```bash
   npx wrangler d1 execute aired --remote --file ../../restore/d1-restore.sql
   ```
   The file is `INSERT OR REPLACE` throughout, so it can also run over a
   database that still has some rows. Rows written since the snapshot are
   left alone; rows deleted since come back.

Delete the restore folder when you're done. It holds account emails.

## Restore drill

Once a month, on staging:
1. `status --env staging`, to check a snapshot finished last night.
2. `download` and `prepare` it.
3. `wrangler d1 execute aired-staging --env staging --remote --file .../d1-restore.sql`.
4. Check that the dashboard still lists the same pages.
