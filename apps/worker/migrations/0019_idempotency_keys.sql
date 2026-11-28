-- Idempotency-Key on POST /api/publish (lib/idempotency.ts). A retry with
-- the same key, from the same account (or anonymous network), with the same
-- body, within 24 hours answers the first response instead of making a
-- second page. In D1 rather than KV: the first request's reservation must
-- be seen by a retry a second later on any isolate, and KV can take up to a
-- minute to show a write elsewhere; D1 also keeps these writes clear of KV's
-- daily write limit.
--
-- key_hash: SHA-256 of who sent it and the key, so the key itself isn't
-- stored. body_hash: SHA-256 of the request body. status and response: the
-- first answer (2xx only), the response AES-GCM encrypted with a key derived
-- from the Idempotency-Key, so the update token in it can't be read from D1
-- alone; both NULL while the first request is still running. created_at:
-- unix ms. The cron deletes rows older than 24 hours (index.ts runHousekeeping).
CREATE TABLE idempotency_keys (
  key_hash TEXT PRIMARY KEY,
  body_hash TEXT NOT NULL,
  status INTEGER,
  response TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idempotency_keys_created ON idempotency_keys (created_at);
