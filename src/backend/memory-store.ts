import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentMemoryOrigin, MemoryEntry } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { OpenBotDatabase } from "./openbot-database";

/**
 * One owner column and one table name are the whole difference between an agent's memories and a
 * channel's, so the SQL below is written once. Nothing here knows what an owner is: the subclasses
 * in `agent-memory-store.ts` and `channel-memory-store.ts` name it and re-attach the owner id to
 * every row they return.
 *
 * The aggregate type is deliberately per-owner. `database/agent-roster.ts` purges the events of a
 * deleted agent by `aggregate_type`, and a channel must not be swept up by that query.
 */
export interface MemoryTables {
  table: string;
  ownerColumn: "agent_id" | "channel_id";
  aggregateType: "agent-memory" | "channel-memory";
  limit: number;
  limitMessage: string;
}

export interface SaveAutomaticMemory {
  memoryId?: string;
  text: string;
  sourceTurnId: string;
  expectedUpdatedAt?: string | null;
  /**
   * A deterministic command id makes the write exactly-once. A channel tool passes the id of its
   * own call, so a retried call reads the receipt instead of saving again. An agent turn stages its
   * memories and commits once, so it has nothing to replay and leaves this unset.
   */
  commandId?: string;
}

export class MemoryStore {
  readonly #columns: string;

  constructor(
    readonly database: OpenBotDatabase,
    protected readonly tables: MemoryTables,
  ) {
    this.#columns = `memory_id, text, origin, source_turn_id, created_at, updated_at`;
  }

  list(ownerId: string): MemoryEntry[] {
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT ${this.#columns}
           FROM ${this.tables.table}
           WHERE ${this.tables.ownerColumn} = ?
           ORDER BY updated_at DESC, memory_id`,
        )
        .all(ownerId),
    ).map(memoryFromRow);
  }

  get(ownerId: string, memoryId: string): MemoryEntry | null {
    const row = databaseRow(
      this.database.connection
        .prepare(
          `SELECT ${this.#columns}
           FROM ${this.tables.table}
           WHERE ${this.tables.ownerColumn} = ? AND memory_id = ?`,
        )
        .get(ownerId, memoryId),
    );
    return row ? memoryFromRow(row) : null;
  }

  createManual(ownerId: string, text: string): MemoryEntry {
    return this.save(ownerId, { text, origin: "manual", sourceTurnId: null });
  }

  duplicate(sourceOwnerId: string, targetOwnerId: string): MemoryEntry[] {
    return this.list(sourceOwnerId).map((memory) =>
      this.save(targetOwnerId, { text: memory.text, origin: memory.origin, sourceTurnId: null }),
    );
  }

  updateManual(ownerId: string, memoryId: string, text: string): MemoryEntry {
    return this.save(ownerId, { memoryId, text, origin: "manual", sourceTurnId: null });
  }

  /**
   * `expectedUpdatedAt` is the concurrency check: a memory edited meanwhile is left alone.
   *
   * Protected, not public, so each subclass can keep the public `saveAutomatic` its own callers
   * already use - the agent one takes `agentId` inside its input object.
   */
  protected saveAutomaticEntry(ownerId: string, input: SaveAutomaticMemory): MemoryEntry | null {
    if (input.memoryId && input.expectedUpdatedAt !== undefined) {
      const current = this.get(ownerId, input.memoryId);
      if (!current || current.updatedAt !== input.expectedUpdatedAt) return null;
    }
    return this.save(ownerId, {
      memoryId: input.memoryId,
      text: input.text,
      origin: "automatic",
      sourceTurnId: input.sourceTurnId,
      commandId: input.commandId,
    });
  }

  delete(ownerId: string, memoryId: string, expectedUpdatedAt?: string | null): boolean {
    const current = this.get(ownerId, memoryId);
    if (!current) return false;
    if (expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) return false;
    const { aggregateType, table, ownerColumn } = this.tables;
    this.database.dispatch(
      `${aggregateType}:delete:${randomUUID()}`,
      [
        {
          aggregateType,
          aggregateId: memoryId,
          eventType: `${aggregateType}.deleted`,
          payload: { [ownerColumn === "agent_id" ? "agentId" : "channelId"]: ownerId, memoryId },
        },
      ],
      (db, sequences) => {
        forgetEventsBefore(db, aggregateType, memoryId, sequences[0] ?? 0);
        db.prepare(`DELETE FROM ${table} WHERE ${ownerColumn} = ? AND memory_id = ?`).run(ownerId, memoryId);
        return true;
      },
    );
    return true;
  }

  clear(ownerId: string): number {
    const memories = this.list(ownerId);
    if (memories.length === 0) return 0;
    const { aggregateType, table, ownerColumn } = this.tables;
    const ownerKey = ownerColumn === "agent_id" ? "agentId" : "channelId";
    return this.database.dispatch(
      `${aggregateType}:clear:${randomUUID()}`,
      memories.map((memory) => ({
        aggregateType,
        aggregateId: memory.id,
        eventType: `${aggregateType}.deleted`,
        payload: { [ownerKey]: ownerId, memoryId: memory.id },
      })),
      (db, sequences) => {
        for (const [index, memory] of memories.entries())
          forgetEventsBefore(db, aggregateType, memory.id, sequences[index] ?? 0);
        db.prepare(`DELETE FROM ${table} WHERE ${ownerColumn} = ?`).run(ownerId);
        return memories.length;
      },
    );
  }

  /**
   * Validate, fold a duplicate, cap the owner, then keep `updatedAt` strictly increasing so the
   * `ORDER BY updated_at DESC` above is stable when two saves land in the same millisecond.
   */
  protected save(
    ownerId: string,
    input: {
      memoryId?: string;
      text: string;
      origin: AgentMemoryOrigin;
      sourceTurnId: string | null;
      commandId?: string;
    },
  ): MemoryEntry {
    const text = validateMemoryText(input.text);
    const normalizedText = normalizeMemoryText(text);
    const duplicate = this.#findByNormalizedText(ownerId, normalizedText);
    if (duplicate && duplicate.id !== input.memoryId) {
      if (input.memoryId) this.delete(ownerId, input.memoryId);
      return duplicate;
    }

    const previous = input.memoryId ? this.get(ownerId, input.memoryId) : null;
    if (input.memoryId && !previous) throw new Error("This memory no longer exists.");
    if (!previous && this.list(ownerId).length >= this.tables.limit) throw new Error(this.tables.limitMessage);

    const now = new Date().toISOString();
    const updatedAt =
      previous && now <= previous.updatedAt ? new Date(Date.parse(previous.updatedAt) + 1).toISOString() : now;
    const memory: MemoryEntry = {
      id: previous?.id ?? randomUUID(),
      text,
      origin: input.origin,
      sourceTurnId: input.sourceTurnId,
      createdAt: previous?.createdAt ?? now,
      updatedAt,
    };
    const { aggregateType, table, ownerColumn } = this.tables;
    const eventType = `${aggregateType}.${previous ? "updated" : "created"}`;
    this.database.dispatch(
      input.commandId ?? `${aggregateType}:${eventType}:${randomUUID()}`,
      [
        {
          aggregateType,
          aggregateId: memory.id,
          eventType,
          payload: { memory: { ...memory, [ownerColumn === "agent_id" ? "agentId" : "channelId"]: ownerId } },
        },
      ],
      (db, sequences) => {
        db.prepare(
          `INSERT INTO ${table} (
             memory_id, ${ownerColumn}, text, normalized_text, origin, source_turn_id,
             created_at, updated_at, last_event_sequence
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(memory_id) DO UPDATE SET
             text = excluded.text,
             normalized_text = excluded.normalized_text,
             origin = excluded.origin,
             source_turn_id = excluded.source_turn_id,
             updated_at = excluded.updated_at,
             last_event_sequence = excluded.last_event_sequence`,
        ).run(
          memory.id,
          ownerId,
          memory.text,
          normalizedText,
          memory.origin,
          memory.sourceTurnId,
          memory.createdAt,
          memory.updatedAt,
          sequences[0] ?? 0,
        );
        return memory;
      },
    );
    return memory;
  }

  #findByNormalizedText(ownerId: string, normalizedText: string): MemoryEntry | null {
    const row = databaseRow(
      this.database.connection
        .prepare(
          `SELECT ${this.#columns}
           FROM ${this.tables.table}
           WHERE ${this.tables.ownerColumn} = ? AND normalized_text = ?`,
        )
        .get(ownerId, normalizedText),
    );
    return row ? memoryFromRow(row) : null;
  }
}

/**
 * A hard delete also erases the memory's own history. Memory text is what the user asked to be
 * forgotten, so leaving it in `orchestration_events` would keep it readable after a clear.
 */
function forgetEventsBefore(db: DatabaseSync, aggregateType: string, memoryId: string, deletionSequence: number): void {
  db.prepare(
    `DELETE FROM orchestration_command_receipts WHERE command_id IN (
       SELECT DISTINCT command_id
       FROM orchestration_events
       WHERE aggregate_type = ? AND aggregate_id = ? AND sequence < ?
     )`,
  ).run(aggregateType, memoryId, deletionSequence);
  db.prepare(
    `DELETE FROM orchestration_events
     WHERE aggregate_type = ? AND aggregate_id = ? AND sequence < ?`,
  ).run(aggregateType, memoryId, deletionSequence);
}

function validateMemoryText(value: string): string {
  const text = value.trim();
  if (!text) throw new Error("Memory text is required.");
  if (text.length > INPUT_LIMITS.agentMemoryText) throw new Error("Memory text is too long.");
  return text;
}

function normalizeMemoryText(value: string): string {
  return value;
}

function databaseRow(value: unknown): DynamicRecord | null {
  return isDynamicRecord(value) ? value : null;
}

function databaseRows(value: unknown): DynamicRecord[] {
  if (!Array.isArray(value)) throw new Error("Invalid memory query result.");
  return value.map((row) => {
    const record = databaseRow(row);
    if (!record) throw new Error("Invalid memory query row.");
    return record;
  });
}

function requiredStringColumn(row: DynamicRecord, key: string): string {
  const value = row[key];
  if (!isString(value)) throw new Error(`Invalid memory column ${key}.`);
  return value;
}

function memoryFromRow(row: DynamicRecord): MemoryEntry {
  const origin = requiredStringColumn(row, "origin");
  if (origin !== "automatic" && origin !== "manual") throw new Error("Invalid memory origin.");
  const sourceTurnId = row.source_turn_id;
  if (sourceTurnId !== null && !isString(sourceTurnId)) throw new Error("Invalid memory source turn.");
  return {
    id: requiredStringColumn(row, "memory_id"),
    text: requiredStringColumn(row, "text"),
    origin,
    sourceTurnId,
    createdAt: requiredStringColumn(row, "created_at"),
    updatedAt: requiredStringColumn(row, "updated_at"),
  };
}
