import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/** An in-memory database with the migrations in order, up to and including `last`. */
export function migratedDatabase(last?: string): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(new URL("../migrations/", import.meta.url)).sort()) {
    if (last && name > last) break;
    database.exec(migration(name));
  }
  return database;
}

export function migration(name: string): string {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

/**
 * A D1 binding over node:sqlite. D1 runs a batch as one transaction; so does this. Batches run one
 * after another, because two open transactions on one connection fail.
 */
export function sqliteD1(database: DatabaseSync): D1Database {
  const unused = () => {
    throw new Error("Unused");
  };
  let batchChain: Promise<unknown> = Promise.resolve();
  return {
    prepare: (query) => statement(database, query),
    batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const operation = batchChain.then(async () => {
        database.exec("BEGIN");
        try {
          const results: D1Result<T>[] = [];
          for (const prepared of statements) results.push(await prepared.all<T>());
          database.exec("COMMIT");
          return results;
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      });
      batchChain = operation.catch(() => undefined);
      return operation;
    },
    exec: unused,
    withSession: unused,
    dump: unused,
  };
}

function statement(database: DatabaseSync, query: string, values: SQLInputValue[] = []): D1PreparedStatement {
  const result = <T>(results: T[], changes: number): D1Result<T> => ({
    success: true,
    results,
    meta: {
      changes,
      duration: 0,
      last_row_id: 0,
      changed_db: changes > 0,
      size_after: 0,
      rows_read: 0,
      rows_written: changes,
    },
  });
  return {
    bind: (...input) =>
      statement(
        database,
        query,
        input.map((value) => {
          if (value === null || typeof value === "string" || typeof value === "number") return value;
          throw new Error("Invalid binding");
        }),
      ),
    async first<T>(column?: string): Promise<T | null> {
      const row = database.prepare(query).get(...values);
      return row ? JSON.parse(JSON.stringify(column ? row[column] : row)) : null;
    },
    async all<T>(): Promise<D1Result<T>> {
      const before = totalChanges(database);
      const rows = JSON.parse(JSON.stringify(database.prepare(query).all(...values)));
      return result(rows, totalChanges(database) - before);
    },
    async run<T>(): Promise<D1Result<T>> {
      const before = totalChanges(database);
      database.prepare(query).run(...values);
      return result<T>([], totalChanges(database) - before);
    },
    raw() {
      throw new Error("Unused raw");
    },
  };
}

/** D1 counts the rows that triggers change too, like SQLite `total_changes()`. */
function totalChanges(database: DatabaseSync): number {
  return Number(database.prepare("SELECT total_changes() AS changes").get()?.changes);
}
