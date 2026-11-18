import type { DatabaseSync } from "node:sqlite";
import { widenProviderSessionsCheck } from "./0017-provider-sessions-opencode";
import type { OpenBotMigration } from "./migration";

// Migration 22 adds the Antigravity provider. This list is frozen with the migration: do not derive it
// from `AGENT_PROVIDERS`, because a shipped migration must always write the same table.
const V22_PROVIDER_SESSIONS_CHECK_SQL = `provider TEXT NOT NULL CHECK(provider IN ('codex', 'claude', 'grok', 'opencode', 'antigravity')),`;

// Migration 22 uses the same rebuild as migration 17. It also skips a table that already allows the
// provider, so a replay over a database that `createLatestDatabase` built does not rebuild the table.
function migrateProviderSessionsForAntigravity(db: DatabaseSync): void {
  widenProviderSessionsCheck(db, "'antigravity'", V22_PROVIDER_SESSIONS_CHECK_SQL, "projection_provider_sessions_v22");
}

export const migration: OpenBotMigration = {
  version: 22,
  name: "provider-sessions-antigravity",
  // The same table rebuild as migration 17, so foreign keys stay off for the same reason: with them
  // on, the DROP would set `projection_turns.provider_session_id` to NULL on every turn.
  disableForeignKeys: true,
  up: migrateProviderSessionsForAntigravity,
};
