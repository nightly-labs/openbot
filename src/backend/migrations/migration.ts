import type { DatabaseSync } from "node:sqlite";

export interface OpenBotMigration {
  readonly version: number;
  readonly name: string;
  readonly disableForeignKeys?: boolean;
  readonly vacuumAfterCommit?: boolean;
  readonly up: (db: DatabaseSync, appliedAt: string) => void;
}
