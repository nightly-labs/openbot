import type { DatabaseSync } from "node:sqlite";

export function withTransaction<T>(db: DatabaseSync, work: () => T): T {
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
  if (!db.isTransaction) return;
  db.exec(nested ? "ROLLBACK TO openbot_savepoint; RELEASE openbot_savepoint" : "ROLLBACK");
}
