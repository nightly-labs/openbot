CREATE TABLE IF NOT EXISTS account_active_days (
  day TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (day, account_id)
);
