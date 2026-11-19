import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord } from "./runtime-values";

export const V35_ROUTINE_RUN_SOURCE_COLUMN_SQL = `run_source TEXT CHECK(run_source IS NULL OR run_source IN ('test', 'script', 'webhook'))`;

function addRoutineRunSource(db: DatabaseSync): void {
  for (const table of ["projection_routine_runs", "projection_channel_routine_runs"]) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (columns.some((column) => isDynamicRecord(column) && column.name === "run_source")) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${V35_ROUTINE_RUN_SOURCE_COLUMN_SQL}`);
  }
}

export const migration: OpenBotMigration = {
  version: 35,
  name: "routine-run-source",
  up: addRoutineRunSource,
};
