// @vitest-environment node

// A new install and an upgraded install are built by two different code paths:
// `createLatestDatabase` execs LATEST_SCHEMA_SQL and stamps every migration as
// applied without running it, while an existing database runs the migrations.
// Nothing but a comment keeps the two in agreement, so the first DDL migration
// that is not also mirrored into LATEST_SCHEMA_SQL would ship new installs a
// database missing a column while upgraded installs get it - on users' machines,
// with no backup to fall back on. These tests are that agreement.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { readAppliedVersions, readNormalizedDeclarations, readTableShapes } from "./migration-harness";
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
  it("gives a new install the same tables, columns, indexes and foreign keys as an upgraded one", async () => {
    const fresh = await newInstallDatabase();
    const upgraded = await upgradedInstallDatabase();

    expect(readTableShapes(upgraded)).toEqual(readTableShapes(fresh));
  });

  it("gives a new install the same declarations as an upgraded one, including partial index filters", async () => {
    const fresh = await newInstallDatabase();
    const upgraded = await upgradedInstallDatabase();

    expect(readNormalizedDeclarations(upgraded)).toEqual(readNormalizedDeclarations(fresh));
  });

  it("records the same applied migration versions on both paths", async () => {
    const fresh = await newInstallDatabase();
    const upgraded = await upgradedInstallDatabase();

    expect(readAppliedVersions(upgraded)).toEqual(readAppliedVersions(fresh));
  });
});

// A migration runs on every computer that upgrades past its version, and there is no backup. So a
// shipped migration must never change: the fix is a new migration. The history file records what each
// version added, changed or dropped, as normalized DDL, with `null` for a dropped declaration. The
// entries only grow. A change to a recorded entry is allowed only for a version that has not shipped.
// Data-only statements, such as an UPDATE, leave no trace in the schema, so review still covers them.
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

// A rebuild, an altered column or a new index of a big table reads or writes every row of it, and one
// user database holds 12 GB of events. The large-database E2E measures such a migration; this list
// records the ones that were measured. Data-only rewrites and a VACUUM leave no trace in the history, so
// review still covers them (see "Large tables" in `src/backend/AGENTS.md`).
const LARGE_TABLES = ["orchestration_events", "provider_history_staging", "projection_thread_messages"];
const MEASURED_LARGE_TABLE_CHANGES: Record<string, readonly string[]> = {
  "40": ["index thread_messages_shown_order", "index thread_messages_turn", "table projection_thread_messages"],
  "43": ["index orchestration_events_thread_type"],
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

// Runs the upgrade path one migration at a time. A temporary trigger lets exactly one more version into
// `schema_migrations` per call, so the next migration rolls back and the database stays at the version
// before it. The next call resumes from there, as an install on that version would.
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
    const after = new Map(
      readNormalizedDeclarations(database).map((declaration) => [
        `${declaration.type} ${declaration.name}`,
        declaration.sql.join(" "),
      ]),
    );
    changes[String(version)] = diffDeclarations(before, after);
    before = after;
  }
}

function diffDeclarations(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): SchemaChanges {
  const changes: SchemaChanges = {};
  for (const [key, sql] of after) if (before.get(key) !== sql) changes[key] = sql;
  for (const key of before.keys()) if (!after.has(key)) changes[key] = null;
  return changes;
}

// An empty database has no tables, so `migrateOpenBotDatabase` takes the
// `createLatestDatabase` branch - the path every new install follows.
async function newInstallDatabase(): Promise<DatabaseSync> {
  const database = await openDatabase();
  migrateOpenBotDatabase(database, { appliedAt });
  return database;
}

// One empty table is enough for `hasExistingSchema` to report an existing
// database, and an empty `schema_migrations` reads as a version older than the
// baseline, so every migration runs in order from the v8 baseline SQL upwards -
// the path every upgraded install follows. Building the fixture this way rather
// than by stripping rows from a new install matters: a new install already
// carries the columns a future migration adds, so re-running that migration
// against it would fail on a duplicate column and go red on correct code.
async function upgradedInstallDatabase(): Promise<DatabaseSync> {
  const database = await openDatabase();
  database.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
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
