import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord } from "./runtime-values";

const V48_AGENT_THREAD_BRANCH_COLUMNS_SQL = [
  "branch_source_thread_id TEXT",
  "branch_source_message_id TEXT",
  "branch_through_message_id TEXT",
] as const;

function addAgentThreadBranch(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(projection_agent_threads)").all();
  for (const column of V48_AGENT_THREAD_BRANCH_COLUMNS_SQL) {
    const name = column.slice(0, column.indexOf(" "));
    if (columns.some((existing) => isDynamicRecord(existing) && existing.name === name)) continue;
    db.exec(`ALTER TABLE projection_agent_threads ADD COLUMN ${column}`);
  }
}

export const migration: OpenBotMigration = {
  version: 48,
  name: "agent-thread-branch",
  up: addAgentThreadBranch,
};
