import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord } from "./runtime-values";

// Migration 54: one thread for each routine of an agent.
export const V54_AGENT_THREAD_ROUTINE_INDEX_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS agent_threads_routine ON projection_agent_threads(agent_id, routine_id)
    WHERE routine_id IS NOT NULL;
`;

// Migration 54. The routine link, added with no default: no rebuild, no data change, and every existing
// thread gets null, which is a thread of no routine.
const V54_AGENT_THREAD_ROUTINE_COLUMN_SQL = "routine_id TEXT";

// Migration 54 links a side thread to the routine whose runs go to it.
function addAgentThreadRoutine(db: DatabaseSync): void {
  // A development profile that ran this version before it shipped has the column already.
  const columns = db.prepare("PRAGMA table_info(projection_agent_threads)").all();
  if (!columns.some((existing) => isDynamicRecord(existing) && existing.name === "routine_id"))
    db.exec(`ALTER TABLE projection_agent_threads ADD COLUMN ${V54_AGENT_THREAD_ROUTINE_COLUMN_SQL}`);
  db.exec(V54_AGENT_THREAD_ROUTINE_INDEX_SQL);
}

export const migration: OpenBotMigration = {
  version: 54,
  name: "agent-thread-routine",
  // Adds one column with no default and an index: no rebuild, so no foreign-key pause and no vacuum.
  // Every existing thread gets null, which is a thread of no routine, as it was before.
  up: addAgentThreadRoutine,
};
