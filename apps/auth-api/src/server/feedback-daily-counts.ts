/** The feedback issues that one account can open in a UTC day. */
export const FEEDBACK_DAILY_LIMIT = 10;

/** Deletes the counts of the earlier days of an account. Binds the account ID and the UTC day. */
export const DELETE_EARLIER_FEEDBACK_DAYS = "DELETE FROM feedback_daily_counts WHERE user_id = ? AND day < ?";

/**
 * Counts one issue and checks the limit in one statement, so two requests at the same time cannot both
 * pass it. Binds the account ID, the UTC day and the limit. It returns no row when the account is at the limit.
 */
export const COUNT_FEEDBACK = `INSERT INTO feedback_daily_counts(user_id, day, count) VALUES (?, ?, 1)
  ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1 WHERE count < ?
  RETURNING count`;

/** Takes back the count of an issue that did not open. Binds the account ID and the UTC day. */
export const UNCOUNT_FEEDBACK =
  "UPDATE feedback_daily_counts SET count = count - 1 WHERE user_id = ? AND day = ? AND count > 0";
