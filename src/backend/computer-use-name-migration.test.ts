// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function databaseAt(version: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TEMP TRIGGER stop_at_version BEFORE INSERT ON schema_migrations WHEN new.version > ${version}
    BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
  expect(() => migrateOpenBotDatabase(db)).toThrow(`migration to version ${version + 1} failed`);
  db.exec("DROP TRIGGER stop_at_version");
  return db;
}

function seedServers(db: DatabaseSync): void {
  db.exec(`INSERT INTO projection_mcp_servers
      (mcp_server_id, name, transport, enabled, command, args_json, env_json, env_passthrough_json,
       working_directory, url, headers_json, position, created_at, updated_at)
    VALUES
      ('mcp-1', 'Computer_Use', 'stdio', 1, 'my-driver', '["--serve"]', '[{"name":"MODE","value":"fast"}]', '[]',
        '/Users/user/tools', '', '[]', 0, '2026-09-14T10:00:00.000Z', '2026-09-14T10:00:00.000Z'),
      ('mcp-2', 'computer_use', 'http', 0, '', '[]', '[]', '[]', '', 'https://example.com/mcp',
        '[{"name":"X-Team","value":"core"}]', 1, '2026-09-14T10:01:00.000Z', '2026-09-14T10:01:00.000Z'),
      ('mcp-3', 'COMPUTER_USE_SAVED', 'stdio', 1, 'other', '[]', '[]', '["HOME"]', '', '', '[]', 2,
        '2026-09-14T10:02:00.000Z', '2026-09-14T10:02:00.000Z'),
      ('mcp-4', 'github', 'stdio', 1, 'github-mcp', '[]', '[]', '[]', '', '', '[]', 3,
        '2026-09-14T10:03:00.000Z', '2026-09-14T10:03:00.000Z');`);
}

function servers(db: DatabaseSync) {
  return db
    .prepare("SELECT * FROM projection_mcp_servers ORDER BY mcp_server_id")
    .all()
    .map((row) => ({ ...row }));
}

function expectRenamed(db: DatabaseSync, before: ReturnType<typeof servers>): void {
  const after = servers(db);
  expect(after.map(({ name: _name, ...rest }) => rest)).toEqual(before.map(({ name: _name, ...rest }) => rest));
  expect(after.slice(2).map((server) => server.name)).toEqual(["COMPUTER_USE_SAVED", "github"]);
  expect(
    after
      .slice(0, 2)
      .map((server) => server.name)
      .sort(),
  ).toEqual(["computer_use_saved_2", "computer_use_saved_3"]);
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 65 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("Computer Use server name migration", () => {
  it("moves every case of the Computer Use name to a free name and keeps the configuration", () => {
    const db = databaseAt(20);
    seedServers(db);
    const before = servers(db);
    migrateOpenBotDatabase(db);
    expectRenamed(db, before);
    expectHealthy(db);
  });

  it("rolls back the renames after a failure, then retries", () => {
    const db = databaseAt(20);
    seedServers(db);
    const before = servers(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version = 21
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 21 failed");
    expect(servers(db)).toEqual(before);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 21").all()).toEqual([]);
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expectRenamed(db, before);
    expectHealthy(db);
  });
});
