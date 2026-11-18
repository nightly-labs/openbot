import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord } from "./runtime-values";

// Migration 48. The branch link, added with no default: no rebuild, no data change, and every existing
// thread gets null, which is a thread that is not a branch.
const V48_AGENT_THREAD_BRANCH_COLUMNS_SQL = [
  "branch_source_thread_id TEXT",
  "branch_source_message_id TEXT",
  "branch_through_message_id TEXT",
] as const;

// Migration 48 links a branch to the thread and message it was copied from.
function addAgentThreadBranch(db: DatabaseSync): void {
  // A development profile that ran this version before it shipped has the columns already.
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
  // Adds three columns with no default: no rebuild, so no foreign-key pause and no vacuum. Every existing
  // thread gets null, which is a thread that is not a branch, as it was before.
  up: addAgentThreadBranch,
};
