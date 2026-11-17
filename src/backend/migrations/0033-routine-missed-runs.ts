import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord } from "./runtime-values";

// Migration 33 adds what a routine does with the occurrences that came due while OpenBot was closed, and
// the run columns that record those occurrences on one cancelled run. Frozen with the migration. The policy
// goes after the migration 27 column. ADD COLUMN puts a run column before the UNIQUE constraint that ends
// the run tables, so the latest schema puts the two run columns there as well.
export const V33_ROUTINE_MISSED_POLICY_COLUMN_SQL = `missed_policy TEXT NOT NULL DEFAULT 'skip' CHECK(missed_policy IN ('skip', 'run-once'))`;
export const V33_ROUTINE_RUN_MISSED_COLUMNS_SQL = [
  "missed_count INTEGER CHECK(missed_count IS NULL OR missed_count >= 1)",
  "missed_until TEXT",
] as const;

// Migration 33 adds the missed-run policy to the routine tables and the missed-run record to the run tables.
function addRoutineMissedRuns(db: DatabaseSync): void {
  const additions: readonly (readonly [string, string, string])[] = [
    ["projection_agent_routines", "missed_policy", V33_ROUTINE_MISSED_POLICY_COLUMN_SQL],
    ["projection_channel_routines", "missed_policy", V33_ROUTINE_MISSED_POLICY_COLUMN_SQL],
    ...["projection_routine_runs", "projection_channel_routine_runs"].flatMap((table) =>
      V33_ROUTINE_RUN_MISSED_COLUMNS_SQL.map(
        (column) => [table, column.slice(0, column.indexOf(" ")), column] as const,
      ),
    ),
  ];
  for (const [table, name, column] of additions) {
    // A development profile that ran this version before it shipped has the column already.
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (columns.some((existing) => isDynamicRecord(existing) && existing.name === name)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
  }
}

export const migration: OpenBotMigration = {
  version: 33,
  name: "routine-missed-runs",
  // Adds columns with a constant default or none to four tables: no rebuild, so no foreign-key pause and
  // no vacuum. Every existing routine keeps skipping the occurrences it missed, which is what it did
  // before, and every existing run records no missed occurrence.
  up: addRoutineMissedRuns,
};
