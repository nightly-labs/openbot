import { withTransaction } from "../database/sqlite-transaction";
import type { OpenBotDatabase } from "../openbot-database";

export function workflowTransaction<T>(database: OpenBotDatabase, work: () => T): T {
  return withTransaction(database.connection, work);
}
