import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord } from "./runtime-values";

// Migration 60 ties an agent memory to a site: the host name of the pages it is about, such as
// `github.com`, or NULL for a memory of no site. Frozen with the migration. No default: every existing
// memory stays a memory of no site. ADD COLUMN puts it after the last column, before the UNIQUE
// constraint. The index serves the recall of one site's memories when the agent opens a page of it.
export const V60_AGENT_MEMORY_SITE_COLUMN_SQL = `site TEXT CHECK(site IS NULL OR length(site) BETWEEN 1 AND 253)`;
export const V60_AGENT_MEMORY_SITE_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS agent_memories_site
    ON projection_agent_memories(agent_id, site) WHERE site IS NOT NULL;
`;

// Migration 60 adds the site of an agent memory.
function addAgentMemorySite(db: DatabaseSync): void {
  // A development profile that ran this version before it shipped has the column already.
  const columns = db.prepare("PRAGMA table_info(projection_agent_memories)").all();
  if (!columns.some((existing) => isDynamicRecord(existing) && existing.name === "site"))
    db.exec(`ALTER TABLE projection_agent_memories ADD COLUMN ${V60_AGENT_MEMORY_SITE_COLUMN_SQL}`);
  db.exec(V60_AGENT_MEMORY_SITE_INDEX_SQL);
}

export const migration: OpenBotMigration = {
  version: 60,
  name: "agent-memory-site",
  // Adds one nullable column and a partial index: no rebuild, so no foreign-key pause and no vacuum.
  // Every existing memory gets no site, so the agent recalls it as before.
  up: addAgentMemorySite,
};
