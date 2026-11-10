import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createOpenBotLogger } from "@openbot/logging";
import { Cause, Effect, Result } from "effect";
import { migrateOpenBotDatabase, pendingMigrationSourceVersion } from "../openbot-database-schema";
import { storedIO, storedSync } from "../stored-state-effects";
import { databaseRow, errorCode, requiredNumberColumn, requiredStringColumn } from "./database-rows";
import { copyDatabaseBeforeMigration, DatabaseCopyFailure, type DatabaseCopyOptions } from "./pre-migration-copy";

const logger = createOpenBotLogger("openbot-database-copy");

export interface OrchestrationEventInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  occurredAt?: string;
}

interface ReceiptRow {
  last_sequence: number;
  result_json: string;
}

/**
 * A SQL function that turns each run of whitespace into one space. Search uses it so that a query
 * with a space finds a message that a line break splits.
 */
export const COLLAPSE_WHITESPACE_FUNCTION = "openbot_collapse_whitespace";

/**
 * A SQL function that lowercases text with the full Unicode rules. SQLite `LOWER` changes only
 * ASCII letters, so "État" would not match the query "état".
 */
export const LOWERCASE_FUNCTION = "openbot_lowercase";

export interface DatabaseCoreOptions {
  userDataPath: string;
  /** The copy of `openbot.db` that a start makes before a migration. */
  copy?: DatabaseCopyOptions;
}

/**
 * The SQLite handle and the append-events, project, write-receipt primitive every other database
 * controller is built on.
 *
 * Owns the open connection, the file on disk and its migration, the orchestration event log and
 * its command receipts, and the transaction ownership rule: only the caller that finds no open
 * transaction opens and closes one, so a projector may nest another dispatch inside its own.
 * Controllers hold this object and read `connection` at each use — a cached handle survives
 * `initialize` and then silently addresses a closed database after `close`. The class knows
 * nothing about projections and never imports the facade.
 */
export class DatabaseCore {
  readonly path: string;
  readonly #legacyBackupRoot: string;
  readonly #copy: DatabaseCopyOptions;
  #db: DatabaseSync | null = null;

  constructor(options: DatabaseCoreOptions) {
    this.path = join(options.userDataPath, "openbot.db");
    this.#legacyBackupRoot = join(options.userDataPath, "legacy-backup-v1");
    this.#copy = options.copy ?? {};
  }

  initialize = Effect.fn("DatabaseCore.initialize")(function* (this: DatabaseCore) {
    if (this.#db) return;
    yield* storedIO(() => mkdir(dirname(this.path), { recursive: true, mode: 0o700 }));
    // Read before the open: the first statement makes a new write-ahead log.
    const closedCleanly = yield* storedSync(() => !existsSync(`${this.path}-wal`));
    const db = yield* storedSync(() => new DatabaseSync(this.path));
    const configured = yield* Effect.result(
      Effect.gen({ self: this }, function* () {
        const sourceVersion = yield* storedSync(() => {
          db.exec("PRAGMA journal_mode = WAL");
          db.exec("PRAGMA foreign_keys = ON");
          db.exec("PRAGMA busy_timeout = 5000");
          db.exec("PRAGMA synchronous = NORMAL");
          db.function(COLLAPSE_WHITESPACE_FUNCTION, { deterministic: true }, (value) =>
            typeof value === "string" ? value.replace(/\s+/gu, " ") : value,
          );
          db.function(LOWERCASE_FUNCTION, { deterministic: true }, (value) =>
            typeof value === "string" ? value.toLocaleLowerCase() : value,
          );
          this.#db = db;
          return pendingMigrationSourceVersion(db);
        });
        if (sourceVersion !== null) yield* this.#copyBeforeMigration(db, sourceVersion);
        yield* storedSync(() => this.#migrate(closedCleanly));
        yield* storedIO(() => chmod(this.path, 0o600));
      }),
    );
    if (Result.isFailure(configured)) {
      yield* storedSync(() => {
        db.close();
        this.#db = null;
      });
      // The close removed the write-ahead log. An empty one makes the next start run the check again,
      // so a database that failed it does not open at the next start.
      yield* storedSync(() => appendFileSync(`${this.path}-wal`, "", { mode: 0o600 })).pipe(Effect.ignore);
      return yield* configured.failure;
    }
  }, Effect.uninterruptible);

  close(): void {
    this.#db?.close();
    this.#db = null;
  }

  get connection(): DatabaseSync {
    if (!this.#db) throw new Error("OpenBot database is not initialized.");
    return this.#db;
  }

  dispatch<T>(
    commandId: string,
    events: OrchestrationEventInput[],
    project: (db: DatabaseSync, sequences: number[]) => T,
  ): T {
    const db = this.connection;
    const receipt = decodeReceiptRow(
      db
        .prepare("SELECT last_sequence, result_json FROM orchestration_command_receipts WHERE command_id = ?")
        .get(commandId),
    );
    if (receipt) return JSON.parse(receipt.result_json);

    const ownsTransaction = !db.isTransaction;
    if (ownsTransaction) db.exec("BEGIN IMMEDIATE");
    try {
      const sequences: number[] = [];
      const append = db.prepare(`
        INSERT INTO orchestration_events (
          event_id, command_id, aggregate_type, aggregate_id, event_type, occurred_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const event of events) {
        const result = append.run(
          randomUUID(),
          commandId,
          event.aggregateType,
          event.aggregateId,
          event.eventType,
          event.occurredAt ?? new Date().toISOString(),
          JSON.stringify(event.payload),
        );
        sequences.push(Number(result.lastInsertRowid));
      }
      const result = project(db, sequences);
      // A receipt is deleted with its command's events. A command that keeps no event, such as the
      // memory transaction wrapper or a channel delete that removes its own event, gets no receipt,
      // because nothing would delete it.
      const keepsEvent = db.prepare("SELECT 1 FROM orchestration_events WHERE command_id = ? LIMIT 1").get(commandId);
      if (keepsEvent) {
        db.prepare(
          `INSERT INTO orchestration_command_receipts
            (command_id, accepted_at, first_sequence, last_sequence, result_json)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(
          commandId,
          new Date().toISOString(),
          sequences[0] ?? 0,
          sequences.at(-1) ?? 0,
          JSON.stringify(result ?? null),
        );
      }
      if (ownsTransaction) db.exec("COMMIT");
      return result;
    } catch (error) {
      if (ownsTransaction && db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  commandResult(commandId: string): unknown | undefined {
    const receipt = decodeReceiptRow(
      this.connection
        .prepare("SELECT last_sequence, result_json FROM orchestration_command_receipts WHERE command_id = ?")
        .get(commandId),
    );
    return receipt ? JSON.parse(receipt.result_json) : undefined;
  }

  deleteEventsAndReceipt(commandId: string): void {
    const db = this.connection;
    const ownsTransaction = !db.isTransaction;
    if (ownsTransaction) db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM orchestration_events WHERE command_id = ?").run(commandId);
      db.prepare("DELETE FROM orchestration_command_receipts WHERE command_id = ?").run(commandId);
      if (ownsTransaction) db.exec("COMMIT");
    } catch (error) {
      if (ownsTransaction && db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  backupLegacyFile = Effect.fn("DatabaseCore.backupLegacyFile")(function* (this: DatabaseCore, path: string) {
    const found = yield* Effect.result(storedIO(() => readFile(path)));
    if (Result.isFailure(found)) {
      if (errorCode(found.failure.cause) === "ENOENT") return;
      return yield* found.failure;
    }
    yield* storedIO(() => mkdir(this.#legacyBackupRoot, { recursive: true, mode: 0o700 }));
    const target = join(this.#legacyBackupRoot, basename(path));
    yield* storedIO(() => copyFile(path, target, 1)).pipe(
      Effect.catch((failure) => (errorCode(failure.cause) === "EEXIST" ? Effect.void : Effect.fail(failure))),
    );
    yield* storedIO(() => chmod(target, 0o600));
  }, Effect.uninterruptible);

  hasAggregateEvents(aggregateType: string, aggregateId: string): boolean {
    return Boolean(
      this.connection
        .prepare("SELECT 1 FROM orchestration_events WHERE aggregate_type = ? AND aggregate_id = ? LIMIT 1")
        .get(aggregateType, aggregateId),
    );
  }

  /**
   * Copies the database before its first pending migration, so a user can go back to the release
   * before it. A failed or skipped copy only logs a warning, and the migration runs as it did before
   * copies existed: a copy is a second chance, and a start that a copy stops would lock the user out
   * of data that is intact. The log has no path, only the copy's file name, sizes and an error code.
   */
  #copyBeforeMigration(db: DatabaseSync, sourceVersion: number): Effect.Effect<void> {
    return copyDatabaseBeforeMigration({ ...this.#copy, db, databasePath: this.path, sourceVersion }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          if (result.status === "copied") {
            logger.info(`Copied the OpenBot database before its migration from schema version ${sourceVersion}.`, {
              fileName: result.fileName,
              removedCopies: result.removedCopies,
            });
          } else if (result.status === "kept") {
            // A migration of this version committed in part before an earlier start failed.
            logger.info(
              `Kept the copy from before the first migration attempt of this version. The migration continues from schema version ${sourceVersion}.`,
              { fileName: result.fileName },
            );
          } else {
            logger.warn(
              `The disk has not enough free space for a copy of the OpenBot database. The migration from schema version ${sourceVersion} continues without a copy.`,
              { requiredBytes: result.requiredBytes, freeBytes: result.freeBytes },
            );
          }
        }),
      ),
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          const found = Cause.findError(cause);
          const failure = Result.isSuccess(found) ? found.success : null;
          const detail = {
            stage: failure instanceof DatabaseCopyFailure ? failure.stage : "unknown",
            code: errorCode(failure ? failure.cause : Cause.squash(cause)) ?? "unknown",
          };
          logger.warn(
            failure?.stage === "rotate"
              ? "Copied the OpenBot database, but could not remove the older copies."
              : `The copy of the OpenBot database failed. The migration from schema version ${sourceVersion} continues without a copy.`,
            detail,
          );
        }),
      ),
    );
  }

  #migrate(closedCleanly: boolean): void {
    migrateOpenBotDatabase(this.connection, { closedCleanly });
  }
}

function decodeReceiptRow(value: unknown): ReceiptRow | null {
  const row = databaseRow(value);
  if (!row) return null;
  return {
    last_sequence: requiredNumberColumn(row, "last_sequence"),
    result_json: requiredStringColumn(row, "result_json"),
  };
}

/**
 * Deletes the receipts of commands whose events were just dropped. Each receipt is deleted by key,
 * because a sweep for every orphan scans the whole receipts table, which grows without limit. The
 * `NOT EXISTS` guard keeps a receipt whose command still has an event.
 */
export function deleteReceiptsOf(db: DatabaseSync, commandIds: readonly string[]): void {
  if (commandIds.length === 0) return;
  const deleteReceipt = db.prepare(
    `DELETE FROM orchestration_command_receipts
     WHERE command_id = ?
       AND NOT EXISTS (SELECT 1 FROM orchestration_events WHERE command_id = ?)`,
  );
  for (const commandId of commandIds) deleteReceipt.run(commandId, commandId);
}

export function deleteAggregateHistory(db: DatabaseSync, aggregateType: string, aggregateIds: readonly string[]): void {
  if (!aggregateIds.length) return;
  const placeholders = aggregateIds.map(() => "?").join(", ");
  db.prepare(
    `DELETE FROM orchestration_command_receipts WHERE command_id IN (
       SELECT DISTINCT command_id FROM orchestration_events
       WHERE aggregate_type = ? AND aggregate_id IN (${placeholders})
     )`,
  ).run(aggregateType, ...aggregateIds);
  db.prepare(`DELETE FROM orchestration_events WHERE aggregate_type = ? AND aggregate_id IN (${placeholders})`).run(
    aggregateType,
    ...aggregateIds,
  );
}

/**
 * Deletes the attachments of every message of a thread. Their owner is `<thread>:<message>`, and a range
 * from `<thread>:` up to `<thread>;` (the next character) reads the owner index; `LIKE` cannot (#2241).
 */
export function deleteThreadAttachments(db: DatabaseSync, threadId: string): void {
  db.prepare(
    "DELETE FROM projection_attachments WHERE owner_kind = 'thread-message' AND owner_id >= ? AND owner_id < ?",
  ).run(`${threadId}:`, `${threadId};`);
}
