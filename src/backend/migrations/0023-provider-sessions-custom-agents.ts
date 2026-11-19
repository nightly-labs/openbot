import type { DatabaseSync } from "node:sqlite";
import { widenProviderSessionsCheck } from "./0017-provider-sessions-opencode";
import type { OpenBotMigration } from "./migration";

const V23_PROVIDER_SESSIONS_CHECK_SQL = `provider TEXT NOT NULL CHECK(provider IN ('codex', 'claude', 'grok', 'opencode', 'antigravity', 'acp')),`;

function migrateProviderSessionsForCustomAgents(db: DatabaseSync): void {
  widenProviderSessionsCheck(db, "'acp'", V23_PROVIDER_SESSIONS_CHECK_SQL, "projection_provider_sessions_v23");
}

export const migration: OpenBotMigration = {
  version: 23,
  name: "provider-sessions-custom-agents",
  disableForeignKeys: true,
  up: migrateProviderSessionsForCustomAgents,
};
