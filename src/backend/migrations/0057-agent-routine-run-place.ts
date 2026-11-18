import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord } from "./runtime-values";

// Migration 57 adds where the runs of an agent routine run: in the agent's chat, or in the routine's own
// thread. Frozen with the migration. Every existing routine gets 'chat', as before 0.61. Channel routines
// run in their channel and have no such column. ADD COLUMN puts it after the migration 33 column.
export const V57_AGENT_ROUTINE_RUN_IN_COLUMN_SQL = `run_in TEXT NOT NULL DEFAULT 'chat' CHECK(run_in IN ('chat', 'thread'))`;

// Migration 57 adds where the runs of an agent routine run.
function addAgentRoutineRunPlace(db: DatabaseSync): void {
  // A development profile that ran this version before it shipped has the column already.
  const columns = db.prepare("PRAGMA table_info(projection_agent_routines)").all();
  if (columns.some((existing) => isDynamicRecord(existing) && existing.name === "run_in")) return;
  db.exec(`ALTER TABLE projection_agent_routines ADD COLUMN ${V57_AGENT_ROUTINE_RUN_IN_COLUMN_SQL}`);
}

export const migration: OpenBotMigration = {
  version: 57,
  name: "agent-routine-run-place",
  // Adds one column with a constant default: no rebuild, so no foreign-key pause and no vacuum. Every
  // existing agent routine gets 'chat', so its runs go back to the agent's chat, as before 0.61.
  up: addAgentRoutineRunPlace,
};
