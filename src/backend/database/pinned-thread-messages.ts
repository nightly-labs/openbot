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

export interface PinnedThreadMessage {
  threadId: string;
  message: ConversationMessage;
  pinnedAt: string;
  pinnedBy: MessagePinner;
}

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

export function unpinThreadMessage(db: DatabaseSync, threadId: string, messageId: string): void {
  db.prepare("DELETE FROM projection_pinned_thread_messages WHERE thread_id = ? AND message_id = ?").run(
    threadId,
    messageId,
  );
}

export function unpinThreadHistory(db: DatabaseSync, threadId: string): void {
  db.prepare("DELETE FROM projection_pinned_thread_messages WHERE thread_id = ?").run(threadId);
}

function pinner(row: DynamicRecord): MessagePinner {
  const id = typeof row.pinned_by_id === "string" ? row.pinned_by_id : null;
  if (requiredStringColumn(row, "pinned_by_kind") === "agent" && id) return { kind: "agent", agentId: id };
  const name = typeof row.pinned_by_name === "string" ? row.pinned_by_name : null;
  return { kind: "person", sender: id && name !== null ? { id, name } : null };
}
