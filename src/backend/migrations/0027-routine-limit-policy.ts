import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord } from "./runtime-values";

export const V27_ROUTINE_LIMIT_POLICY_COLUMN_SQL = `limit_policy TEXT NOT NULL DEFAULT 'wait' CHECK(limit_policy IN ('wait', 'skip'))`;

function addRoutineLimitPolicy(db: DatabaseSync): void {
  for (const table of ["projection_agent_routines", "projection_channel_routines"]) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (columns.some((column) => isDynamicRecord(column) && column.name === "limit_policy")) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${V27_ROUTINE_LIMIT_POLICY_COLUMN_SQL}`);
  }
}

export const migration: OpenBotMigration = {
  version: 27,
  name: "routine-limit-policy",
  up: addRoutineLimitPolicy,
};
