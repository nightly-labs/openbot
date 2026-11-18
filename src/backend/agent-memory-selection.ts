import type { DatabaseSync } from "node:sqlite";
import { AGENT_MEMORY_CONTEXT_BUDGET_BYTES, essentialMemoryBytes } from "@openbot/contracts/agent-memory-context";
import type { MemoryEntry } from "@openbot/contracts/ipc";
import { databaseRows, requiredStringColumn } from "./database/database-rows";

/**
 * Selects the essential memories of one agent for text-only imports. Call within the caller's transaction.
 * Migration 32 has its own frozen copy (`migrations/0032-agent-memory-selection.ts`).
 */
export function initializeAgentMemorySelection(db: DatabaseSync, agentId: string): void {
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
    const memory: Pick<MemoryEntry, "id" | "text" | "origin"> = {
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
