-- Durable publish limits (lib/durable-limit.ts). The publish and plan
-- quotas (5 an hour per IP anonymous, 30 an hour signed in, 500 a day on
-- Pro) used to be counted in memory per isolate, so a caller spread across
-- isolates got more. Now each window of each bucket is one row here.
--
-- bucket: the limit's prefix and who it counts (`rl:ip:<ip hash>`,
-- `rl:user:<uid>`, `rl:pro:<uid>`). window_start: unix seconds, a multiple
-- of the window length. A request is counted against this window plus the
-- previous one, weighted by how much of it still overlaps (a sliding
-- window), so a caller can't double up across a window boundary.
-- expires_at: unix seconds after which the row is no longer read; the cron
-- deletes rows past it (index.ts runHousekeeping).
CREATE TABLE rate_limits (
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (bucket, window_start)
) WITHOUT ROWID;

CREATE INDEX rate_limits_expires ON rate_limits (expires_at);

-- billing_events is pruned by the same cron after 30 days (0001 said it could
-- be); this index keeps that delete from scanning the table.
CREATE INDEX billing_events_received ON billing_events (received_at);
