import type { DatabaseSync } from "node:sqlite";
import { widenProviderSessionsCheck } from "./0017-provider-sessions-opencode";
import type { OpenBotMigration } from "./migration";

const V24_PROVIDER_SESSIONS_CHECK_SQL = `provider TEXT NOT NULL CHECK(provider IN ('codex', 'claude', 'grok', 'opencode', 'antigravity', 'acp', 'cursor')),`;

function migrateProviderSessionsForCursor(db: DatabaseSync): void {
  widenProviderSessionsCheck(db, "'cursor'", V24_PROVIDER_SESSIONS_CHECK_SQL, "projection_provider_sessions_v24");
}

export const migration: OpenBotMigration = {
  version: 24,
  name: "provider-sessions-cursor",
  disableForeignKeys: true,
  up: migrateProviderSessionsForCursor,
};
