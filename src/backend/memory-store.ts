import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { type AgentMemoryOrigin, MEMORY_SITE_MAX_LENGTH, type MemoryEntry } from "@openbot/contracts/ipc";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { databaseRow, databaseRows, requiredStringColumn } from "./database/database-rows";
import type { OpenBotDatabase } from "./openbot-database";

/**
 * One owner column and one table name are the whole difference between an agent's memories, a
 * channel's and a messaging connection's, so the SQL below is written once. Nothing here knows what
 * an owner is: the subclasses in `agent-memory-store.ts`, `channel-memory-store.ts` and
 * `messaging/messaging-memory-store.ts` name it and re-attach the owner id to every row they return.
 *
 * The aggregate type is deliberately per-owner. `database/agent-roster.ts` purges the events of a
 * deleted agent by `aggregate_type`, and a channel must not be swept up by that query.
 */
export interface MemoryTables {
  table: string;
  ownerColumn: "agent_id" | "channel_id" | "connection_id";
  /** The owner's key in event payloads. */
  ownerKey: "agentId" | "channelId" | "connectionId";
  aggregateType: "agent-memory" | "channel-memory" | "messaging-memory";
  /** Read at each save, because the agent cap is an app setting the user can change. */
  limit: () => number;
  limitMessage: (limit: number) => string;
  /** The table has the `site` column of migration 60. Only agent memories have it. */
  siteColumn?: boolean;
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
  /** A normalized site. Absent, an update keeps the site that the memory has. */
  site?: string;
}

export interface SaveMemoryInput {
  memoryId?: string | undefined;
  text: string;
  origin: AgentMemoryOrigin;
  sourceTurnId: string | null;
  commandId?: string | undefined;
  uncapped?: boolean;
  /** A normalized site, or null for none. Absent, an update keeps the site that the memory has. */
  site?: string | null | undefined;
}

export class MemoryStore {
  readonly #columns: string;

  constructor(
    readonly database: OpenBotDatabase,
    protected readonly tables: MemoryTables,
  ) {
    this.#columns = `memory_id, text, origin, source_turn_id, created_at, updated_at${tables.siteColumn ? ", site" : ""}`;
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

  count(ownerId: string): number {
    const row = databaseRow(
      this.database.connection
        .prepare(`SELECT COUNT(*) AS count FROM ${this.tables.table} WHERE ${this.tables.ownerColumn} = ?`)
        .get(ownerId),
    );
    return Number(row?.count ?? 0);
  }

  limit(): number {
    return this.tables.limit();
  }

  createManual(ownerId: string, text: string): MemoryEntry {
    return this.save(ownerId, { text, origin: "manual", sourceTurnId: null });
  }

  /**
   * Copies every memory, even past the cap: the user can lower the cap below what the source holds,
   * and a copy that stops partway would lose memories.
   */
  duplicate(sourceOwnerId: string, targetOwnerId: string): MemoryEntry[] {
    return this.list(sourceOwnerId).map((memory) =>
      this.save(targetOwnerId, {
        text: memory.text,
        origin: memory.origin,
        sourceTurnId: null,
        uncapped: true,
        site: memory.site ?? null,
      }),
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
      ...(input.memoryId === undefined ? {} : { memoryId: input.memoryId }),
      text: input.text,
      origin: "automatic",
      sourceTurnId: input.sourceTurnId,
      ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
      ...(input.site === undefined ? {} : { site: input.site }),
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
          payload: { [this.tables.ownerKey]: ownerId, memoryId },
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
    const { aggregateType, table, ownerColumn, ownerKey } = this.tables;
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
  protected save(ownerId: string, input: SaveMemoryInput): MemoryEntry {
    const text = validateMemoryText(input.text);
    const normalizedText = normalizeMemoryText(text);
    const duplicate = this.#findByNormalizedText(ownerId, normalizedText);
    if (duplicate && duplicate.id !== input.memoryId) {
      if (input.memoryId) this.delete(ownerId, input.memoryId);
      // The folded memory takes a new site, and keeps its own origin and source turn.
      if (this.tables.siteColumn && input.site !== undefined && (input.site ?? undefined) !== duplicate.site)
        return this.save(ownerId, {
          memoryId: duplicate.id,
          text: duplicate.text,
          origin: duplicate.origin,
          sourceTurnId: duplicate.sourceTurnId,
          site: input.site,
        });
      return duplicate;
    }

    const previous = input.memoryId ? this.get(ownerId, input.memoryId) : null;
    if (input.memoryId && !previous) throw new Error(sourceText("error.backend.memoryGone"));
    if (!previous && !input.uncapped) {
      const limit = this.tables.limit();
      if (this.count(ownerId) >= limit) throw new Error(this.tables.limitMessage(limit));
    }

    const now = new Date().toISOString();
    const updatedAt =
      previous && now <= previous.updatedAt ? new Date(Date.parse(previous.updatedAt) + 1).toISOString() : now;
    const site = this.tables.siteColumn ? (input.site === undefined ? previous?.site : input.site) : undefined;
    const memory: MemoryEntry = {
      id: previous?.id ?? randomUUID(),
      text,
      origin: input.origin,
      sourceTurnId: input.sourceTurnId,
      createdAt: previous?.createdAt ?? now,
      updatedAt,
      ...(site ? { site } : {}),
    };
    const { aggregateType, table, ownerColumn, siteColumn } = this.tables;
    const eventType = `${aggregateType}.${previous ? "updated" : "created"}`;
    this.database.dispatch(
      input.commandId ?? `${aggregateType}:${eventType}:${randomUUID()}`,
      [
        {
          aggregateType,
          aggregateId: memory.id,
          eventType,
          payload: { memory: { ...memory, [this.tables.ownerKey]: ownerId } },
        },
      ],
      (db, sequences) => {
        db.prepare(
          `INSERT INTO ${table} (
             memory_id, ${ownerColumn}, text, normalized_text, origin, source_turn_id,
             created_at, updated_at, last_event_sequence${siteColumn ? ", site" : ""}
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?${siteColumn ? ", ?" : ""})
           ON CONFLICT(memory_id) DO UPDATE SET
             text = excluded.text,
             normalized_text = excluded.normalized_text,
             origin = excluded.origin,
             source_turn_id = excluded.source_turn_id,
             updated_at = excluded.updated_at,
             last_event_sequence = excluded.last_event_sequence${siteColumn ? ", site = excluded.site" : ""}`,
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
          ...(siteColumn ? [memory.site ?? null] : []),
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
  if (!text) throw new Error(sourceText("error.backend.memoryTextRequired"));
  if (text.length > INPUT_LIMITS.agentMemoryText) throw new Error(sourceText("error.backend.memoryTextTooLong"));
  return text;
}

/**
 * The site of a memory from a host name or a URL: the lowercase host without "www.". Null when the
 * value has no host that a browser can open, such as a file path or an empty string.
 */
export function normalizeMemorySite(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return null;
  }
  const site = host
    .toLowerCase()
    .replace(/\.$/u, "")
    .replace(/^www\./u, "");
  return site && site.length <= MEMORY_SITE_MAX_LENGTH ? site : null;
}

/** The sites whose memories apply to a page host: the host and each parent domain with two or more labels. */
export function memorySitesForHost(hostname: string): string[] {
  const site = normalizeMemorySite(hostname);
  if (!site) return [];
  const labels = site.split(".");
  if (labels.length < 2 || /^[\d.]+$/u.test(site) || site.includes(":")) return [site];
  return labels.slice(0, -1).map((_, index) => labels.slice(index).join("."));
}

/** Two memories with the same normalized text are one memory: `save` folds the second into the first. */
export function normalizeMemoryText(value: string): string {
  return value;
}

function memoryFromRow(row: DynamicRecord): MemoryEntry {
  const origin = requiredStringColumn(row, "origin");
  if (origin !== "automatic" && origin !== "manual") throw new Error("Invalid memory origin.");
  const sourceTurnId = row.source_turn_id;
  if (sourceTurnId !== null && !isString(sourceTurnId)) throw new Error("Invalid memory source turn.");
  const site = row.site;
  if (site !== undefined && site !== null && !isString(site)) throw new Error("Invalid memory site.");
  return {
    id: requiredStringColumn(row, "memory_id"),
    text: requiredStringColumn(row, "text"),
    origin,
    sourceTurnId,
    createdAt: requiredStringColumn(row, "created_at"),
    updatedAt: requiredStringColumn(row, "updated_at"),
    ...(site ? { site } : {}),
  };
}
