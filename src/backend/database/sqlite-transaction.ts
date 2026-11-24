import type { DatabaseSync } from "node:sqlite";

export function withTransaction<T>(db: DatabaseSync, work: () => T): T {
  const nested = db.isTransaction;
  db.exec(nested ? "SAVEPOINT openbot_savepoint" : "BEGIN IMMEDIATE");
  return finishTransaction(db, nested, work);
}

export function tryWriteTransaction<T>(db: DatabaseSync, work: () => T): T | undefined {
  if (db.isTransaction) return withTransaction(db, work);
  const timeout = db.prepare("PRAGMA busy_timeout").get()?.timeout;
  if (typeof timeout !== "number") throw new Error("Missing SQLite busy timeout");
  db.exec("PRAGMA busy_timeout = 0");
  try {
    db.exec("BEGIN IMMEDIATE");
  } catch (error) {
    db.exec(`PRAGMA busy_timeout = ${timeout}`);
    if (
      error instanceof Error &&
      "errcode" in error &&
      typeof error.errcode === "number" &&
      (error.errcode & 0xff) === 5
    )
      return undefined;
    throw error;
  }
  return finishTransaction(db, false, () => {
    db.exec(`PRAGMA busy_timeout = ${timeout}`);
    return work();
  });
}

function finishTransaction<T>(db: DatabaseSync, nested: boolean, work: () => T): T {
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
