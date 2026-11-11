import type { DatabaseSync } from "node:sqlite";
import type { ConversationMessage, MessagePinner } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import {
  databaseRow,
  databaseRows,
  decodeConversationMessageJson,
  requiredNumberColumn,
  requiredStringColumn,
} from "./database-rows";

/**
 * The messages that a person or the agent pinned in a thread (`projection_pinned_thread_messages`).
 *
 * Pure functions over a connection that the caller holds. They open no transaction: each write is
 * one statement, and the conversation writer calls the removals inside its dispatch, so the delete
 * of a message and the removal of its pin commit together.
 */

export interface PinnedThreadMessage {
  threadId: string;
  message: ConversationMessage;
  pinnedAt: string;
  pinnedBy: MessagePinner;
}

/** The pinned messages of these threads that are still shown, the newest pin first, at most `limit`. */
export function pinnedThreadMessages(
  db: DatabaseSync,
  threadIds: readonly string[],
  limit: number,
): PinnedThreadMessage[] {
  if (threadIds.length === 0) return [];
  return databaseRows(
    db
      .prepare(
        `SELECT pins.thread_id, pins.pinned_at, pins.pinned_by_kind, pins.pinned_by_id, pins.pinned_by_name,
           messages.message_json
         FROM projection_pinned_thread_messages AS pins
         JOIN projection_thread_messages AS messages
           ON messages.thread_id = pins.thread_id AND messages.message_id = pins.message_id
         WHERE pins.thread_id IN (SELECT value FROM json_each(?))
         ORDER BY pins.pinned_at DESC, pins.rowid DESC
         LIMIT ?`,
      )
      .all(JSON.stringify(threadIds), limit),
  ).map((row) => ({
    threadId: requiredStringColumn(row, "thread_id"),
    message: decodeConversationMessageJson(requiredStringColumn(row, "message_json")),
    pinnedAt: requiredStringColumn(row, "pinned_at"),
    pinnedBy: pinner(row),
  }));
}

/**
 * The number of pins of a thread that are still shown. The pin of a message that a sync or a replay
 * removed stays and shows again when the message comes back, but it does not count toward the limit.
 */
export function pinnedThreadMessageCount(db: DatabaseSync, threadId: string): number {
  const row = databaseRow(
    db
      .prepare(
        `SELECT COUNT(*) AS pins
         FROM projection_pinned_thread_messages AS pins
         JOIN projection_thread_messages AS messages
           ON messages.thread_id = pins.thread_id AND messages.message_id = pins.message_id
         WHERE pins.thread_id = ?`,
      )
      .get(threadId),
  );
  return row ? requiredNumberColumn(row, "pins") : 0;
}

/** Who pinned this message of the thread, or null when it is not pinned. */
export function threadMessagePinner(db: DatabaseSync, threadId: string, messageId: string): MessagePinner | null {
  const row = databaseRow(
    db
      .prepare(
        `SELECT pinned_by_kind, pinned_by_id, pinned_by_name FROM projection_pinned_thread_messages
         WHERE thread_id = ? AND message_id = ?`,
      )
      .get(threadId, messageId),
  );
  return row ? pinner(row) : null;
}

/** Pins a message. A second pin of the same message keeps the first time and the first pinner. */
export function pinThreadMessage(
  db: DatabaseSync,
  threadId: string,
  messageId: string,
  pinnedAt: string,
  pinnedBy: MessagePinner,
): void {
  const [id, name] =
    pinnedBy.kind === "agent" ? [pinnedBy.agentId, null] : [pinnedBy.sender?.id ?? null, pinnedBy.sender?.name ?? null];
  db.prepare(
    `INSERT OR IGNORE INTO projection_pinned_thread_messages
       (thread_id, message_id, pinned_at, pinned_by_kind, pinned_by_id, pinned_by_name)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(threadId, messageId, pinnedAt, pinnedBy.kind, id, name);
}

/**
 * The newest shown messages of a thread whose text contains `quote`, at most `limit`, the newest
 * first. SQLite folds only ASCII letters for the case, so a quote in another script must match exactly.
 */
export function threadMessagesContaining(
  db: DatabaseSync,
  threadId: string,
  quote: string,
  limit: number,
): ConversationMessage[] {
  return databaseRows(
    db
      .prepare(
        `SELECT message_json FROM projection_thread_messages
         WHERE thread_id = ? AND instr(lower(json_extract(message_json, '$.text')), lower(?)) > 0
         ORDER BY ordinal DESC LIMIT ?`,
      )
      .all(threadId, quote, limit),
  ).map((row) => decodeConversationMessageJson(requiredStringColumn(row, "message_json")));
}

/** Removes the pin of a message. Also the delete of a shown message calls it. */
export function unpinThreadMessage(db: DatabaseSync, threadId: string, messageId: string): void {
  db.prepare("DELETE FROM projection_pinned_thread_messages WHERE thread_id = ? AND message_id = ?").run(
    threadId,
    messageId,
  );
}

/** Removes every pin of a thread, for "Delete history". */
export function unpinThreadHistory(db: DatabaseSync, threadId: string): void {
  db.prepare("DELETE FROM projection_pinned_thread_messages WHERE thread_id = ?").run(threadId);
}

function pinner(row: DynamicRecord): MessagePinner {
  const id = typeof row.pinned_by_id === "string" ? row.pinned_by_id : null;
  if (requiredStringColumn(row, "pinned_by_kind") === "agent" && id) return { kind: "agent", agentId: id };
  const name = typeof row.pinned_by_name === "string" ? row.pinned_by_name : null;
  return { kind: "person", sender: id && name !== null ? { id, name } : null };
}
