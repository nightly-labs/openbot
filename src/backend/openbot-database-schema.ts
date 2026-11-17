import type { DatabaseSync } from "node:sqlite";
import { isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { AGENT_THREAD_SCHEMA_SQL } from "./agent-threads/agent-thread-schema";
import { withTransaction } from "./database/sqlite-transaction";
import { BASELINE_V8_SCHEMA_SQL } from "./migrations/0008-baseline";
import { ANALYTICS_SCHEMA_SQL } from "./migrations/0015-agent-usage";
import { ANALYTICS_DATE_INDEX_SQL } from "./migrations/0016-agent-usage-date-index";
import { CHANNEL_SCHEMA_SQL } from "./migrations/0018-channels";
import { CHANNEL_SETTINGS_SCHEMA_SQL } from "./migrations/0019-channel-settings";
import { MCP_SERVERS_SCHEMA_SQL } from "./migrations/0020-mcp-servers";
import { MESSAGING_SCHEMA_SQL } from "./migrations/0025-messaging";
import { V27_ROUTINE_LIMIT_POLICY_COLUMN_SQL } from "./migrations/0027-routine-limit-policy";
import { V28_PROVIDER_SESSIONS_COLUMN_SQL } from "./migrations/0028-provider-sessions-no-check";
import { PROVIDER_HISTORY_SCHEMA_SQL } from "./migrations/0029-provider-history";
import { WEBHOOK_SCHEMA_SQL } from "./migrations/0030-routine-webhooks";
import { ROUTINE_FLOW_SCHEMA_SQL } from "./migrations/0031-routine-flows";
import { AGENT_MEMORY_SELECTION_SCHEMA_SQL } from "./migrations/0032-agent-memory-selection";
import {
  V33_ROUTINE_MISSED_POLICY_COLUMN_SQL,
  V33_ROUTINE_RUN_MISSED_COLUMNS_SQL,
} from "./migrations/0033-routine-missed-runs";
import { AGENT_WAIT_SCHEMA_SQL } from "./migrations/0034-agent-waits";
import { V35_ROUTINE_RUN_SOURCE_COLUMN_SQL } from "./migrations/0035-routine-run-source";
import { MESSAGING_MEMORY_SCHEMA_SQL } from "./migrations/0036-messaging-memory";
import { ROUTINE_RESULT_SCHEMA_SQL } from "./migrations/0037-routine-results";
import {
  V40_THREAD_MESSAGE_ORDER_COLUMNS_SQL,
  V40_THREAD_MESSAGE_ORDER_INDEX_SQL,
} from "./migrations/0040-thread-message-order";
import { V41_ATTACHMENT_OWNER_INDEX_SQL } from "./migrations/0041-attachment-owner-index";
import { V42_ROUTINE_FLOW_SWEEP_INDEX_SQL } from "./migrations/0042-routine-flow-sweep-indexes";
import { V43_THREAD_EVENT_TYPE_INDEX_SQL } from "./migrations/0043-thread-event-type-index";
import { MESSAGING_ALLOWED_ROLES_SCHEMA_SQL } from "./migrations/0044-messaging-allowed-roles";
import { BROWSER_PROFILE_SCHEMA_SQL } from "./migrations/0045-browser-profiles";
import { V46_WORKFLOW_RUN_SOURCE_SQL, WORKFLOW_SCHEMA_SQL } from "./migrations/0046-workflows";
import { WORKFLOW_GITHUB_SCHEMA_SQL } from "./migrations/0049-github-workflows";
import { MESSAGING_ALLOWED_SENDERS_SCHEMA_SQL } from "./migrations/0051-messaging-allowed-senders";
import { V53_WORKFLOW_RUN_SOURCE_SQL } from "./migrations/0053-slack-workflows";
import { DELETED_THREAD_MESSAGES_SCHEMA_SQL } from "./migrations/0055-deleted-thread-messages";
import { BROWSER_PROXY_SCHEMA_SQL } from "./migrations/0056-browser-proxies";
import { V57_AGENT_ROUTINE_RUN_IN_COLUMN_SQL } from "./migrations/0057-agent-routine-run-place";
import { AGENT_SKILL_LOADS_SCHEMA_SQL } from "./migrations/0058-agent-skill-loads";
import { MESSAGING_PINGS_SCHEMA_SQL } from "./migrations/0059-messaging-pings";
import { V60_AGENT_MEMORY_SITE_COLUMN_SQL, V60_AGENT_MEMORY_SITE_INDEX_SQL } from "./migrations/0060-agent-memory-site";
import { PINNED_THREAD_MESSAGES_SCHEMA_SQL } from "./migrations/0061-pinned-thread-messages";
import { MESSAGING_HISTORY_SCHEMA_SQL } from "./migrations/0062-messaging-history";
import { CRM_SCHEMA_SQL } from "./migrations/0063-crm";
import type { OpenBotMigration } from "./migrations/migration";
import { MIGRATIONS } from "./migrations/registry";

const BASELINE_SCHEMA_VERSION = 8;

// Each migration and the SQL it runs is in its own frozen file under `migrations/`. This module runs them,
// and builds a new database from the latest schema below.

// v12 rewrites `projection_reactions`, so the fresh schema is no longer the v8 baseline. It is derived
// from that baseline by substituting the one table that changed rather than by copying all of it, so a
// table added to the baseline still reaches new installs from a single declaration.
// `openbot-database-schema-parity.test.ts` proves the result matches what the migrations produce.
const BASELINE_REACTIONS_TABLE_SQL = `  CREATE TABLE IF NOT EXISTS projection_reactions (
    agent_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    actor_kind TEXT NOT NULL CHECK(actor_kind IN ('user', 'bot')),
    actor_bot_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_event_sequence INTEGER NOT NULL,
    PRIMARY KEY(agent_id, message_id, actor_kind, actor_bot_id)
  );`;

const V12_REACTIONS_TABLE_SQL = `  CREATE TABLE IF NOT EXISTS projection_reactions (
    agent_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    actor_kind TEXT NOT NULL CHECK(actor_kind IN ('user', 'agent')),
    actor_agent_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_event_sequence INTEGER NOT NULL,
    PRIMARY KEY(agent_id, message_id, actor_kind, actor_agent_id)
  );`;

// Migrations 17, 22, 23, 24 and 26 widen the provider CHECK and migration 28 removes it, so the fresh schema is no
// longer the v8 baseline here either.
// One line rather than the whole table: the substitution then survives any later baseline edit that does
// not touch this constraint, and `substituteOnce` still shouts if the line ever stops being unique.
const BASELINE_PROVIDER_SESSIONS_CHECK_SQL = `provider TEXT NOT NULL CHECK(provider IN ('codex', 'claude', 'grok')),`;

const BASELINE_THREAD_MESSAGES_END_SQL = `    last_event_sequence INTEGER NOT NULL,
    PRIMARY KEY(thread_id, message_id)`;

const BASELINE_AGENT_MEMORIES_END_SQL = `    last_event_sequence INTEGER NOT NULL,
    UNIQUE(agent_id, normalized_text)
  );
  CREATE INDEX IF NOT EXISTS agent_memories_agent`;
const BASELINE_AGENT_ROUTINES_END_SQL = `    last_event_sequence INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS agent_routines_agent`;

const V19_CHANNEL_ROUTINES_END_SQL = `    last_event_sequence INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS channel_routines_channel`;

const BASELINE_ROUTINE_RUNS_END_SQL = `    last_event_sequence INTEGER NOT NULL,
    UNIQUE(trigger_id, scheduled_for)
  );
  CREATE INDEX IF NOT EXISTS routine_runs_routine`;

const V19_CHANNEL_ROUTINE_RUNS_END_SQL = `    last_event_sequence INTEGER NOT NULL,
    UNIQUE(trigger_id, scheduled_for)
  );
  CREATE INDEX IF NOT EXISTS channel_routine_runs_routine`;

const LATEST_SCHEMA_SQL =
  substituteOnce(
    substituteOnce(
      substituteOnce(
        substituteOnce(
          substituteOnce(
            substituteOnce(BASELINE_V8_SCHEMA_SQL, BASELINE_REACTIONS_TABLE_SQL, V12_REACTIONS_TABLE_SQL),
            BASELINE_AGENT_MEMORIES_END_SQL,
            withAgentMemorySite(BASELINE_AGENT_MEMORIES_END_SQL),
          ),
          BASELINE_THREAD_MESSAGES_END_SQL,
          withThreadMessageOrderColumns(BASELINE_THREAD_MESSAGES_END_SQL),
        ),
        BASELINE_PROVIDER_SESSIONS_CHECK_SQL,
        V28_PROVIDER_SESSIONS_COLUMN_SQL,
      ),
      BASELINE_AGENT_ROUTINES_END_SQL,
      withAgentRoutineRunPlace(withRoutinePolicies(BASELINE_AGENT_ROUTINES_END_SQL)),
    ),
    BASELINE_ROUTINE_RUNS_END_SQL,
    withRunAddedColumns(BASELINE_ROUTINE_RUNS_END_SQL),
  ) +
  ANALYTICS_SCHEMA_SQL +
  ANALYTICS_DATE_INDEX_SQL +
  CHANNEL_SCHEMA_SQL +
  substituteOnce(
    substituteOnce(
      CHANNEL_SETTINGS_SCHEMA_SQL,
      V19_CHANNEL_ROUTINES_END_SQL,
      withRoutinePolicies(V19_CHANNEL_ROUTINES_END_SQL),
    ),
    V19_CHANNEL_ROUTINE_RUNS_END_SQL,
    withRunAddedColumns(V19_CHANNEL_ROUTINE_RUNS_END_SQL),
  ) +
  MCP_SERVERS_SCHEMA_SQL +
  MESSAGING_SCHEMA_SQL +
  PROVIDER_HISTORY_SCHEMA_SQL +
  WEBHOOK_SCHEMA_SQL +
  ROUTINE_FLOW_SCHEMA_SQL +
  AGENT_MEMORY_SELECTION_SCHEMA_SQL +
  AGENT_WAIT_SCHEMA_SQL +
  MESSAGING_MEMORY_SCHEMA_SQL +
  ROUTINE_RESULT_SCHEMA_SQL +
  V40_THREAD_MESSAGE_ORDER_INDEX_SQL +
  V41_ATTACHMENT_OWNER_INDEX_SQL +
  V42_ROUTINE_FLOW_SWEEP_INDEX_SQL +
  V43_THREAD_EVENT_TYPE_INDEX_SQL +
  MESSAGING_ALLOWED_ROLES_SCHEMA_SQL +
  BROWSER_PROFILE_SCHEMA_SQL +
  substituteOnce(WORKFLOW_SCHEMA_SQL, V46_WORKFLOW_RUN_SOURCE_SQL, V53_WORKFLOW_RUN_SOURCE_SQL) +
  AGENT_THREAD_SCHEMA_SQL +
  WORKFLOW_GITHUB_SCHEMA_SQL +
  MESSAGING_ALLOWED_SENDERS_SCHEMA_SQL +
  DELETED_THREAD_MESSAGES_SCHEMA_SQL +
  BROWSER_PROXY_SCHEMA_SQL +
  AGENT_SKILL_LOADS_SCHEMA_SQL +
  MESSAGING_PINGS_SCHEMA_SQL +
  V60_AGENT_MEMORY_SITE_INDEX_SQL +
  PINNED_THREAD_MESSAGES_SCHEMA_SQL +
  MESSAGING_HISTORY_SCHEMA_SQL +
  CRM_SCHEMA_SQL;

/** The end of the thread message table with the migration 40 columns before its PRIMARY KEY constraint. */
function withThreadMessageOrderColumns(tableEnd: string): string {
  return tableEnd.replace(
    "last_event_sequence INTEGER NOT NULL,\n",
    `last_event_sequence INTEGER NOT NULL,\n${V40_THREAD_MESSAGE_ORDER_COLUMNS_SQL.map((column) => `    ${column},\n`).join("")}`,
  );
}

/** The end of a routine table with the migration 27 and 33 columns after its last one. */
function withRoutinePolicies(tableEnd: string): string {
  return tableEnd.replace(
    "last_event_sequence INTEGER NOT NULL\n",
    `last_event_sequence INTEGER NOT NULL,\n    ${V27_ROUTINE_LIMIT_POLICY_COLUMN_SQL},\n    ${V33_ROUTINE_MISSED_POLICY_COLUMN_SQL}\n`,
  );
}

/** The end of the agent memory table with the migration 60 column before its UNIQUE constraint. */
function withAgentMemorySite(tableEnd: string): string {
  return tableEnd.replace(
    "last_event_sequence INTEGER NOT NULL,\n",
    `last_event_sequence INTEGER NOT NULL,\n    ${V60_AGENT_MEMORY_SITE_COLUMN_SQL},\n`,
  );
}

/** The end of the agent routine table with the migration 57 column after the migration 33 one. */
function withAgentRoutineRunPlace(tableEnd: string): string {
  return tableEnd.replace(
    `${V33_ROUTINE_MISSED_POLICY_COLUMN_SQL}\n`,
    `${V33_ROUTINE_MISSED_POLICY_COLUMN_SQL},\n    ${V57_AGENT_ROUTINE_RUN_IN_COLUMN_SQL}\n`,
  );
}

/** The end of a routine run table with the migration 33 and 35 columns before its UNIQUE constraint. */
function withRunAddedColumns(tableEnd: string): string {
  return tableEnd.replace(
    "last_event_sequence INTEGER NOT NULL,\n",
    `last_event_sequence INTEGER NOT NULL,\n${[...V33_ROUTINE_RUN_MISSED_COLUMNS_SQL, V35_ROUTINE_RUN_SOURCE_COLUMN_SQL].map((column) => `    ${column},\n`).join("")}`,
  );
}

// Silence here would ship new installs a table the migrations never produce, so an edit to the baseline
// that moves this declaration out from under the substitution has to be loud.
function substituteOnce(source: string, search: string, replacement: string): string {
  const index = source.indexOf(search);
  if (index === -1 || source.indexOf(search, index + search.length) !== -1) {
    throw new Error("The latest OpenBot schema could not be derived from the v8 baseline.");
  }
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

export interface OpenBotMigrationOptions {
  appliedAt?: string;
  warn?: (message: string, error: unknown) => void;
  /** The last connection closed cleanly, so SQLite removed the write-ahead log. */
  closedCleanly?: boolean;
  /**
   * Stops an existing database after this version. Tests use it to make the database of an older
   * release (`src/backend/migration-harness.ts`). A new database always gets the latest version.
   */
  throughVersion?: number;
}

const logger = createOpenBotLogger("openbot-database-schema");

/** The highest schema version that this build can open. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? BASELINE_SCHEMA_VERSION;

/**
 * True when `migrateOpenBotDatabase` will build a new database or run a migration. Both end with the
 * full check on this connection, so a check elsewhere before them would only read the file twice.
 */
export function openBotDatabaseNeedsMigration(db: DatabaseSync): boolean {
  if (!hasExistingSchema(db)) return true;
  const currentVersion = latestAppliedVersion(readAppliedVersions(db));
  return MIGRATIONS.some((migration) => migration.version > currentVersion);
}

export function migrateOpenBotDatabase(db: DatabaseSync, options: OpenBotMigrationOptions = {}): void {
  validateMigrationRegistry();
  const appliedAt = options.appliedAt ?? new Date().toISOString();
  if (!hasExistingSchema(db)) {
    createLatestDatabase(db, appliedAt);
    assertQuickCheck(db);
    return;
  }

  const appliedVersions = readAppliedVersions(db);
  validateAppliedVersions(appliedVersions);
  const currentVersion = latestAppliedVersion(appliedVersions);
  const throughVersion = options.throughVersion ?? LATEST_SCHEMA_VERSION;
  const pending = MIGRATIONS.filter(
    (migration) => migration.version > currentVersion && migration.version <= throughVersion,
  );
  // A database can hold broken references from before this upgrade. A migration that does not touch them must not
  // stop on them, and deleting them would lose rows, so each migration is checked only for the ones it adds.
  let violations: Map<string, number> | undefined;

  for (const migration of pending) {
    try {
      // Read inside the try, so that a failed read names the migration that it stops, as a failed check did before.
      violations ??= readOldForeignKeyViolations(db);
      violations = runMigration(db, migration, appliedAt, violations);
    } catch (error) {
      // The startup log keeps only the message, so the cause is logged here.
      logger.error(`OpenBot database migration to version ${migration.version} failed.`, toLogValue(error));
      throw new Error(`OpenBot database migration to version ${migration.version} failed.`, {
        cause: error,
      });
    }

    if (migration.vacuumAfterCommit) {
      try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        db.exec("VACUUM");
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } catch (error) {
        const warn = options.warn ?? ((message: string, cause: unknown) => logger.warn(message, toLogValue(cause)));
        warn(`OpenBot database migration to version ${migration.version} succeeded, but VACUUM failed.`, error);
      }
    }
  }

  // The check reads every page, which takes minutes on a large file. Only a migration, or a stop that
  // did not close the file (a crash, a kill, a disk save while it ran), can leave a damaged page.
  if (pending.length > 0 || !options.closedCleanly) assertQuickCheck(db);
}

function validateMigrationRegistry(): void {
  let expectedVersion = BASELINE_SCHEMA_VERSION;
  for (const migration of MIGRATIONS) {
    if (!Number.isInteger(migration.version) || migration.version !== expectedVersion) {
      throw new Error(
        `OpenBot database migrations must be contiguous from version ${BASELINE_SCHEMA_VERSION}; expected ${expectedVersion}.`,
      );
    }
    expectedVersion += 1;
  }
}

function hasExistingSchema(db: DatabaseSync): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get(),
  );
}

function createLatestDatabase(db: DatabaseSync, appliedAt: string): void {
  withTransaction(db, () => {
    db.exec(LATEST_SCHEMA_SQL);
    const insertMigration = db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)");
    for (const migration of MIGRATIONS) insertMigration.run(migration.version, appliedAt);
    assertForeignKeys(db, new Map());
  });
}

function readAppliedVersions(db: DatabaseSync): number[] {
  const hasMigrationTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (!hasMigrationTable) return [];
  return db
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all()
    .map((row) => {
      if (!isDynamicRecord(row) || !isNumber(row.version) || !Number.isInteger(row.version)) {
        throw new Error("OpenBot database contains an invalid schema migration version.");
      }
      return row.version;
    });
}

/**
 * A newer OpenBot migrated the database. This build stops before it writes anything; the start can
 * recover by installing a release that knows the version (`src/main/newer-database-recovery.ts`).
 */
export class NewerDatabaseError extends Error {
  constructor(databaseVersion: number, supportedVersion: number) {
    super(`OpenBot database version ${databaseVersion} is newer than this application supports (${supportedVersion}).`);
  }
}

function validateAppliedVersions(versions: number[]): void {
  const newestVersion = versions.at(-1) ?? 0;
  if (newestVersion > LATEST_SCHEMA_VERSION) {
    throw new NewerDatabaseError(newestVersion, LATEST_SCHEMA_VERSION);
  }

  const baselineAndLater = versions.filter((version) => version >= BASELINE_SCHEMA_VERSION);
  if (baselineAndLater.length === 0) return;
  const applied = new Set(baselineAndLater);
  for (let version = BASELINE_SCHEMA_VERSION; version <= newestVersion; version += 1) {
    if (!applied.has(version)) {
      throw new Error(`OpenBot database migration history is missing version ${version}.`);
    }
  }
}

function latestAppliedVersion(versions: number[]): number {
  const baselineAndLater = versions.filter((version) => version >= BASELINE_SCHEMA_VERSION);
  return baselineAndLater.at(-1) ?? BASELINE_SCHEMA_VERSION - 1;
}

function runMigration(
  db: DatabaseSync,
  migration: OpenBotMigration,
  appliedAt: string,
  violationsBefore: ReadonlyMap<string, number>,
): Map<string, number> {
  if (migration.disableForeignKeys) db.exec("PRAGMA foreign_keys = OFF");
  try {
    return withTransaction(db, () => {
      migration.up(db, appliedAt);
      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(migration.version, appliedAt);
      return assertForeignKeys(db, violationsBefore);
    });
  } finally {
    if (migration.disableForeignKeys) db.exec("PRAGMA foreign_keys = ON");
  }
}

function assertForeignKeys(db: DatabaseSync, before: ReadonlyMap<string, number>): Map<string, number> {
  const violations = readForeignKeyViolations(db);
  const added = [...violations]
    .map(([reference, count]) => [reference, count - (before.get(reference) ?? 0)] as const)
    .filter(([, count]) => count > 0);
  if (added.length > 0) {
    const total = added.reduce((sum, [, count]) => sum + count, 0);
    const references = added.map(([reference]) => reference).join(", ");
    throw new Error(`OpenBot database migration produced ${total} foreign-key violation(s) in ${references}.`);
  }
  return violations;
}

/**
 * Counts the broken references per child and parent table. A rebuild gives the rows new rowids and the table new
 * foreign-key ids, so only the table names identify a violation from one migration to the next.
 */
function readForeignKeyViolations(db: DatabaseSync): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of db.prepare("PRAGMA foreign_key_check").all()) {
    // Every row counts, also one of an unexpected shape, so that the check cannot miss a violation.
    const reference = isDynamicRecord(row) ? `${String(row.table)} -> ${String(row.parent)}` : "unknown";
    counts.set(reference, (counts.get(reference) ?? 0) + 1);
  }
  return counts;
}

function readOldForeignKeyViolations(db: DatabaseSync): Map<string, number> {
  const violations = readForeignKeyViolations(db);
  if (violations.size > 0) {
    logger.warn("The OpenBot database has foreign-key violations from before this upgrade. They stay as they are.", {
      violations: Object.fromEntries(violations),
    });
  }
  return violations;
}

function assertQuickCheck(db: DatabaseSync): void {
  assertQuickCheckResult(
    db
      .prepare("PRAGMA quick_check(20)")
      .all()
      .map((row) => (isDynamicRecord(row) ? row.quick_check : row)),
  );
}

/** Throws the integrity error unless the lines of a `PRAGMA quick_check` are the one line "ok". */
export function assertQuickCheckResult(problems: readonly unknown[]): void {
  if (problems.length === 1 && problems[0] === "ok") return;
  // The lines name the damaged pages and tables, which tell a page left by a disk save from a bad index.
  logger.error("The OpenBot database failed its integrity check.", { problems });
  throw new Error(sourceText("error.backend.databaseIntegrity"));
}
