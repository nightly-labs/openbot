import type { DatabaseSync } from "node:sqlite";
import { databaseRow, databaseRows, requiredNumberColumn, requiredStringColumn } from "./database-rows";

/**
 * Read-only queries for the Storage surfaces. `DatabaseSync` runs on the main thread, so every read
 * here is either one short aggregate per thread or one keyset page: the caller yields between calls
 * and the window keeps drawing while a large database is measured.
 */

export interface StorageThread {
  threadId: string;
  agentId: string;
  title: string;
}

export interface StorageThreadSize {
  messageCount: number;
  /** UTF-8 bytes of the stored message JSON. */
  bytes: number;
}

/** Where a chat shows one attachment. One file can show in several chats. */
export interface StoragePlacement {
  attachmentId: string;
  threadId: string;
  messageId: string;
  createdAt: string;
}

export const STORAGE_PLACEMENT_PAGE = 500;

/** Agent chats only. A channel context thread is internal: the user never sees it as a chat. */
export function storageThreads(db: DatabaseSync, agentId?: string): StorageThread[] {
  const agentFilter = agentId === undefined ? "" : "AND agent_id = ?";
  const statement = db.prepare(
    `SELECT thread_id, agent_id, title FROM projection_threads
     WHERE thread_id NOT IN (SELECT thread_id FROM projection_channel_contexts) ${agentFilter}
     ORDER BY thread_id`,
  );
  return databaseRows(agentId === undefined ? statement.all() : statement.all(agentId)).map((row) => ({
    threadId: requiredStringColumn(row, "thread_id"),
    agentId: requiredStringColumn(row, "agent_id"),
    title: requiredStringColumn(row, "title"),
  }));
}

/** One thread at a time, on the primary key prefix, so the caller can yield between threads. */
export function storageThreadSize(db: DatabaseSync, threadId: string): StorageThreadSize {
  const row = databaseRow(
    db
      .prepare(
        `SELECT COUNT(*) AS message_count, COALESCE(SUM(length(CAST(message_json AS BLOB))), 0) AS bytes
         FROM projection_thread_messages WHERE thread_id = ?`,
      )
      .get(threadId),
  );
  if (!row) return { messageCount: 0, bytes: 0 };
  return { messageCount: requiredNumberColumn(row, "message_count"), bytes: requiredNumberColumn(row, "bytes") };
}

/**
 * One keyset page of chat-message attachments, after `afterId`. The row id is
 * `${threadId}:${messageId}:${attachmentId}` and the owner is `${threadId}:${messageId}`, so the
 * attachment id is what follows the owner. A row that does not have that shape is skipped.
 */
export function storagePlacementPage(
  db: DatabaseSync,
  afterId: string,
  limit = STORAGE_PLACEMENT_PAGE,
): { placements: StoragePlacement[]; nextId: string | null } {
  const rows = databaseRows(
    db
      .prepare(
        `SELECT attachment_id, owner_id, created_at FROM projection_attachments
         WHERE owner_kind = 'thread-message' AND attachment_id > ?
         ORDER BY attachment_id LIMIT ?`,
      )
      .all(afterId, limit),
  );
  const placements: StoragePlacement[] = [];
  for (const row of rows) {
    const rowId = requiredStringColumn(row, "attachment_id");
    const ownerId = requiredStringColumn(row, "owner_id");
    const separator = ownerId.indexOf(":");
    if (separator <= 0 || !rowId.startsWith(`${ownerId}:`)) continue;
    const attachmentId = rowId.slice(ownerId.length + 1);
    const messageId = ownerId.slice(separator + 1);
    if (!attachmentId || !messageId) continue;
    placements.push({
      attachmentId,
      threadId: ownerId.slice(0, separator),
      messageId,
      createdAt: requiredStringColumn(row, "created_at"),
    });
  }
  const last = rows.at(-1);
  return { placements, nextId: rows.length < limit || !last ? null : requiredStringColumn(last, "attachment_id") };
}
