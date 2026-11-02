import type { OpenBotDatabase } from "../openbot-database";

/**
 * Runs `work` in one SQLite transaction. Inside a transaction that is open already, such as a run
 * start that also keeps its version and its first steps, it runs in that one, as `dispatch` does.
 */
export function workflowTransaction<T>(database: OpenBotDatabase, work: () => T): T {
  const db = database.connection;
  const owns = !db.isTransaction;
  if (owns) db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    if (owns) db.exec("COMMIT");
    return result;
  } catch (error) {
    // SQLite may have rolled back already, and a second ROLLBACK would replace the error that did it.
    if (owns && db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
