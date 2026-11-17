import type { DatabaseSync } from "node:sqlite";

/**
 * The only place that runs `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT` and `RELEASE` on a
 * `node:sqlite` connection (Biome rule `no-raw-sqlite-transaction`). Nothing copies `openbot.db`
 * before an upgrade, so a write that stops half done cannot be put back from a backup.
 */

let savepointCount = 0;

/**
 * Runs `work` in one transaction. With no open transaction it runs `BEGIN IMMEDIATE` and `COMMIT`.
 * Inside an open transaction it runs in a savepoint, so a nested write joins the caller's
 * transaction. An error rolls back only this level and is thrown again, and the connection is
 * never left in a transaction that this call opened.
 *
 * `work` must be synchronous: the transaction ends when it returns. Use `withTransactionAsync`
 * for work that awaits.
 */
export function withTransaction<T>(db: DatabaseSync, work: () => T): T {
  if (!db.isTransaction) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      rollback(db);
      throw error;
    }
  }
  savepointCount += 1;
  const savepoint = `openbot_savepoint_${savepointCount}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    const result = work();
    db.exec(`RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    // SQLite ends the whole transaction itself on some failures, such as a full disk. Then the
    // savepoint is gone, and `ROLLBACK TO` would replace the error that caused it.
    if (db.isTransaction) {
      db.exec(`ROLLBACK TO ${savepoint}`);
      db.exec(`RELEASE ${savepoint}`);
    }
    throw error;
  }
}

/**
 * Runs asynchronous `work` in one `BEGIN IMMEDIATE` transaction. It never nests: another caller
 * can run on the connection while `work` awaits, and a savepoint would then join a transaction
 * that this caller does not own. SQLite rejects the `BEGIN` when a transaction is open.
 */
export async function withTransactionAsync<T>(db: DatabaseSync, work: () => Promise<T>): Promise<T> {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = await work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    rollback(db);
    throw error;
  }
}

function rollback(db: DatabaseSync): void {
  // SQLite may have rolled back already, and a second ROLLBACK would replace the error that did it.
  if (db.isTransaction) db.exec("ROLLBACK");
}
