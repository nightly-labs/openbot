import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { type DynamicRecord, isDynamicRecord, isString } from "./runtime-values";

export const AGENT_MEMORY_SELECTION_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS agent_memory_selections (
    memory_id TEXT PRIMARY KEY REFERENCES projection_agent_memories(memory_id) ON DELETE CASCADE,
    inclusion TEXT NOT NULL DEFAULT 'searchable' CHECK(inclusion IN ('essential', 'searchable')),
    user_controlled INTEGER NOT NULL DEFAULT 0 CHECK(user_controlled IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory_search USING fts5(
    text, content='projection_agent_memories', content_rowid='rowid', tokenize='unicode61'
  );
  CREATE TRIGGER IF NOT EXISTS agent_memory_insert AFTER INSERT ON projection_agent_memories BEGIN
    INSERT INTO agent_memory_selections(memory_id) VALUES (new.memory_id);
    INSERT INTO agent_memory_search(rowid, text) VALUES (new.rowid, new.text);
  END;
  CREATE TRIGGER IF NOT EXISTS agent_memory_update AFTER UPDATE ON projection_agent_memories BEGIN
    INSERT INTO agent_memory_search(agent_memory_search, rowid, text) VALUES ('delete', old.rowid, old.text);
    INSERT INTO agent_memory_search(rowid, text) VALUES (new.rowid, new.text);
    UPDATE agent_memory_selections SET revision = revision + 1 WHERE memory_id = new.memory_id;
  END;
  CREATE TRIGGER IF NOT EXISTS agent_memory_delete AFTER DELETE ON projection_agent_memories BEGIN
    INSERT INTO agent_memory_search(agent_memory_search, rowid, text) VALUES ('delete', old.rowid, old.text);
  END;
`;

const AGENT_MEMORY_CONTEXT_BUDGET_BYTES = 8192;

interface SelectedMemory {
  readonly id: string;
  readonly text: string;
  readonly origin: "manual" | "automatic";
}

function essentialMemoryBytes(memories: readonly SelectedMemory[]): number {
  const block = `<agent_memories count="${memories.length}">\n${JSON.stringify(memories)}\n</agent_memories>`;
  return new TextEncoder().encode(block).byteLength;
}

function databaseRows(value: unknown): DynamicRecord[] {
  if (!Array.isArray(value)) throw new Error("Invalid SQLite result set.");
  return value.map((row, index) => {
    if (!isDynamicRecord(row)) throw new Error(`Invalid SQLite row at index ${index}.`);
    return row;
  });
}

function requiredStringColumn(row: DynamicRecord, key: string): string {
  const value = row[key];
  if (!isString(value)) throw new Error(`Invalid SQLite column ${key}.`);
  return value;
}

function initializeAgentMemorySelection(db: DatabaseSync, agentId: string): void {
  const rows = databaseRows(
    db
      .prepare(
        `SELECT m.memory_id, m.text, m.origin, s.inclusion, s.user_controlled FROM projection_agent_memories m
     LEFT JOIN agent_memory_selections s USING(memory_id) WHERE m.agent_id = ?
     ORDER BY CASE m.origin WHEN 'manual' THEN 0 ELSE 1 END, m.updated_at DESC, m.memory_id`,
      )
      .all(agentId),
  );
  const entries = rows.map((row) => {
    const origin = requiredStringColumn(row, "origin");
    if (origin !== "manual" && origin !== "automatic") throw new Error("Invalid memory origin.");
    const memory: SelectedMemory = {
      id: requiredStringColumn(row, "memory_id"),
      text: requiredStringColumn(row, "text"),
      origin,
    };
    return { memory, userControlled: row.user_controlled === 1, essential: row.inclusion === "essential" };
  });
  const selected = entries.filter((entry) => entry.userControlled && entry.essential).map((entry) => entry.memory);
  for (const { memory, userControlled } of entries) {
    if (userControlled) continue;
    const essential = essentialMemoryBytes([...selected, memory]) <= AGENT_MEMORY_CONTEXT_BUDGET_BYTES;
    if (essential) selected.push(memory);
    db.prepare(`INSERT INTO agent_memory_selections(memory_id, inclusion) VALUES (?, ?)
      ON CONFLICT(memory_id) DO UPDATE SET inclusion = excluded.inclusion, revision = revision + 1
      WHERE user_controlled = 0`).run(memory.id, essential ? "essential" : "searchable");
  }
}

function migrateAgentMemorySelection(db: DatabaseSync): void {
  db.exec(AGENT_MEMORY_SELECTION_SCHEMA_SQL);
  db.exec("INSERT INTO agent_memory_search(agent_memory_search) VALUES ('rebuild')");
  for (const row of databaseRows(db.prepare("SELECT DISTINCT agent_id FROM projection_agent_memories").all())) {
    initializeAgentMemorySelection(db, requiredStringColumn(row, "agent_id"));
  }
}

export const migration: OpenBotMigration = {
  version: 32,
  name: "agent-memory-selection",
  up: migrateAgentMemorySelection,
};
