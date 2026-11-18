import type { DatabaseSync } from "node:sqlite";
import { rebuildProviderSessions } from "./0017-provider-sessions-opencode";
import type { OpenBotMigration } from "./migration";

// Migration 28 removes the provider CHECK, so a new provider no longer needs a table rebuild. The write path
// validates the provider instead: `ProviderSessions.bindProviderSession` and the thread replay accept only
// `AGENT_PROVIDERS`. Frozen with the migration.
export const V28_PROVIDER_SESSIONS_COLUMN_SQL = `provider TEXT NOT NULL,`;

// Migration 28 removes the provider CHECK. It rebuilds the table with no guard: every shipped table has the
// CHECK, and a rebuild of a table that has none, which a replay over a new database meets, keeps every row.
function removeProviderSessionsCheck(db: DatabaseSync): void {
  rebuildProviderSessions(db, V28_PROVIDER_SESSIONS_COLUMN_SQL, "projection_provider_sessions_v28");
}

export const migration: OpenBotMigration = {
  version: 28,
  name: "provider-sessions-no-check",
  // The same rebuild as migrations 17, 22, 23, 24 and 26, with foreign keys off for the same reason.
  disableForeignKeys: true,
  up: removeProviderSessionsCheck,
};
