import type { DatabaseSync, StatementSync } from "node:sqlite";

const caches = new WeakMap<DatabaseSync, Map<string, StatementSync>>();

/**
 * A prepared statement for SQL that has no variable parts, kept for the connection. Each streamed
 * flush of each agent writes through several statements, and to prepare them again on each call
 * parsed the same SQL hundreds of times a second with many agents. Use it with `get`, `all` and
 * `run` only: a statement that `iterate` reads stays busy until the loop ends, and a second caller
 * would reset it.
 */
export function cachedStatement(db: DatabaseSync, sql: string): StatementSync {
  let cache = caches.get(db);
  if (!cache) {
    cache = new Map();
    caches.set(db, cache);
  }
  let statement = cache.get(sql);
  if (!statement) {
    statement = db.prepare(sql);
    cache.set(sql, statement);
  }
  return statement;
}

/** Drops the statements of a connection that closes. */
export function forgetStatements(db: DatabaseSync): void {
  caches.delete(db);
}
