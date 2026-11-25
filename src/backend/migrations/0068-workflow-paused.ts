import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord, isString } from "./runtime-values";

export const V68_WORKFLOW_PAUSED_COLUMN_SQL = "paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0, 1))";

function addWorkflowPaused(db: DatabaseSync): void {
  const existing = db
    .prepare("PRAGMA table_info(workflows)")
    .all()
    .some((column) => isDynamicRecord(column) && isString(column.name) && column.name === "paused");
  if (!existing) db.exec(`ALTER TABLE workflows ADD COLUMN ${V68_WORKFLOW_PAUSED_COLUMN_SQL}`);
}

export const migration: OpenBotMigration = {
  version: 68,
  name: "workflow-paused",
  up: addWorkflowPaused,
};
