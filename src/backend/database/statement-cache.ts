import type { DatabaseSync, StatementSync } from "node:sqlite";

const caches = new WeakMap<DatabaseSync, Map<string, StatementSync>>();

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

export function forgetStatements(db: DatabaseSync): void {
  caches.delete(db);
}
