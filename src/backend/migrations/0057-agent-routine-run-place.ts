import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord } from "./runtime-values";

export const V57_AGENT_ROUTINE_RUN_IN_COLUMN_SQL = `run_in TEXT NOT NULL DEFAULT 'chat' CHECK(run_in IN ('chat', 'thread'))`;

function addAgentRoutineRunPlace(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(projection_agent_routines)").all();
  if (columns.some((existing) => isDynamicRecord(existing) && existing.name === "run_in")) return;
  db.exec(`ALTER TABLE projection_agent_routines ADD COLUMN ${V57_AGENT_ROUTINE_RUN_IN_COLUMN_SQL}`);
}

export const migration: OpenBotMigration = {
  version: 57,
  name: "agent-routine-run-place",
  up: addAgentRoutineRunPlace,
};
