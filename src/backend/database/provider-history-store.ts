import type { DatabaseSync } from "node:sqlite";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
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

export interface ProviderHistoryStagedTurn {
  sessionId: string;
  turnId: string;
  status: string | null;
  startedAt: number | null;
  complete: boolean;
  imported: boolean;
  updatedAt: string;
}

/** Keyset cursor for the newest-first staged-turn order. */
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

export interface ProviderHistoryStoreOptions {
  core: DatabaseCore;
}

/**
 * Durable provider history import state.
 *
 * A provider page is written as item rows and a cursor update in one transaction. The staging
 * rows are additive: a partial page never replaces or deletes an older conversation row. The
 * class owns only provider replay state and never imports the OpenBot facade.
 */
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
           updated_at = excluded.updated_at`,
      ).run(input.sessionId, input.threadId, input.provider, input.externalSessionId, now, now);
      return this.#requireImport(db, input.sessionId);
    });
  }

  /**
   * Stages one provider fragment and advances the import cursor atomically.
   *
   * `cursor` is opaque to this layer. The adapter owns its meaning and passes it back on the next
   * request. Items are keyed by their provider id where available, with a stable index fallback for
   * providers that omit item ids. A changed item clears its imported marker so it can be replayed.
   */
  stageProviderHistoryFragment(input: {
    sessionId: string;
    fragment: ProviderHistoryFragment;
    cursor?: unknown;
  }): ProviderHistoryImportState {
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
           updated_at = excluded.updated_at`,
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
        const absoluteIndex =
          previous && item.id && input.fragment.itemOffset === undefined ? previous.itemIndex : provisionalIndex;
        const itemKey = item.id ?? `${item.type}:${absoluteIndex}`;
        const storedItem =
          previous && item.id && input.fragment.itemOffset === undefined
            ? mergeHistoryItem(previous.itemJson, item)
            : item;
        const itemJson = JSON.stringify(storedItem);
        if (!previous || previous.itemIndex !== absoluteIndex || previous.itemJson !== itemJson) changed = true;
        writeItem.run(input.sessionId, input.fragment.turnId, itemKey, absoluteIndex, itemJson, now);
      }
      if (changed) {
        db.prepare(
          "UPDATE provider_history_turns SET imported = 0, updated_at = ? WHERE session_id = ? AND turn_id = ?",
        ).run(now, input.sessionId, input.fragment.turnId);
      }
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
      return this.#requireImport(db, input.sessionId);
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

  /** Reads a bounded newest-first page without retaining the session's full turn list. */
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
    return rows.map((row) => ({
      sessionId: requiredStringColumn(row, "session_id"),
      turnId: requiredStringColumn(row, "turn_id"),
      itemKey: requiredStringColumn(row, "item_key"),
      itemIndex: requiredNumberColumn(row, "item_index"),
      item: decodeStoredThreadItem(JSON.parse(requiredStringColumn(row, "item_json"))),
      imported: requiredNumberColumn(row, "imported") === 1,
      updatedAt: requiredStringColumn(row, "updated_at"),
    }));
  }

  /** Marks only the staged rows covered by one normalized page. */
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
    const ownsTransaction = !db.isTransaction;
    if (ownsTransaction) db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation(db);
      if (ownsTransaction) db.exec("COMMIT");
      return result;
    } catch (error) {
      if (ownsTransaction && db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }
}

function boundedLimit(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(500, Math.floor(value)));
}

/** ACP sends text deltas with one item id; combine them while keeping retries idempotent. */
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

/** Keep provider-specific item fields (for example image metadata) after boundary validation. */
function decodeStoredThreadItem(value: unknown): ThreadItem {
  const decoded = decodeThreadItem(value);
  const result: ThreadItem = { type: decoded.type };
  if (isDynamicRecord(value)) {
    for (const [key, field] of Object.entries(value)) result[key] = field;
  }
  Object.assign(result, decoded);
  return result;
}
