export const FEEDBACK_DAILY_LIMIT = 10;

export const DELETE_EARLIER_FEEDBACK_DAYS = "DELETE FROM feedback_daily_counts WHERE user_id = ? AND day < ?";

export const COUNT_FEEDBACK = `INSERT INTO feedback_daily_counts(user_id, day, count) VALUES (?, ?, 1)
  ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1 WHERE count < ?
  RETURNING count`;

export const UNCOUNT_FEEDBACK =
  "UPDATE feedback_daily_counts SET count = count - 1 WHERE user_id = ? AND day = ? AND count > 0";
