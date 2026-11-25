-- One Stripe customer per user, saved before the first Checkout so a second
-- checkout reuses it instead of creating another customer and subscription.
CREATE TABLE billing_customers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  customer_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
