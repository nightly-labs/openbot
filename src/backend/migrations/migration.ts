import type { DatabaseSync } from "node:sqlite";

/**
 * One database migration. `migrateOpenBotDatabase` runs `up` in one transaction with the
 * `schema_migrations` marker of `version`.
 *
 * Each migration has its own file, `<version>-<name>.ts`. A released file never changes:
 * `scripts/check-frozen-migrations.ts` compares it with the newest release tag. To fix a released
 * migration, add a new one.
 */
export interface OpenBotMigration {
  readonly version: number;
  /** A stable kebab-case name, unique among the migrations. The file name has it after the version. */
  readonly name: string;
  readonly disableForeignKeys?: boolean;
  readonly vacuumAfterCommit?: boolean;
  readonly up: (db: DatabaseSync, appliedAt: string) => void;
}
