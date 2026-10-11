CREATE TABLE email_budget (
  budget_key TEXT PRIMARY KEY,
  used INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX email_budget_expiry ON email_budget(expires_at);
