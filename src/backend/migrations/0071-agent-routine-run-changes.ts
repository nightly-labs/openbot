import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord } from "./runtime-values";

export const V71_AGENT_ROUTINE_RUNS_CHANGE_ROUTINES_COLUMN_SQL =
  "runs_change_routines INTEGER NOT NULL DEFAULT 0 CHECK(runs_change_routines IN (0, 1))";

function addAgentRoutineRunChanges(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(projection_agent_routines)").all();
  if (columns.some((existing) => isDynamicRecord(existing) && existing.name === "runs_change_routines")) return;
  db.exec(`ALTER TABLE projection_agent_routines ADD COLUMN ${V71_AGENT_ROUTINE_RUNS_CHANGE_ROUTINES_COLUMN_SQL}`);
}

export const migration: OpenBotMigration = {
  version: 71,
  name: "agent-routine-run-changes",
  up: addAgentRoutineRunChanges,
};
