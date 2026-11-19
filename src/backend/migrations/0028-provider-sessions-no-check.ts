import type { DatabaseSync } from "node:sqlite";
import { rebuildProviderSessions } from "./0017-provider-sessions-opencode";
import type { OpenBotMigration } from "./migration";

export const V28_PROVIDER_SESSIONS_COLUMN_SQL = `provider TEXT NOT NULL,`;

function removeProviderSessionsCheck(db: DatabaseSync): void {
  rebuildProviderSessions(db, V28_PROVIDER_SESSIONS_COLUMN_SQL, "projection_provider_sessions_v28");
}

export const migration: OpenBotMigration = {
  version: 28,
  name: "provider-sessions-no-check",
  disableForeignKeys: true,
  up: removeProviderSessionsCheck,
};
