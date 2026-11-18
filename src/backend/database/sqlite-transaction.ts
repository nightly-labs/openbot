import type { DatabaseSync } from "node:sqlite";

// The only code that runs transaction statements on a `node:sqlite` connection (Biome rule
// `no-raw-sqlite-transaction`). See src/backend/AGENTS.md.

/**
 * Runs synchronous `work` in `BEGIN IMMEDIATE`, or in a savepoint when a transaction is open.
 * A failure rolls back only this level and is thrown again.
 */
export function withTransaction<T>(db: DatabaseSync, work: () => T): T {
  // Levels are strictly nested, and SQLite uses the most recent savepoint of a name.
  const nested = db.isTransaction;
  db.exec(nested ? "SAVEPOINT openbot_savepoint" : "BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec(nested ? "RELEASE openbot_savepoint" : "COMMIT");
    return result;
  } catch (error) {
    rollback(db, nested);
    throw error;
  }
}

/**
 * Runs `work` that awaits in `BEGIN IMMEDIATE`. It never nests: another caller can use the
 * connection during an await, so SQLite rejects the `BEGIN` when a transaction is open.
 */
export async function withTransactionAsync<T>(db: DatabaseSync, work: () => Promise<T>): Promise<T> {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = await work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    rollback(db, false);
    throw error;
  }
}

function rollback(db: DatabaseSync, nested: boolean): void {
  // SQLite ends the transaction itself on some failures (a full disk). A second rollback would
  // then throw and hide that error.
  if (!db.isTransaction) return;
  db.exec(nested ? "ROLLBACK TO openbot_savepoint; RELEASE openbot_savepoint" : "ROLLBACK");
}
