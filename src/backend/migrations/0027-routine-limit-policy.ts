import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord } from "./runtime-values";

// Migration 27 adds what a routine does while the provider plan of its agent is spent. Frozen with the
// migration. ADD COLUMN appends the declaration at the end of the stored CREATE statement, so the latest
// schema puts it last as well. Both routine tables end with a column, not a table constraint.
export const V27_ROUTINE_LIMIT_POLICY_COLUMN_SQL = `limit_policy TEXT NOT NULL DEFAULT 'wait' CHECK(limit_policy IN ('wait', 'skip'))`;

// Migration 27 adds the routine limit policy to the agent and the channel routine tables.
function addRoutineLimitPolicy(db: DatabaseSync): void {
  for (const table of ["projection_agent_routines", "projection_channel_routines"]) {
    // A development profile that ran this version before it shipped has the column already.
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (columns.some((column) => isDynamicRecord(column) && column.name === "limit_policy")) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${V27_ROUTINE_LIMIT_POLICY_COLUMN_SQL}`);
  }
}

export const migration: OpenBotMigration = {
  version: 27,
  name: "routine-limit-policy",
  // Adds a column with a constant default to two tables: no rebuild, so no foreign-key pause and no
  // vacuum. Every existing routine keeps waiting, which is what it did before.
  up: addRoutineLimitPolicy,
};
