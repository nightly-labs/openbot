import type { DatabaseSync } from "node:sqlite";
import { widenProviderSessionsCheck } from "./0017-provider-sessions-opencode";
import type { OpenBotMigration } from "./migration";

// Migration 23 adds `acp`, the one provider of every custom ACP agent. Frozen with the migration, like V22.
const V23_PROVIDER_SESSIONS_CHECK_SQL = `provider TEXT NOT NULL CHECK(provider IN ('codex', 'claude', 'grok', 'opencode', 'antigravity', 'acp')),`;

// Migration 23 adds the custom ACP agent provider with the same rebuild and the same skip.
function migrateProviderSessionsForCustomAgents(db: DatabaseSync): void {
  widenProviderSessionsCheck(db, "'acp'", V23_PROVIDER_SESSIONS_CHECK_SQL, "projection_provider_sessions_v23");
}

export const migration: OpenBotMigration = {
  version: 23,
  name: "provider-sessions-custom-agents",
  // The same rebuild as migrations 17 and 22, with foreign keys off for the same reason.
  disableForeignKeys: true,
  up: migrateProviderSessionsForCustomAgents,
};
