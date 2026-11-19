import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord } from "./runtime-values";

// Migration 35 records what started a manual run: a test, a local script or a webhook. Frozen with the
// migration. A run from before it has no source, and a scheduled run never has one. ADD COLUMN puts it after
// the migration 33 columns, before the UNIQUE constraint.
export const V35_ROUTINE_RUN_SOURCE_COLUMN_SQL = `run_source TEXT CHECK(run_source IS NULL OR run_source IN ('test', 'script', 'webhook'))`;

// Migration 35 adds the run source to the run tables.
function addRoutineRunSource(db: DatabaseSync): void {
  for (const table of ["projection_routine_runs", "projection_channel_routine_runs"]) {
    // A development profile that ran this version before it shipped has the column already.
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (columns.some((column) => isDynamicRecord(column) && column.name === "run_source")) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${V35_ROUTINE_RUN_SOURCE_COLUMN_SQL}`);
  }
}

export const migration: OpenBotMigration = {
  version: 35,
  name: "routine-run-source",
  // Adds a column with no default to two tables: no rebuild, so no foreign-key pause and no vacuum. Every
  // existing run records no source, which the app reads as a test run, as it did before.
  up: addRoutineRunSource,
};
