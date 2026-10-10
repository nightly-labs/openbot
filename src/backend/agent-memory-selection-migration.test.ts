// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { AGENT_MEMORY_CONTEXT_BUDGET_BYTES, essentialMemoryBytes } from "@openbot/contracts/agent-memory-context";
import { afterEach, describe, expect, it } from "vitest";
import { databaseRows, requiredStringColumn } from "./database/database-rows";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: upgrade loses text; selection exceeds budget; a partial migration survives failure;
// invalid history is accepted; selection/index outlive a deleted memory. These fixtures cover each.
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

function seedMemories(db: DatabaseSync): void {
  const insert = db.prepare(`INSERT INTO projection_agent_memories
    (memory_id,agent_id,text,normalized_text,origin,source_turn_id,created_at,updated_at,last_event_sequence)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  for (let index = 0; index < 24; index += 1) {
    const text = `${index}: ${'界"\\'.repeat(80)}`;
    insert.run(
      `memory-${String(index).padStart(2, "0")}`,
      "chief",
      text,
      text,
      index < 12 ? "manual" : "automatic",
      `turn-${index}`,
      "2026-01-01",
      `2026-09-${String(index + 1).padStart(2, "0")}`,
      index,
    );
  }
  insert.run(
    "other",
    "other-agent",
    "Only another agent knows this.",
    "Only another agent knows this.",
    "manual",
    null,
    "2026-01-01",
    "2026-01-01",
    0,
  );
}

function rows(db: DatabaseSync) {
  return db.prepare("SELECT * FROM projection_agent_memories ORDER BY memory_id").all();
}

describe("agent memory selection migration", () => {
  it.each(Array.from({ length: 24 }, (_, index) => index + 8))(
    "preserves every memory from released schema %i",
    (version) => {
      const db = databaseAt(version);
      seedMemories(db);
      const before = rows(db);
      migrateOpenBotDatabase(db);
      expect(rows(db)).toEqual(before);
      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 32 });
      const selected = databaseRows(
        db
          .prepare(`SELECT m.memory_id, m.text, m.origin FROM projection_agent_memories m
      JOIN agent_memory_selections s USING(memory_id) WHERE m.agent_id='chief' AND s.inclusion='essential'
      ORDER BY CASE m.origin WHEN 'manual' THEN 0 ELSE 1 END, m.updated_at DESC, m.memory_id`)
          .all(),
      ).map((row) => ({
        id: requiredStringColumn(row, "memory_id"),
        text: requiredStringColumn(row, "text"),
        origin: memoryOrigin(row.origin),
      }));
      expect(selected.map((memory) => memory.id)).toEqual([
        "memory-11",
        "memory-10",
        "memory-09",
        "memory-08",
        "memory-07",
        "memory-06",
        "memory-05",
        "memory-04",
        "memory-03",
        "memory-02",
        "memory-01",
        "memory-00",
        "memory-23",
      ]);
      expect(essentialMemoryBytes(selected)).toBeLessThanOrEqual(AGENT_MEMORY_CONTEXT_BUDGET_BYTES);
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM agent_memory_selections WHERE user_controlled<>0").get(),
      ).toEqual({ count: 0 });
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM agent_memory_search WHERE agent_memory_search MATCH 'knows'").get(),
      ).toEqual({ count: 1 });
      expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    },
  );

  it("rolls back schema, selection, index and marker after a late failure, then retries", () => {
    const db = databaseAt(31);
    seedMemories(db);
    const before = rows(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=32
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 32 failed");
    expect(rows(db)).toEqual(before);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'agent_memory_%'").all()).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=32").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(rows(db)).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS count FROM agent_memory_selections").get()).toEqual({ count: 25 });
    db.prepare("DELETE FROM projection_agent_memories WHERE memory_id='other'").run();
    expect(db.prepare("SELECT * FROM agent_memory_selections WHERE memory_id='other'").all()).toEqual([]);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM agent_memory_search WHERE agent_memory_search MATCH 'knows'").get(),
    ).toEqual({ count: 0 });
  });

  it("rejects newer and incomplete migration histories before modifying memory data", () => {
    const db = databaseAt(31);
    seedMemories(db);
    const before = rows(db);
    db.exec("INSERT INTO schema_migrations VALUES(33,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=33; DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(rows(db)).toEqual(before);
  });
});

function memoryOrigin(value: unknown): "manual" | "automatic" {
  if (value === "manual" || value === "automatic") return value;
  throw new Error("Invalid fixture memory origin.");
}
