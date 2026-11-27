-- Durable publish limits (lib/durable-limit.ts). The publish and plan
-- quotas (5 an hour per IP anonymous, 30 an hour signed in, 500 a day on
-- Pro) used to be counted in memory per isolate, so a caller spread across
-- isolates got more. Now each bucket's current window is one row here.
--
-- bucket: the limit's prefix and who it counts (`rl:ip:<ip hash>`,
-- `rl:user:<uid>`, `rl:pro:<uid>`). window_start: unix ms of the window's
-- first request. count: requests counted in it. expires_at: unix ms when
-- the window ends; the next request after that starts a new one. The cron
-- deletes rows past it (index.ts runHousekeeping).
CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX rate_limits_expires ON rate_limits (expires_at);

-- billing_events is pruned by the same cron after 30 days (0001 said it could
-- be); this index keeps that delete from scanning the table.
CREATE INDEX billing_events_received ON billing_events (received_at);
