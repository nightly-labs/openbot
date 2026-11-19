import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord } from "./runtime-values";

// The actor column is part of the primary key, so the table is rebuilt rather than altered. There are no
// indexes and no foreign keys in either direction, so foreign keys stay on: switching them off here could
// only hide a real violation raised by the same transaction.
function migrateReactionsForAgentActors(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(projection_reactions)").all();
  if (columns.some((column) => isDynamicRecord(column) && column.name === "actor_agent_id")) return;

  db.exec(`
    CREATE TABLE projection_reactions_v12 (
      agent_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      actor_kind TEXT NOT NULL CHECK(actor_kind IN ('user', 'agent')),
      actor_agent_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_event_sequence INTEGER NOT NULL,
      PRIMARY KEY(agent_id, message_id, actor_kind, actor_agent_id)
    );
    INSERT INTO projection_reactions_v12 (
      agent_id, message_id, emoji, actor_kind, actor_agent_id, updated_at, last_event_sequence
    )
    SELECT
      agent_id, message_id, emoji,
      CASE actor_kind WHEN 'bot' THEN 'agent' ELSE actor_kind END,
      actor_bot_id, updated_at, last_event_sequence
    FROM projection_reactions;
    DROP TABLE projection_reactions;
    ALTER TABLE projection_reactions_v12 RENAME TO projection_reactions;
  `);
}

export const migration: OpenBotMigration = {
  version: 12,
  name: "reactions-agent-actors",
  up: migrateReactionsForAgentActors,
};
