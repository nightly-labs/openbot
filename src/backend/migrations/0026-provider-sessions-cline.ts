import type { DatabaseSync } from "node:sqlite";
import { widenProviderSessionsCheck } from "./0017-provider-sessions-opencode";
import type { OpenBotMigration } from "./migration";

const V26_PROVIDER_SESSIONS_CHECK_SQL = `provider TEXT NOT NULL CHECK(provider IN ('codex', 'claude', 'grok', 'opencode', 'antigravity', 'acp', 'cursor', 'cline')),`;

function migrateProviderSessionsForCline(db: DatabaseSync): void {
  widenProviderSessionsCheck(db, "'cline'", V26_PROVIDER_SESSIONS_CHECK_SQL, "projection_provider_sessions_v26");
}

export const migration: OpenBotMigration = {
  version: 26,
  name: "provider-sessions-cline",
  disableForeignKeys: true,
  up: migrateProviderSessionsForCline,
};
