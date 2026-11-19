import type { DatabaseSync } from "node:sqlite";
import { widenProviderSessionsCheck } from "./0017-provider-sessions-opencode";
import type { OpenBotMigration } from "./migration";

const V22_PROVIDER_SESSIONS_CHECK_SQL = `provider TEXT NOT NULL CHECK(provider IN ('codex', 'claude', 'grok', 'opencode', 'antigravity')),`;

function migrateProviderSessionsForAntigravity(db: DatabaseSync): void {
  widenProviderSessionsCheck(db, "'antigravity'", V22_PROVIDER_SESSIONS_CHECK_SQL, "projection_provider_sessions_v22");
}

export const migration: OpenBotMigration = {
  version: 22,
  name: "provider-sessions-antigravity",
  disableForeignKeys: true,
  up: migrateProviderSessionsForAntigravity,
};
