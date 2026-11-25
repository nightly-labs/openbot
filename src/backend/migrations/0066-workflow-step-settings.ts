import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord, isString } from "./runtime-values";

export const V66_WORKFLOW_STEP_SETTINGS_COLUMN_SQL =
  "settings_json TEXT CHECK(settings_json IS NULL OR json_valid(settings_json))";
export const V66_WORKFLOW_STEP_SOURCES_COLUMN_SQL =
  "sources_json TEXT CHECK(sources_json IS NULL OR json_valid(sources_json))";

const V66_COLUMNS = [
  { name: "settings_json", sql: V66_WORKFLOW_STEP_SETTINGS_COLUMN_SQL },
  { name: "sources_json", sql: V66_WORKFLOW_STEP_SOURCES_COLUMN_SQL },
] as const;

function addWorkflowStepSettings(db: DatabaseSync): void {
  const existing = new Set(
    db
      .prepare("PRAGMA table_info(workflow_steps)")
      .all()
      .flatMap((column) => (isDynamicRecord(column) && isString(column.name) ? [column.name] : [])),
  );
  for (const column of V66_COLUMNS)
    if (!existing.has(column.name)) db.exec(`ALTER TABLE workflow_steps ADD COLUMN ${column.sql}`);
}

export const migration: OpenBotMigration = {
  version: 66,
  name: "workflow-step-settings",
  up: addWorkflowStepSettings,
};
