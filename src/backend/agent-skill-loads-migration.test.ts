// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table; a failed upgrade leaves the table,
// its indexes or its marker; a newer or incomplete history is accepted; a load has no skill name, a
// too long name, or negative tokens or cost; a repeated load is counted twice. These fixtures cover each.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

// Migrations 59 and 61 run after 58 and add the empty ping and pin tables.
const SKILL_TABLES = {
  agent_usage_skill_loads: [],
  projection_messaging_pings: [],
  projection_messaging_history: [],
  projection_pinned_thread_messages: [],
};

function databaseAt(version: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  migrateUpTo(db, version);
  return db;
}

function migrateUpTo(db: DatabaseSync, version: number): void {
  db.exec(`CREATE TEMP TRIGGER stop_at_version BEFORE INSERT ON schema_migrations WHEN new.version > ${version}
    BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
  expect(() => migrateOpenBotDatabase(db)).toThrow(`migration to version ${version + 1} failed`);
  db.exec("DROP TRIGGER stop_at_version");
}

/** A memory, and from schema 45 on a named browser profile: the rows that migration 58 must keep. */
function seed(db: DatabaseSync, version: number): void {
  db.prepare(`INSERT INTO projection_agent_memories
    (memory_id, agent_id, text, normalized_text, origin, source_turn_id, created_at, updated_at, last_event_sequence)
    VALUES ('memory-1', 'chief', 'Use the client VPN 界"\\', 'use the client vpn 界"\\', 'manual', NULL,
      '2026-01-01', '2026-01-01', 2)`).run();
  if (version >= 45)
    db.prepare(`INSERT INTO browser_profiles (profile_id, name, hue, created_at, updated_at)
      VALUES (?, 'Client A 界', 215, '2026-01-02', '2026-01-02')`).run("a".repeat(32));
}

type Contents = Record<string, Record<string, SQLOutputValue>[]>;

/** Every row of every table, by table name. */
function contents(db: DatabaseSync): Contents {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
       AND name <> 'schema_migrations' AND name NOT LIKE 'agent_memory_search%' ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}"`).all()]));
}

/** The source rows, and each agent memory has no site, as migration 60 adds it. */
function withNoMemorySite(before: Contents): Contents {
  return {
    ...before,
    projection_agent_memories: (before.projection_agent_memories ?? []).map((row) => ({ ...row, site: null })),
  };
}

function skillObjects(db: DatabaseSync) {
  return db
    .prepare("SELECT type, name FROM sqlite_master WHERE name LIKE 'agent_usage_skill_loads%' ORDER BY name")
    .all();
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 62 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

interface LoadFixture {
  load_id: string;
  skill: string;
  tokens: number | null;
  estimated_cost_usd: number | null;
}

function insertLoad(db: DatabaseSync, values: Partial<LoadFixture> = {}, verb = "INSERT"): void {
  const row: LoadFixture = {
    load_id: "load-1",
    skill: "release-notes",
    tokens: 1200,
    estimated_cost_usd: 0.004,
    ...values,
  };
  db.prepare(`${verb} INTO agent_usage_skill_loads
    (agent_id, load_id, session_id, turn_id, provider, model, skill, tokens, estimated_cost_usd, occurred_at)
    VALUES ('chief', ?, 'session-1', 'turn-1', 'codex', 'gpt-5.5', ?, ?, ?, '2026-01-03T10:00:00.000Z')`).run(
    row.load_id,
    row.skill,
    row.tokens,
    row.estimated_cost_usd,
  );
}

describe("agent skill loads migration", () => {
  it.each(Array.from({ length: 50 }, (_, index) => index + 8))(
    "preserves every row from released schema %i",
    (version) => {
      const db = databaseAt(version);
      seed(db, version);
      // The earlier migrations run first; the rows after them are what v58 must keep.
      if (version < 57) migrateUpTo(db, 57);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      expect(contents(db)).toEqual({ ...withNoMemorySite(before), ...SKILL_TABLES });
      expectHealthy(db);
    },
  );

  it("rolls back the table, its indexes and the marker after a late failure, then retries", () => {
    const db = databaseAt(57);
    seed(db, 57);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=58
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 58 failed");
    expect(contents(db)).toEqual(before);
    expect(skillObjects(db)).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=58").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual({ ...withNoMemorySite(before), ...SKILL_TABLES });
    expect(skillObjects(db)).toEqual([
      { type: "table", name: "agent_usage_skill_loads" },
      { type: "index", name: "agent_usage_skill_loads_date" },
      { type: "index", name: "agent_usage_skill_loads_occurred" },
    ]);
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it creates the table", () => {
    const db = databaseAt(57);
    seed(db, 57);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(63,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=63; DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(skillObjects(db)).toEqual([]);
  });

  it("refuses a bad load, and keeps one row for a repeated load", () => {
    const db = databaseAt(57);
    seed(db, 57);
    migrateOpenBotDatabase(db);
    expect(() => insertLoad(db, { skill: "" })).toThrow("CHECK constraint failed");
    expect(() => insertLoad(db, { skill: "s".repeat(129) })).toThrow("CHECK constraint failed");
    expect(() => insertLoad(db, { tokens: -1 })).toThrow("CHECK constraint failed");
    expect(() => insertLoad(db, { estimated_cost_usd: -0.01 })).toThrow("CHECK constraint failed");
    insertLoad(db, { skill: "s".repeat(128), tokens: null, estimated_cost_usd: null });
    insertLoad(db, { load_id: "load-2" });
    insertLoad(db, { load_id: "load-2", tokens: 9 }, "INSERT OR IGNORE");
    expect(() => insertLoad(db, { load_id: "load-2" })).toThrow("UNIQUE constraint failed");
    expect(db.prepare("SELECT load_id, skill, tokens FROM agent_usage_skill_loads ORDER BY load_id").all()).toEqual([
      { load_id: "load-1", skill: "s".repeat(128), tokens: null },
      { load_id: "load-2", skill: "release-notes", tokens: 1200 },
    ]);
    expectHealthy(db);
  });
});
