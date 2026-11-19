import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord } from "./runtime-values";

export const V60_AGENT_MEMORY_SITE_COLUMN_SQL = `site TEXT CHECK(site IS NULL OR length(site) BETWEEN 1 AND 253)`;
export const V60_AGENT_MEMORY_SITE_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS agent_memories_site
    ON projection_agent_memories(agent_id, site) WHERE site IS NOT NULL;
`;

function addAgentMemorySite(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(projection_agent_memories)").all();
  if (!columns.some((existing) => isDynamicRecord(existing) && existing.name === "site"))
    db.exec(`ALTER TABLE projection_agent_memories ADD COLUMN ${V60_AGENT_MEMORY_SITE_COLUMN_SQL}`);
  db.exec(V60_AGENT_MEMORY_SITE_INDEX_SQL);
}

export const migration: OpenBotMigration = {
  version: 60,
  name: "agent-memory-site",
  up: addAgentMemorySite,
};
