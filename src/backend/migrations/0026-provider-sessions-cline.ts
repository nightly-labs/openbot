import type { DatabaseSync } from "node:sqlite";
import { widenProviderSessionsCheck } from "./0017-provider-sessions-opencode";
import type { OpenBotMigration } from "./migration";

// Migration 26 adds the Cline provider. Frozen with the migration, like V22.
const V26_PROVIDER_SESSIONS_CHECK_SQL = `provider TEXT NOT NULL CHECK(provider IN ('codex', 'claude', 'grok', 'opencode', 'antigravity', 'acp', 'cursor', 'cline')),`;

// Migration 26 adds the Cline provider with the same rebuild and the same skip.
function migrateProviderSessionsForCline(db: DatabaseSync): void {
  widenProviderSessionsCheck(db, "'cline'", V26_PROVIDER_SESSIONS_CHECK_SQL, "projection_provider_sessions_v26");
}

export const migration: OpenBotMigration = {
  version: 26,
  name: "provider-sessions-cline",
  // The same rebuild as migrations 17, 22, 23 and 24, with foreign keys off for the same reason.
  disableForeignKeys: true,
  up: migrateProviderSessionsForCline,
};
