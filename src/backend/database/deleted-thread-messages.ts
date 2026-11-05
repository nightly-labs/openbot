import type { DatabaseSync } from "node:sqlite";
import type { ConversationMessage } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { ORDER_KEY_COLUMNS, ORDER_KEY_DESC, ORDERED_THREAD_MESSAGES } from "./conversation-queries";
import { databaseRow, databaseRows, requiredNumberColumn, requiredStringColumn } from "./database-rows";

/**
 * The messages that a person deleted from a thread (`projection_deleted_thread_messages`).
 *
 * Pure functions over a connection that the caller holds. They open no transaction: the conversation
 * writer calls them inside its dispatch, so the delete, its event and its record commit together.
 */

/** The ids that a person deleted from one thread. */
export function deletedThreadMessageIds(db: DatabaseSync, threadId: string): Set<string> {
  const rows = databaseRows(
    db.prepare("SELECT message_id FROM projection_deleted_thread_messages WHERE thread_id = ?").all(threadId),
  );
  return new Set(rows.map((row) => requiredStringColumn(row, "message_id")));
}

/** Whether a person deleted this message from the thread. */
export function isDeletedThreadMessage(db: DatabaseSync, threadId: string, messageId: string): boolean {
  return (
    databaseRow(
      db
        .prepare("SELECT 1 AS deleted FROM projection_deleted_thread_messages WHERE thread_id = ? AND message_id = ?")
        .get(threadId, messageId),
    ) !== null
  );
}

/** The messages without the ones that a person deleted from the thread. */
export function withoutDeletedMessages<T extends Pick<ConversationMessage, "id">>(
  db: DatabaseSync,
  threadId: string,
  messages: readonly T[],
): T[] {
  if (messages.length === 0) return [];
  const deleted = deletedThreadMessageIds(db, threadId);
  return deleted.size === 0 ? [...messages] : messages.filter((message) => !deleted.has(message.id));
}

/**
 * Records the delete of one shown message. Each read cursor and read baseline on the message moves
 * to the message shown before it, so the messages after it keep their unread state. Then the thread's
 * earlier events lose the message, so a replay and the event log do not keep its text.
 * Call it before the projection row is removed: the shown order comes from that row.
 */
export function recordDeletedThreadMessage(
  db: DatabaseSync,
  threadId: string,
  messageId: string,
  deletedAt: string,
): void {
  db.prepare(
    "INSERT OR IGNORE INTO projection_deleted_thread_messages (thread_id, message_id, deleted_at) VALUES (?, ?, ?)",
  ).run(threadId, messageId, deletedAt);
  const previous = previousShownMessageId(db, threadId, messageId);
  db.prepare(
    "UPDATE projection_thread_reads SET through_message_id = ? WHERE thread_id = ? AND through_message_id = ?",
  ).run(previous, threadId, messageId);
  db.prepare(
    "UPDATE projection_thread_read_baselines SET through_message_id = ? WHERE thread_id = ? AND through_message_id = ?",
  ).run(previous, threadId, messageId);
  scrubDeletedMessageEvents(db, threadId, messageId);
}

function previousShownMessageId(db: DatabaseSync, threadId: string, messageId: string): string | null {
  const row = databaseRow(
    db
      .prepare(
        `${ORDERED_THREAD_MESSAGES}
         SELECT message_id FROM ordered
         WHERE (${ORDER_KEY_COLUMNS}) < (SELECT ${ORDER_KEY_COLUMNS} FROM ordered WHERE message_id = ?)
         ORDER BY ${ORDER_KEY_DESC} LIMIT 1`,
      )
      .get(threadId, messageId),
  );
  return row ? requiredStringColumn(row, "message_id") : null;
}

/**
 * Removes one message from the earlier events of its thread. A whole snapshot and a change list lose
 * the message. An event that carries only this message keeps its other keys, and an empty change list
 * replaces the message, so the replay still applies the active turn of the event. The detail of an
 * event and its activity row stay: they hold no message text.
 */
function scrubDeletedMessageEvents(db: DatabaseSync, threadId: string, messageId: string): void {
  const needle = JSON.stringify(messageId).slice(1, -1);
  const rows = databaseRows(
    db
      .prepare(
        `SELECT sequence, payload_json FROM orchestration_events
         WHERE aggregate_type = 'thread' AND aggregate_id = ? AND instr(payload_json, ?) > 0`,
      )
      .all(threadId, needle),
  );
  const update = db.prepare("UPDATE orchestration_events SET payload_json = ? WHERE sequence = ?");
  for (const row of rows) {
    const payload = databaseRow(JSON.parse(requiredStringColumn(row, "payload_json")));
    const scrubbed = payload ? scrubbedPayload(payload, messageId) : null;
    if (scrubbed) update.run(JSON.stringify(scrubbed), requiredNumberColumn(row, "sequence"));
  }
}

/** The payload without the message, or null when the payload does not carry it. */
function scrubbedPayload(payload: DynamicRecord, messageId: string): DynamicRecord | null {
  const isDeleted = (value: unknown) => isDynamicRecord(value) && isString(value.id) && value.id === messageId;
  const without = (messages: readonly unknown[]) => messages.filter((message) => !isDeleted(message));
  const next = { ...payload };
  let changed = false;
  const snapshot = payload.snapshot;
  if (isDynamicRecord(snapshot) && Array.isArray(snapshot.messages) && snapshot.messages.some(isDeleted)) {
    next.snapshot = { ...snapshot, messages: without(snapshot.messages) };
    changed = true;
  }
  if (Array.isArray(payload.changedMessages) && payload.changedMessages.some(isDeleted)) {
    next.changedMessages = without(payload.changedMessages);
    changed = true;
  }
  for (const key of ["appendedMessage", "streamedMessage", "importedMessage"]) {
    if (!isDeleted(payload[key])) continue;
    delete next[key];
    if (!Array.isArray(next.changedMessages)) next.changedMessages = [];
    changed = true;
  }
  return changed ? next : null;
}
