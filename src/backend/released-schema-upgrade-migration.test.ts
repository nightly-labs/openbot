// @vitest-environment node

import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  actualRows,
  buildDatabaseAtVersion,
  buildReleasedDatabase,
  expectedRowsAfterUpgrade,
  HARNESS_APPLIED_AT,
  healthProblems,
  latestAppliedVersion,
  openHarnessDatabase,
  query,
  readAppliedVersions,
  readNormalizedDeclarations,
  readTableRows,
  readTableShapes,
  releasedDatabaseCases,
  seedEveryTable,
  sortedRows,
} from "./migration-harness";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

const connections: DatabaseSync[] = [];
afterEach(() => {
  for (const connection of connections.splice(0)) connection.close();
});

function open(): DatabaseSync {
  const db = openHarnessDatabase();
  connections.push(db);
  return db;
}

const fresh = (() => {
  let shape: { tables: unknown; declarations: unknown; versions: readonly number[]; migrationsTable: unknown } | null =
    null;
  return () => {
    if (shape) return shape;
    const db = open();
    migrateOpenBotDatabase(db, { appliedAt: HARNESS_APPLIED_AT });
    shape = {
      tables: readTableShapes(db),
      declarations: readNormalizedDeclarations(db),
      versions: readAppliedVersions(db),
      migrationsTable: query(db, "PRAGMA table_info(schema_migrations)"),
    };
    return shape;
  };
})();

function expectUpgradeKeepsData(db: DatabaseSync): void {
  seedEveryTable(db);
  expect(healthProblems(db), "The seeded database is not healthy before the upgrade.").toEqual([]);
  const fromVersion = latestAppliedVersion(db);
  const before = readTableRows(db);
  const oldMarkers = readAppliedVersions(db).filter((version) => version < 8);

  migrateOpenBotDatabase(db, { appliedAt: HARNESS_APPLIED_AT });

  const latest = fresh();
  const expected = expectedRowsAfterUpgrade(before, fromVersion, latest.versions.at(-1) ?? 0);
  expect(actualRows(db, expected)).toEqual(sortedRows(expected));
  const remaining = new Set(readTableRows(db).keys());
  expect(expected.dropped.filter((table) => remaining.has(table))).toEqual([]);
  expect(healthProblems(db)).toEqual([]);
  expect(query(db, "PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);
  expect(readTableShapes(db)).toEqual(latest.tables);
  expect(readNormalizedDeclarations(db)).toEqual(latest.declarations);
  expect(query(db, "PRAGMA table_info(schema_migrations)")).toEqual(latest.migrationsTable);
  expect(readAppliedVersions(db)).toEqual([...oldMarkers, ...latest.versions]);

  const afterFirst = { rows: readTableRows(db), declarations: readNormalizedDeclarations(db) };
  const appliedAt = query(db, "SELECT version, applied_at FROM schema_migrations ORDER BY version");
  migrateOpenBotDatabase(db, { appliedAt: "2026-12-01T00:00:00.000Z", closedCleanly: true });
  expect({ rows: readTableRows(db), declarations: readNormalizedDeclarations(db) }).toEqual(afterFirst);
  expect(query(db, "SELECT version, applied_at FROM schema_migrations ORDER BY version")).toEqual(appliedAt);
}

const releasedCases = releasedDatabaseCases();

describe("upgrade from the database of each shipped release", () => {
  it("has a released schema for each release", () => {
    expect(releasedCases.length).toBeGreaterThan(0);
  });

  it.each(releasedCases)("upgrades $name and keeps every row", (released) => {
    const db = open();
    buildReleasedDatabase(db, released);
    expectUpgradeKeepsData(db);
  });
});

const shippedVersions = [
  ...new Set(releasedCases.map((released) => released.migrations.at(-1) ?? 0).filter((version) => version >= 8)),
];

describe("upgrade from each shipped version made by this build", () => {
  it.each(shippedVersions)("upgrades version %i and keeps every row", (version) => {
    const db = open();
    buildDatabaseAtVersion(db, version);
    expect(latestAppliedVersion(db)).toBe(version);
    expectUpgradeKeepsData(db);
  });
});
