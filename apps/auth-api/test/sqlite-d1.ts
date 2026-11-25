import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

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
