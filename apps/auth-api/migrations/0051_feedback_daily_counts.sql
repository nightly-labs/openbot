-- The feedback issues that each account opened on each UTC day (`YYYY-MM-DD`), for the daily limit of
-- `POST /v1/feedback`. It holds no feedback text. The Worker deletes the rows of earlier days of an
-- account when the account sends again. The Worker that runs before this deploy does not read it.
CREATE TABLE feedback_daily_counts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
) WITHOUT ROWID;
