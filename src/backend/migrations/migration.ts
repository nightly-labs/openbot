import type { DatabaseSync } from "node:sqlite";

/**
 * One database migration, in its own frozen file `<version>-<name>.ts` (see `src/backend/AGENTS.md`).
 * `migrateOpenBotDatabase` runs `up` in one transaction with the `schema_migrations` marker of `version`.
 */
export interface OpenBotMigration {
  readonly version: number;
  /** Stable, unique, kebab-case, and the same as in the file name. */
  readonly name: string;
  readonly disableForeignKeys?: boolean;
  readonly vacuumAfterCommit?: boolean;
  readonly up: (db: DatabaseSync, appliedAt: string) => void;
}
