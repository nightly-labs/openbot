import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { migration as compactionMigration } from "../migrations/0064-provider-history-compaction";
import { decodeThreadItem, type ThreadItem } from "../protocol";
import type { ProviderHistoryFragment } from "../provider-history";
import type { DatabaseCore } from "./database-core";
import {
  databaseRow,
  databaseRows,
  optionalNumberColumn,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "./database-rows";
import { withTransaction } from "./sqlite-transaction";

export interface ProviderHistorySessionInput {
  sessionId: string;
  threadId: string;
  provider: string;
  externalSessionId: string;
}

export interface ProviderHistoryImportState extends ProviderHistorySessionInput {
  cursor: unknown | null;
  state: "pending" | "active" | "complete" | "failed";
  createdAt: string;
  updatedAt: string;
}

export interface ProviderHistoryStageResult extends ProviderHistoryImportState {
  turnImported: boolean;
  rewroteItems: boolean;
  compactedItems: boolean;
}

export interface ProviderHistoryCompactionBatch {
  lastRowId: number | null;
  rows: number;
  bytes: number;
}

export interface ProviderHistoryStagedTurn {
  sessionId: string;
  turnId: string;
  status: string | null;
  startedAt: number | null;
  complete: boolean;
  imported: boolean;
  updatedAt: string;
}

export interface ProviderHistoryTurnCursor {
  startedAt: number | null;
  turnId: string;
}

export interface ProviderHistoryStagedTurnPage {
  turns: ProviderHistoryStagedTurn[];
  nextCursor: ProviderHistoryTurnCursor | null;
}

export interface ProviderHistoryStagedItem {
  sessionId: string;
  turnId: string;
  itemKey: string;
  itemIndex: number;
  item: ThreadItem;
  imported: boolean;
  updatedAt: string;
}

const COMPACTED_PROVIDERS_SQL = "('codex', 'claude')";
const COMPACTED_PREFIX = '"sha256:';
const compactedSql = (column: string) => `substr(${column}, 1, ${COMPACTED_PREFIX.length}) = '${COMPACTED_PREFIX}'`;
const COMPACTION_SCHEMA_VERSION = compactionMigration.version;
const COMPACTION_BATCH_ROWS = 256;
const COMPACTION_BATCH_BYTES = 4 * 1024 * 1024;

export function compactedItemJson(itemJson: string): string {
  return JSON.stringify(`sha256:${createHash("sha256").update(itemJson).digest("hex")}`);
}

function isCompactedItemJson(itemJson: string): boolean {
  return itemJson.startsWith(COMPACTED_PREFIX);
}

export interface ProviderHistoryStoreOptions {
  core: DatabaseCore;
}

export class ProviderHistoryStore {
  readonly #core: DatabaseCore;

  constructor(options: ProviderHistoryStoreOptions) {
    this.#core = options.core;
  }

  ensureImport(input: ProviderHistorySessionInput): ProviderHistoryImportState {
    const now = new Date().toISOString();
    return this.#transaction((db) => {
      db.prepare(
        `INSERT INTO provider_history_imports
           (session_id, thread_id, provider, external_session_id, cursor_json, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, 'pending', ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           thread_id = excluded.thread_id,
           provider = excluded.provider,
           external_session_id = excluded.external_session_id,
           updated_at = excluded.updated_at
         WHERE provider_history_imports.thread_id IS NOT excluded.thread_id
            OR provider_history_imports.provider IS NOT excluded.provider
            OR provider_history_imports.external_session_id IS NOT excluded.external_session_id`,
      ).run(input.sessionId, input.threadId, input.provider, input.externalSessionId, now, now);
      return this.#requireImport(db, input.sessionId);
    });
  }

  stageProviderHistoryFragment(input: {
    sessionId: string;
    fragment: ProviderHistoryFragment;
    cursor?: unknown;
  }): ProviderHistoryStageResult {
    const now = new Date().toISOString();
    return this.#transaction((db) => {
      const existing = this.#readImport(db, input.sessionId);
      if (!existing) throw new Error(`Unknown provider history session: ${input.sessionId}`);
      const existingTurn = databaseRow(
        db
          .prepare(
            `SELECT complete, imported, turn_status FROM provider_history_turns
             WHERE session_id = ? AND turn_id = ?`,
          )
          .get(input.sessionId, input.fragment.turnId),
      );
      const maxItemRow = databaseRow(
        db
          .prepare(
            `SELECT MAX(item_index) AS max_item_index FROM provider_history_staging
             WHERE session_id = ? AND turn_id = ?`,
          )
          .get(input.sessionId, input.fragment.turnId),
      );
      const maxItemIndex = maxItemRow ? optionalNumberColumn(maxItemRow, "max_item_index") : null;
      const itemOffset = input.fragment.itemOffset ?? (maxItemIndex === null ? 0 : maxItemIndex + 1);
      const turnWasImported = existingTurn !== null && requiredNumberColumn(existingTurn, "imported") === 1;
      const compactedBefore =
        existingTurn !== null && this.#hasCompactedItems(db, input.sessionId, input.fragment.turnId);
      let changed =
        !existingTurn ||
        requiredNumberColumn(existingTurn, "complete") !==
          (input.fragment.complete || requiredNumberColumn(existingTurn, "complete") === 1 ? 1 : 0) ||
        optionalStringColumn(existingTurn, "turn_status") !==
          (input.fragment.status ?? optionalStringColumn(existingTurn, "turn_status"));
      db.prepare(
        `INSERT INTO provider_history_turns
           (session_id, turn_id, turn_status, turn_started_at, complete, imported, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)
         ON CONFLICT(session_id, turn_id) DO UPDATE SET
           turn_status = COALESCE(excluded.turn_status, provider_history_turns.turn_status),
           turn_started_at = COALESCE(excluded.turn_started_at, provider_history_turns.turn_started_at),
           complete = MAX(provider_history_turns.complete, excluded.complete),
           imported = provider_history_turns.imported,
           updated_at = excluded.updated_at
         WHERE provider_history_turns.turn_status IS NOT COALESCE(excluded.turn_status, provider_history_turns.turn_status)
            OR provider_history_turns.turn_started_at
                 IS NOT COALESCE(excluded.turn_started_at, provider_history_turns.turn_started_at)
            OR provider_history_turns.complete < excluded.complete`,
      ).run(
        input.sessionId,
        input.fragment.turnId,
        input.fragment.status ?? null,
        input.fragment.startedAt ?? null,
        input.fragment.complete ? 1 : 0,
        now,
      );
      const writeItem = db.prepare(
        `INSERT INTO provider_history_staging
           (session_id, turn_id, item_key, item_index, item_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, turn_id, item_key) DO UPDATE SET
           item_index = excluded.item_index,
           imported = CASE WHEN provider_history_staging.item_json = excluded.item_json
                           THEN provider_history_staging.imported ELSE 0 END,
           item_json = excluded.item_json,
           updated_at = excluded.updated_at`,
      );
      const readItem = db.prepare(
        `SELECT item_index, item_json FROM provider_history_staging
         WHERE session_id = ? AND turn_id = ? AND item_key = ?`,
      );
      let expand = compactedBefore && (changed || !turnWasImported);
      const unchangedCompacted: Array<() => void> = [];
      for (const [itemIndex, item] of input.fragment.items.entries()) {
        const provisionalIndex = itemOffset + itemIndex;
        const provisionalKey = item.id ?? `${item.type}:${provisionalIndex}`;
        const previousRow = databaseRow(readItem.get(input.sessionId, input.fragment.turnId, provisionalKey));
        const previous = previousRow
          ? {
              itemIndex: requiredNumberColumn(previousRow, "item_index"),
              itemJson: requiredStringColumn(previousRow, "item_json"),
            }
          : null;
        const previousCompacted = previous !== null && isCompactedItemJson(previous.itemJson);
        const absoluteIndex =
          previous && item.id && input.fragment.itemOffset === undefined ? previous.itemIndex : provisionalIndex;
        const itemKey = item.id ?? `${item.type}:${absoluteIndex}`;
        const storedItem =
          previous && !previousCompacted && item.id && input.fragment.itemOffset === undefined
            ? mergeHistoryItem(previous.itemJson, item)
            : item;
        const itemJson = JSON.stringify(storedItem);
        const write = () =>
          writeItem.run(input.sessionId, input.fragment.turnId, itemKey, absoluteIndex, itemJson, now);
        const unchanged =
          previous !== null &&
          previous.itemIndex === absoluteIndex &&
          previous.itemJson === (previousCompacted ? compactedItemJson(itemJson) : itemJson);
        if (unchanged && !(previousCompacted && expand)) {
          if (previousCompacted) unchangedCompacted.push(write);
          continue;
        }
        changed = true;
        if (compactedBefore && !expand) {
          expand = true;
          for (const writeEarlier of unchangedCompacted.splice(0)) writeEarlier();
        }
        write();
      }
      if (changed) {
        db.prepare(
          "UPDATE provider_history_turns SET imported = 0, updated_at = ? WHERE session_id = ? AND turn_id = ?",
        ).run(now, input.sessionId, input.fragment.turnId);
      }
      if (changed || existing.state !== "complete" || input.cursor !== undefined) {
        db.prepare(
          `UPDATE provider_history_imports
           SET cursor_json = ?, state = ?, updated_at = ?
           WHERE session_id = ?`,
        ).run(
          input.cursor === undefined
            ? existing.cursor === null
              ? null
              : JSON.stringify(existing.cursor)
            : JSON.stringify(input.cursor),
          changed || existing.state !== "complete" ? "active" : "complete",
          now,
          input.sessionId,
        );
      }
      return {
        ...this.#requireImport(db, input.sessionId),
        turnImported: !changed && turnWasImported,
        rewroteItems: compactedBefore && expand,
        compactedItems: compactedBefore && this.#hasCompactedItems(db, input.sessionId, input.fragment.turnId),
      };
    });
  }

  markImportState(sessionId: string, state: ProviderHistoryImportState["state"], cursor?: unknown): void {
    const now = new Date().toISOString();
    this.#transaction((db) => {
      const current = this.#readImport(db, sessionId);
      if (!current) throw new Error(`Unknown provider history session: ${sessionId}`);
      db.prepare(
        `UPDATE provider_history_imports
         SET cursor_json = ?, state = ?, updated_at = ? WHERE session_id = ?`,
      ).run(
        cursor === undefined
          ? current.cursor === null
            ? null
            : JSON.stringify(current.cursor)
          : JSON.stringify(cursor),
        state,
        now,
        sessionId,
      );
    });
  }

  readImport(sessionId: string): ProviderHistoryImportState | null {
    return this.#readImport(this.#core.connection, sessionId);
  }

  readStagedTurns(sessionId: string, limit = 50): ProviderHistoryStagedTurn[] {
    return this.readStagedTurnPage(sessionId, { limit }).turns;
  }

  readStagedTurnPage(
    sessionId: string,
    input: { after?: ProviderHistoryTurnCursor; limit?: number } = {},
  ): ProviderHistoryStagedTurnPage {
    const after = input.after;
    const predicates = ["session_id = ?"];
    const parameters: Array<string | number> = [sessionId];
    if (after) {
      if (after.startedAt === null) {
        predicates.push("turn_started_at IS NULL AND turn_id < ?");
        parameters.push(after.turnId);
      } else {
        predicates.push("(turn_started_at IS NULL OR turn_started_at < ? OR (turn_started_at = ? AND turn_id < ?))");
        parameters.push(after.startedAt, after.startedAt, after.turnId);
      }
    }
    const limit = boundedLimit(input.limit ?? 50);
    const rows = databaseRows(
      this.#core.connection
        .prepare(
          `SELECT session_id, turn_id, turn_status, turn_started_at, complete, imported, updated_at
           FROM provider_history_turns
           WHERE ${predicates.join(" AND ")}
           ORDER BY CASE WHEN turn_started_at IS NULL THEN 1 ELSE 0 END,
                    turn_started_at DESC,
                    turn_id DESC
           LIMIT ?`,
        )
        .all(...parameters, limit),
    );
    const turns = rows.map((row) => ({
      sessionId: requiredStringColumn(row, "session_id"),
      turnId: requiredStringColumn(row, "turn_id"),
      status: optionalStringColumn(row, "turn_status"),
      startedAt: optionalNumberColumn(row, "turn_started_at"),
      complete: requiredNumberColumn(row, "complete") === 1,
      imported: requiredNumberColumn(row, "imported") === 1,
      updatedAt: requiredStringColumn(row, "updated_at"),
    }));
    const last = turns.at(-1);
    return {
      turns,
      nextCursor: turns.length === limit && last ? { startedAt: last.startedAt, turnId: last.turnId } : null,
    };
  }

  readStagedItems(input: {
    sessionId: string;
    turnId: string;
    afterIndex?: number;
    limit?: number;
    pendingOnly?: boolean;
  }): ProviderHistoryStagedItem[] {
    const parameters = [input.sessionId, input.turnId, input.afterIndex ?? -1, boundedLimit(input.limit ?? 50)];
    const pendingFilter = input.pendingOnly ? " AND imported = 0" : "";
    const rows = databaseRows(
      this.#core.connection
        .prepare(
          `SELECT session_id, turn_id, item_key, item_index, item_json, imported, updated_at
           FROM provider_history_staging WHERE session_id = ? AND turn_id = ? AND item_index > ?${pendingFilter}
           ORDER BY turn_id, item_index, item_key LIMIT ?`,
        )
        .all(...parameters),
    );
    return rows.map((row) => {
      const itemJson = requiredStringColumn(row, "item_json");
      if (isCompactedItemJson(itemJson)) throw new Error("A compacted provider history item has no content.");
      return {
        sessionId: requiredStringColumn(row, "session_id"),
        turnId: requiredStringColumn(row, "turn_id"),
        itemKey: requiredStringColumn(row, "item_key"),
        itemIndex: requiredNumberColumn(row, "item_index"),
        item: decodeStoredThreadItem(JSON.parse(itemJson)),
        imported: requiredNumberColumn(row, "imported") === 1,
        updatedAt: requiredStringColumn(row, "updated_at"),
      };
    });
  }

  markItemsImportedThrough(sessionId: string, turnId: string, throughItemIndex: number): void {
    if (!Number.isSafeInteger(throughItemIndex) || throughItemIndex < 0) {
      throw new Error("Invalid provider history item progress.");
    }
    this.#transaction((db) => {
      db.prepare(
        `UPDATE provider_history_staging
         SET imported = 1
         WHERE session_id = ? AND turn_id = ? AND item_index <= ?`,
      ).run(sessionId, turnId, throughItemIndex);
    });
  }

  markTurnImported(sessionId: string, turnId: string): void {
    this.#transaction((db) => {
      db.prepare(
        "UPDATE provider_history_turns SET imported = 1, updated_at = ? WHERE session_id = ? AND turn_id = ?",
      ).run(new Date().toISOString(), sessionId, turnId);
      db.prepare("UPDATE provider_history_staging SET imported = 1 WHERE session_id = ? AND turn_id = ?").run(
        sessionId,
        turnId,
      );
    });
  }

  compactImportedTurn(sessionId: string, turnId: string): void {
    this.#transaction((db) => {
      if (!hasCompactionSchema(db)) return;
      const rows = databaseRows(
        db
          .prepare(
            `SELECT s.rowid AS row_id, s.item_json FROM provider_history_staging s
             JOIN provider_history_turns t ON t.session_id = s.session_id AND t.turn_id = s.turn_id
             JOIN provider_history_imports i ON i.session_id = s.session_id
             WHERE s.session_id = ? AND s.turn_id = ? AND s.imported = 1 AND NOT ${compactedSql("s.item_json")}
               AND t.complete = 1 AND t.imported = 1 AND i.provider IN ${COMPACTED_PROVIDERS_SQL}`,
          )
          .all(sessionId, turnId),
      );
      compactRows(db, rows);
    });
  }

  compactImportedItems(afterRowId: number): ProviderHistoryCompactionBatch {
    return this.#transaction((db) => {
      if (!hasCompactionSchema(db)) return { lastRowId: null, rows: 0, bytes: 0 };
      const select = db.prepare(
        `SELECT s.rowid AS row_id, s.item_json FROM provider_history_staging s
         CROSS JOIN provider_history_turns t ON t.session_id = s.session_id AND t.turn_id = s.turn_id
         CROSS JOIN provider_history_imports i ON i.session_id = s.session_id
         WHERE s.rowid > ? AND s.imported = 1 AND NOT ${compactedSql("s.item_json")}
           AND t.complete = 1 AND t.imported = 1 AND i.provider IN ${COMPACTED_PROVIDERS_SQL}
         ORDER BY s.rowid`,
      );
      const rows: DynamicRecord[] = [];
      let lastRowId = afterRowId;
      let bytes = 0;
      for (const value of select.iterate(afterRowId)) {
        const row = databaseRow(value);
        if (!row) continue;
        rows.push(row);
        lastRowId = requiredNumberColumn(row, "row_id");
        bytes += Buffer.byteLength(requiredStringColumn(row, "item_json"));
        if (rows.length >= COMPACTION_BATCH_ROWS || bytes >= COMPACTION_BATCH_BYTES) break;
      }
      const saved = compactRows(db, rows);
      return { lastRowId: rows.length === 0 ? null : lastRowId, rows: rows.length, bytes: saved };
    });
  }

  dropCompactedItems(sessionId: string, turnId: string): void {
    this.#transaction((db) => {
      db.prepare(
        `DELETE FROM provider_history_staging WHERE session_id = ? AND turn_id = ? AND ${compactedSql("item_json")}`,
      ).run(sessionId, turnId);
    });
  }

  #hasCompactedItems(db: DatabaseSync, sessionId: string, turnId: string): boolean {
    return (
      databaseRow(
        db
          .prepare(
            `SELECT 1 AS found FROM provider_history_staging
             WHERE session_id = ? AND turn_id = ? AND ${compactedSql("item_json")} LIMIT 1`,
          )
          .get(sessionId, turnId),
      ) !== null
    );
  }

  #readImport(db: DatabaseSync, sessionId: string): ProviderHistoryImportState | null {
    const row = databaseRow(
      db
        .prepare(
          `SELECT session_id, thread_id, provider, external_session_id, cursor_json, state, created_at, updated_at
           FROM provider_history_imports WHERE session_id = ?`,
        )
        .get(sessionId),
    );
    if (!row) return null;
    const cursorJson = optionalStringColumn(row, "cursor_json");
    const state = requiredStringColumn(row, "state");
    if (state !== "pending" && state !== "active" && state !== "complete" && state !== "failed") {
      throw new Error(`Invalid provider history import state: ${state}`);
    }
    return {
      sessionId: requiredStringColumn(row, "session_id"),
      threadId: requiredStringColumn(row, "thread_id"),
      provider: requiredStringColumn(row, "provider"),
      externalSessionId: requiredStringColumn(row, "external_session_id"),
      cursor: cursorJson === null ? null : JSON.parse(cursorJson),
      state,
      createdAt: requiredStringColumn(row, "created_at"),
      updatedAt: requiredStringColumn(row, "updated_at"),
    };
  }

  #requireImport(db: DatabaseSync, sessionId: string): ProviderHistoryImportState {
    const state = this.#readImport(db, sessionId);
    if (!state) throw new Error(`Unknown provider history session: ${sessionId}`);
    return state;
  }

  #transaction<T>(operation: (db: DatabaseSync) => T): T {
    const db = this.#core.connection;
    return withTransaction(db, () => operation(db));
  }
}

function hasCompactionSchema(db: DatabaseSync): boolean {
  return (
    databaseRow(
      db.prepare("SELECT 1 AS found FROM schema_migrations WHERE version = ?").get(COMPACTION_SCHEMA_VERSION),
    ) !== null
  );
}

function compactRows(db: DatabaseSync, rows: readonly DynamicRecord[]): number {
  const select = db.prepare(
    `SELECT session_id, turn_id, item_key, item_index, imported, updated_at
     FROM provider_history_staging WHERE rowid = ?`,
  );
  const remove = db.prepare("DELETE FROM provider_history_staging WHERE rowid = ?");
  const insert = db.prepare(
    `INSERT INTO provider_history_staging
       (rowid, session_id, turn_id, item_key, item_index, item_json, imported, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let bytes = 0;
  for (const row of rows) {
    const rowId = requiredNumberColumn(row, "row_id");
    const itemJson = requiredStringColumn(row, "item_json");
    const kept = databaseRow(select.get(rowId));
    if (!kept) continue;
    remove.run(rowId);
    insert.run(
      rowId,
      requiredStringColumn(kept, "session_id"),
      requiredStringColumn(kept, "turn_id"),
      requiredStringColumn(kept, "item_key"),
      requiredNumberColumn(kept, "item_index"),
      compactedItemJson(itemJson),
      requiredNumberColumn(kept, "imported"),
      requiredStringColumn(kept, "updated_at"),
    );
    bytes += Buffer.byteLength(itemJson);
  }
  return bytes;
}

function boundedLimit(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(500, Math.floor(value)));
}

function mergeHistoryItem(previousJson: string, next: ThreadItem): ThreadItem {
  let previous: ThreadItem;
  try {
    previous = decodeStoredThreadItem(JSON.parse(previousJson));
  } catch {
    return next;
  }
  if (typeof previous.text !== "string" || typeof next.text !== "string") return { ...previous, ...next };
  const text = next.text.startsWith(previous.text)
    ? next.text
    : previous.text.startsWith(next.text) || previous.text.endsWith(next.text)
      ? previous.text
      : `${previous.text}${next.text}`;
  return { ...previous, ...next, text };
}

function decodeStoredThreadItem(value: unknown): ThreadItem {
  const decoded = decodeThreadItem(value);
  const result: ThreadItem = { type: decoded.type };
  if (isDynamicRecord(value)) {
    for (const [key, field] of Object.entries(value)) result[key] = field;
  }
  Object.assign(result, decoded);
  return result;
}
