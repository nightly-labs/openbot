import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord } from "./runtime-values";

export const V33_ROUTINE_MISSED_POLICY_COLUMN_SQL = `missed_policy TEXT NOT NULL DEFAULT 'skip' CHECK(missed_policy IN ('skip', 'run-once'))`;
export const V33_ROUTINE_RUN_MISSED_COLUMNS_SQL = [
  "missed_count INTEGER CHECK(missed_count IS NULL OR missed_count >= 1)",
  "missed_until TEXT",
] as const;

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
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (columns.some((existing) => isDynamicRecord(existing) && existing.name === name)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
  }
}

export const migration: OpenBotMigration = {
  version: 33,
  name: "routine-missed-runs",
  up: addRoutineMissedRuns,
};
