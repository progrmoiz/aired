# Observability

How to see what the Worker is doing in production, and which log events
should wake someone up.

## What's in place

- **Workers Logs** (`[observability]` in `apps/worker/wrangler.toml`). All
  requests are kept (`head_sampling_rate = 1`). Find them in the dashboard
  under Workers & Pages > aired > Logs.
- **Structured log lines** (`apps/worker/src/lib/log.ts`). Each line is an
  object with `level`, `event` and, inside a request, `requestId`. Workers
  Logs indexes the fields, so you can filter by `event = "billing_webhook_failed"`
  or by one request's id.
- **Request id** (`middleware/request-id.ts`). This is Cloudflare's Ray ID
  when there is one, otherwise a UUID. It's returned in the `X-Request-Id`
  response header. When a user reports an error, ask for that header and
  search the logs for it.
- **`GET /health`**. It reads one KV key, runs `SELECT 1` on D1 and heads
  one R2 object, all at once with a 3-second timeout.
  - It answers `200 {"status":"ok","checks":{...}}` when all three pass.
  - It answers `503 {"status":"degraded",...}` when any fails, and logs
    `health_check_failed` with the error text. The error text isn't shown
    in the public body.
  - Results are reused for 10 seconds per isolate.
- **Error capture**.
  - `onError` logs `unhandled_error` with the method and path. It leaves
    out the query string, which can carry tokens.
  - The cron handler logs `scheduled_failed` with the cron expression, then
    rethrows so Cloudflare still marks the run as failed.

Many older log lines are still plain `console.*` calls without a request
id. Workers Logs keeps them all the same, grouped under their request.
Move them to `log()` as those files are next touched.

## Events that should alert

These are listed in `ALERT_EVENTS` in `lib/log.ts`. A test fails if one
stops being logged or goes missing from this page.

| Event | Means | Act |
|---|---|---|
| `billing_webhook_failed` | A Stripe webhook threw. Stripe retries for up to 3 days, but a subscription change may be stuck. | Check the log's `eventId` in Stripe and the error. Once fixed, resend it from the Stripe dashboard. |
| `unhandled_error` | Some route returned a 500. | Read the stack, then find the request by `requestId`. |
| `scheduled_failed` | A cron job threw: `job` is `expired_sweep` or `backup`. One failing doesn't stop the other. | Check D1 and R2. The sweep picks up from its saved cursor next run; the backup from `state.json`. |
| `backup_stale` | Tonight's backup snapshot started over 36 hours ago and hasn't finished. | Look for `scheduled_failed` with `job: "backup"`. See `docs/backups.md`. |
| `health_check_failed` | KV, D1 or R2 failed a probe. | Check the Cloudflare status page and the failing binding. |

These are worth a daily look but shouldn't page anyone:
- `billing_webhook_uid_mismatch`, `billing_webhook_no_uid` and
  `billing_misconfigured`
- `expired_sweep_kv_error`
- `expired_sweep_copy_failed`, `expired_sweep_kept_uncopied` and
  `expired_sweep_preserve_failed` (the sweep kept a file it couldn't back up)
- `backup_unconfigured` (no `BACKUP_BUCKET` binding: no backups, and the
  sweep deletes nothing)
- `burst_limit_error`
- `og_shot_failed`

## Owner setup (Cloudflare dashboard)

1. **Deploy once** with this config. Workers Logs starts collecting
   immediately.
2. **Alert on each event above.**
   - Go to Alerts > Monitors > Create a Monitor and pick the Workers Logs
     dataset.
   - Set it up as follows:
     - **Metric:** COUNT.
     - **Filters:** Worker = `aired` and `event` = the event name.
     - **Window:** 15 minutes.
     - **Threshold:** greater than 0.
     - **Destination:** email, or a webhook to Slack or Discord.
   - Use the preview to check the filter matches before saving.
   - Custom monitors are in beta, and which datasets you can use depends on
     the plan.
   - If Workers Logs isn't offered as a dataset, use Issues (step 3).
3. **Cloudflare Issues (open beta, free, no new account).**
   - Issues groups uncaught exceptions, 5xx responses and `console.error`
     lines that carry a stack trace. That covers every `logError` call.
   - It needs **wrangler 4.134.0 or later**, and the repo pins 4.161.0.
   - It is on in `wrangler.toml`:
     ```toml
     [observability.issues]
     enabled = true
     ```
   - The setting must be in the config: a deploy without it turns Issues
     off again.
   - Then, on the Issues page, add an automation with occurrence threshold
     1 that sends to email or a webhook.
   - This replaces Sentry, so there's no extra account.
4. **Uptime monitor on `/health`.** Use any external checker (Better Stack,
   UptimeRobot or similar; all have free plans). Check
   `https://aired.sh/health` every 1–5 minutes and alert on any non-200.
   That catches the case where the Worker itself is down, which no
   Worker-side log can report.

## Limits and cost

- **Until 1 Dec 2026:**
  - Free: 200,000 log events a day, kept 3 days.
  - Paid: 20M a month included, then $0.60 per million, kept 7 days.
- **From 1 Dec 2026, billing goes by volume:**
  - Free: 0.5 GB ingested a day, kept 7 days.
  - Paid: 50 GB ingested and 10 GB-month stored per cycle, then
    $0.25/GB ingested and $0.10/GB-month stored.
- Each request writes one invocation log plus its own lines, which are
  small objects.
- Check the account's plan; the audit couldn't confirm it.
- If volume grows, lower `head_sampling_rate`. Sampling drops whole
  requests, errors included, so below 1 the alerts above can miss events.
