import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { Effect, Result } from "effect";
import {
  assertQuickCheckResult,
  migrateOpenBotDatabase,
  openBotDatabaseNeedsMigration,
} from "../openbot-database-schema";
import { storedIO, storedSync } from "../stored-state-effects";
import { databaseRow, errorCode, requiredNumberColumn, requiredStringColumn } from "./database-rows";
import { withTransaction } from "./sqlite-transaction";
import { cachedStatement, forgetStatements } from "./statement-cache";

export interface OrchestrationEventInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  occurredAt?: string;
}

const SELECT_RECEIPT_SQL = "SELECT last_sequence, result_json FROM orchestration_command_receipts WHERE command_id = ?";

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
  /**
   * Runs `PRAGMA quick_check(20)` on the file at the path in another process and gives its lines, or
   * null when it could not run there. Used after a stop that did not close the file: the check reads
   * every page, and on a large file it would stop the calling thread for minutes. Without it, or when
   * it gives null, the check runs on the calling thread as before.
   */
  checkIntegrity?: ((databasePath: string) => Effect.Effect<readonly unknown[] | null>) | undefined;
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
  readonly #checkIntegrity: DatabaseCoreOptions["checkIntegrity"];
  #db: DatabaseSync | null = null;

  constructor(options: DatabaseCoreOptions) {
    this.path = join(options.userDataPath, "openbot.db");
    this.#legacyBackupRoot = join(options.userDataPath, "legacy-backup-v1");
    this.#checkIntegrity = options.checkIntegrity;
  }

  initialize = Effect.fn("DatabaseCore.initialize")(function* (this: DatabaseCore) {
    if (this.#db) return;
    yield* storedIO(() => mkdir(dirname(this.path), { recursive: true, mode: 0o700 }));
    // Read before the open: the first statement makes a new write-ahead log.
    const closedCleanly = yield* storedSync(() => !existsSync(`${this.path}-wal`));
    const db = yield* storedSync(() => new DatabaseSync(this.path));
    const configured = yield* Effect.result(
      Effect.gen({ self: this }, function* () {
        yield* storedSync(() => {
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
        });
        // A migration checks the file on this thread after it runs, so a check before it would read it twice.
        const checkIntegrity = this.#checkIntegrity;
        const problems =
          closedCleanly || !checkIntegrity || (yield* storedSync(() => openBotDatabaseNeedsMigration(db)))
            ? null
            : yield* checkIntegrity(this.path);
        if (problems) yield* storedSync(() => assertQuickCheckResult(problems));
        yield* storedSync(() => {
          this.#db = db;
          // A file that passed the check here does not need it again, unless a migration runs.
          this.#migrate(closedCleanly || problems !== null);
        });
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
    if (this.#db) forgetStatements(this.#db);
    this.#db?.close();
    this.#db = null;
  }

  get connection(): DatabaseSync {
    if (!this.#db) throw new Error("OpenBot database is not initialized.");
    return this.#db;
  }

  /** A prepared statement of the open connection, kept as `cachedStatement` says. */
  statement(sql: string): StatementSync {
    return cachedStatement(this.connection, sql);
  }

  dispatch<T>(
    commandId: string,
    events: OrchestrationEventInput[],
    project: (db: DatabaseSync, sequences: number[]) => T,
  ): T {
    const db = this.connection;
    const receipt = decodeReceiptRow(this.statement(SELECT_RECEIPT_SQL).get(commandId));
    if (receipt) return JSON.parse(receipt.result_json);

    return withTransaction(db, () => {
      const sequences: number[] = [];
      const append = this.statement(`
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
      const keepsEvent = this.statement("SELECT 1 FROM orchestration_events WHERE command_id = ? LIMIT 1").get(
        commandId,
      );
      if (keepsEvent) {
        this.statement(
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
      return result;
    });
  }

  commandResult(commandId: string): unknown | undefined {
    const receipt = decodeReceiptRow(this.statement(SELECT_RECEIPT_SQL).get(commandId));
    return receipt ? JSON.parse(receipt.result_json) : undefined;
  }

  deleteEventsAndReceipt(commandId: string): void {
    const db = this.connection;
    withTransaction(db, () => {
      db.prepare("DELETE FROM orchestration_events WHERE command_id = ?").run(commandId);
      db.prepare("DELETE FROM orchestration_command_receipts WHERE command_id = ?").run(commandId);
    });
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
  const deleteReceipt = cachedStatement(
    db,
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
