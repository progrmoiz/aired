-- Accounts and billing state. Additive: nothing in KV or R2 changes shape.

-- One row per person. GitHub users are inserted with their GitHub id;
-- everyone else gets an AUTOINCREMENT id starting at 10^12 (seeded below)
-- so the two ranges never collide.
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  name TEXT,
  login TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Make the next AUTOINCREMENT id 1000000000000.
INSERT INTO sqlite_sequence (name, seq) VALUES ('users', 999999999999);

-- Sign-in methods per user (github | google | email).
CREATE TABLE identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
);

CREATE INDEX idx_identities_user_id ON identities (user_id);
CREATE INDEX idx_identities_email ON identities (email);

-- Current billing state, one row per user. Written only by the webhook sync.
CREATE TABLE subscriptions (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  provider TEXT NOT NULL,
  customer_id TEXT NOT NULL UNIQUE,
  subscription_id TEXT UNIQUE,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  interval TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Webhook idempotency; rows older than 30 days can be pruned.
CREATE TABLE billing_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TEXT NOT NULL
);
