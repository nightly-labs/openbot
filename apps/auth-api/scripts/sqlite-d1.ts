import type { DatabaseSync, SQLInputValue } from "node:sqlite";

export function sqliteD1(database: DatabaseSync): D1Database {
  const changes = () => Number(database.prepare("SELECT total_changes() AS changes").get()?.changes);
  const result = <T>(results: T[], changed: number): D1Result<T> => ({
    success: true,
    results,
    meta: {
      changes: changed,
      duration: 0,
      last_row_id: 0,
      changed_db: changed > 0,
      size_after: 0,
      rows_read: 0,
      rows_written: changed,
    },
  });
  const allNow = <T>(query: string, values: SQLInputValue[]): D1Result<T> => {
    const before = changes();
    const rows = JSON.parse(JSON.stringify(database.prepare(query).all(...values)));
    return result<T>(rows, changes() - before);
  };
  const queries = new WeakMap<D1PreparedStatement, { query: string; values: SQLInputValue[] }>();
  const statement = (query: string, values: SQLInputValue[] = []): D1PreparedStatement => {
    const prepared: D1PreparedStatement = {
      bind: (...input: unknown[]) =>
        statement(
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
        return allNow<T>(query, values);
      },
      async run<T>(): Promise<D1Result<T>> {
        const before = changes();
        database.prepare(query).run(...values);
        return result<T>([], changes() - before);
      },
      raw: () => {
        throw new Error("Unused raw");
      },
    };
    queries.set(prepared, { query, values });
    return prepared;
  };
  const unused = () => {
    throw new Error("Unused");
  };
  const batch = async <T>(statements: D1PreparedStatement[]) => {
    database.exec("BEGIN");
    try {
      const results: D1Result<T>[] = [];
      for (const prepared of statements) {
        const entry = queries.get(prepared);
        if (!entry) throw new Error("A batch statement is not from this database.");
        results.push(allNow<T>(entry.query, entry.values));
      }
      database.exec("COMMIT");
      return results;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  };
  const prepare = (query: string) => statement(query);
  return {
    prepare,
    batch,
    exec: unused,
    withSession: () => ({ prepare, batch, getBookmark: () => null }),
    dump: unused,
  };
}
