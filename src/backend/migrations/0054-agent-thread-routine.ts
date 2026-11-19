import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord } from "./runtime-values";

export const V54_AGENT_THREAD_ROUTINE_INDEX_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS agent_threads_routine ON projection_agent_threads(agent_id, routine_id)
    WHERE routine_id IS NOT NULL;
`;

const V54_AGENT_THREAD_ROUTINE_COLUMN_SQL = "routine_id TEXT";

function addAgentThreadRoutine(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(projection_agent_threads)").all();
  if (!columns.some((existing) => isDynamicRecord(existing) && existing.name === "routine_id"))
    db.exec(`ALTER TABLE projection_agent_threads ADD COLUMN ${V54_AGENT_THREAD_ROUTINE_COLUMN_SQL}`);
  db.exec(V54_AGENT_THREAD_ROUTINE_INDEX_SQL);
}

export const migration: OpenBotMigration = {
  version: 54,
  name: "agent-thread-routine",
  up: addAgentThreadRoutine,
};
