import type { OpenBotMigration } from "./migration";

export const migration: OpenBotMigration = {
  version: 64,
  name: "provider-history-compaction",
  // A marker only: it changes no table and no row. From this version on, OpenBot replaces each
  // imported Codex and Claude item of `provider_history_staging` with a hash of its JSON. A release
  // before it reads such an item as a thread item and fails the import of the session, so that
  // release must refuse the database (`NewerDatabaseError`) instead of opening it.
  up: () => {},
};
