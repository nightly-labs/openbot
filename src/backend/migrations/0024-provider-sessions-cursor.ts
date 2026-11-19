import type { DatabaseSync } from "node:sqlite";
import { widenProviderSessionsCheck } from "./0017-provider-sessions-opencode";
import type { OpenBotMigration } from "./migration";

// Migration 24 adds the Cursor provider. Frozen with the migration, like V22.
const V24_PROVIDER_SESSIONS_CHECK_SQL = `provider TEXT NOT NULL CHECK(provider IN ('codex', 'claude', 'grok', 'opencode', 'antigravity', 'acp', 'cursor')),`;

// Migration 24 adds the Cursor provider with the same rebuild and the same skip.
function migrateProviderSessionsForCursor(db: DatabaseSync): void {
  widenProviderSessionsCheck(db, "'cursor'", V24_PROVIDER_SESSIONS_CHECK_SQL, "projection_provider_sessions_v24");
}

export const migration: OpenBotMigration = {
  version: 24,
  name: "provider-sessions-cursor",
  // The same rebuild as migrations 17, 22 and 23, with foreign keys off for the same reason.
  disableForeignKeys: true,
  up: migrateProviderSessionsForCursor,
};
