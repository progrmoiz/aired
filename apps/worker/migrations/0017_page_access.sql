-- "Only these people": a page its owner shares with named emails and whole
-- domains (lib/access-list.ts). A visitor types their email, gets a one-time
-- code by email, and a signed cookie for that page (routes/access.ts).
--
-- pages.access: NULL for a public or PIN page, 'people' for one only the
-- listed people may open. It's on the row, not only in page_access, because
-- every KV cache record is rebuilt from the row (metadataFromRow): the flag
-- can't get lost in a rebuild and leave the page public. A 'people' page
-- with no list lets nobody in but its owner.
ALTER TABLE pages ADD COLUMN access TEXT;

-- Who may open it: one row per entry, lowercased. 'alice@client.com' is one
-- person; '@client.com' is everyone at that domain (exact domain, not its
-- subdomains). owner_id so account deletion can remove them in its batch.
CREATE TABLE page_access (
  page_id TEXT NOT NULL,
  entry TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (page_id, entry)
) WITHOUT ROWID;
CREATE INDEX page_access_owner ON page_access (owner_id);

-- One live code per page and email. email_key is an HMAC of the email
-- (lib/access-code.ts), so the table never holds the address; code_hash an
-- HMAC of the code. attempts counts tries, reserved before the check, so
-- parallel guesses can't pass the cap. A right code deletes the row: single
-- use. Unix ms. Hourly housekeeping deletes rows past expires_at.
CREATE TABLE access_codes (
  page_id TEXT NOT NULL,
  email_key TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (page_id, email_key)
) WITHOUT ROWID;
CREATE INDEX access_codes_expires ON access_codes (expires_at);

-- Which listed people opened the page, for its owner only: first and last
-- open and how many times. Never shown publicly. Deleted with the page and
-- with the owner's account.
CREATE TABLE access_log (
  page_id TEXT NOT NULL,
  email TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  views INTEGER NOT NULL,
  PRIMARY KEY (page_id, email)
) WITHOUT ROWID;
CREATE INDEX access_log_owner ON access_log (owner_id);
