// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { readAppliedVersions, readNormalizedDeclarations } from "./migration-harness";
import { migrateOpenBotDatabase } from "./openbot-database-schema";
import recordedSchemaHistory from "./openbot-database-schema-history.json";

const appliedAt = "2026-09-03T10:00:00.000Z";

const roots: string[] = [];
const connections: DatabaseSync[] = [];

afterEach(async () => {
  for (const connection of connections.splice(0)) connection.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("OpenBot database build paths", () => {
  it("gives a new install the schema that the recorded history of every migration makes", async () => {
    const fresh = await newInstallDatabase();
    const recorded = new Map<string, string>();
    for (const changes of Object.values<SchemaChanges>(recordedSchemaHistory)) {
      for (const [key, sql] of Object.entries(changes)) {
        if (sql === null) recorded.delete(key);
        else recorded.set(key, sql);
      }
    }

    expect(Object.fromEntries(declarationsByKey(fresh))).toEqual(Object.fromEntries(recorded));
  });

  it("records every migration version on a new install", async () => {
    const fresh = await newInstallDatabase();

    expect(readAppliedVersions(fresh)).toEqual(Object.keys(recordedSchemaHistory).map(Number));
  });
});

describe("OpenBot database migration history", () => {
  it("keeps the schema change of every recorded migration", async () => {
    const actual = await schemaChangesByVersion();

    for (const [version, recorded] of Object.entries(recordedSchemaHistory)) {
      expect(actual[version], `Migration ${version} shipped. Add a new migration instead of editing it.`).toEqual(
        recorded,
      );
    }
    const unrecorded = Object.keys(actual).filter((version) => !Object.hasOwn(recordedSchemaHistory, version));
    const missing = Object.fromEntries(unrecorded.map((version) => [version, actual[version]]));
    expect(
      unrecorded,
      `Add each new migration to openbot-database-schema-history.json: ${JSON.stringify(missing, null, 2)}`,
    ).toEqual([]);
  });
});

const LARGE_TABLES = ["orchestration_events", "provider_history_staging", "projection_thread_messages"];
const MEASURED_LARGE_TABLE_CHANGES: Record<string, readonly string[]> = {
  "40": ["index thread_messages_shown_order", "index thread_messages_turn", "table projection_thread_messages"],
  "43": ["index orchestration_events_thread_type"],
  "67": ["index thread_messages_ordinal"],
};

describe("OpenBot database migrations of large tables", () => {
  it("lists each migration that changes a large table that exists, so that its cost is measured", () => {
    const history: Record<string, SchemaChanges> = recordedSchemaHistory;
    const existing = new Set<string>();
    const changes: Record<string, readonly string[]> = {};
    for (const [version, declarations] of Object.entries(history)) {
      const touched = Object.entries(declarations)
        .filter(([key, sql]) => {
          const [kind, name] = key.split(" ");
          const table = kind === "table" ? name : sql && /\bON (\w+)/u.exec(sql)?.[1]?.toLowerCase();
          return Boolean(table && LARGE_TABLES.includes(table) && existing.has(table));
        })
        .map(([key]) => key)
        .sort();
      if (touched.length > 0) changes[version] = touched;
      for (const [key, sql] of Object.entries(declarations)) {
        const [kind, name = ""] = key.split(" ");
        if (kind !== "table") continue;
        if (sql === null) existing.delete(name);
        else existing.add(name);
      }
    }
    expect(
      changes,
      "A migration changes a large table. Run `bun scripts/migration-large-db-e2e.ts --from=<last shipped version>`, " +
        "put the numbers in the PR, then add the version to MEASURED_LARGE_TABLE_CHANGES.",
    ).toEqual(MEASURED_LARGE_TABLE_CHANGES);
  });
});

type SchemaChanges = Record<string, string | null>;

const STOP_MESSAGE = "stopped after one migration";

async function schemaChangesByVersion(): Promise<Record<string, SchemaChanges>> {
  const database = await openDatabase();
  database.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const changes: Record<string, SchemaChanges> = {};
  let before = new Map<string, string>();

  for (;;) {
    const appliedBefore = readAppliedVersions(database).length;
    database.exec(`
      DROP TRIGGER IF EXISTS temp.stop_after_one_migration;
      CREATE TEMP TRIGGER stop_after_one_migration BEFORE INSERT ON schema_migrations
      WHEN (SELECT COUNT(*) FROM schema_migrations) > ${appliedBefore}
      BEGIN SELECT RAISE(ABORT, '${STOP_MESSAGE}'); END;
    `);
    try {
      migrateOpenBotDatabase(database, { appliedAt });
    } catch (error) {
      if (!(error instanceof Error && error.cause instanceof Error && error.cause.message.includes(STOP_MESSAGE))) {
        throw error;
      }
    }

    const applied = readAppliedVersions(database);
    const version = applied.at(-1);
    if (applied.length === appliedBefore || version === undefined) return changes;
    const after = declarationsByKey(database);
    changes[String(version)] = diffDeclarations(before, after);
    before = after;
  }
}

function declarationsByKey(database: DatabaseSync): Map<string, string> {
  return new Map(
    readNormalizedDeclarations(database).map((declaration) => [
      `${declaration.type} ${declaration.name}`,
      declaration.sql.join(" "),
    ]),
  );
}

function diffDeclarations(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): SchemaChanges {
  const changes: SchemaChanges = {};
  for (const [key, sql] of after) if (before.get(key) !== sql) changes[key] = sql;
  for (const key of before.keys()) if (!after.has(key)) changes[key] = null;
  return changes;
}

async function newInstallDatabase(): Promise<DatabaseSync> {
  const database = await openDatabase();
  migrateOpenBotDatabase(database, { appliedAt });
  return database;
}

async function openDatabase(): Promise<DatabaseSync> {
  const root = await mkdtemp(join(tmpdir(), "openbot-schema-parity-"));
  roots.push(root);
  const database = new DatabaseSync(join(root, "openbot.db"));
  connections.push(database);
  return database;
}
