import type { DatabaseSync } from "node:sqlite";
import { databaseRow, databaseRows, requiredNumberColumn, requiredStringColumn } from "./database-rows";

export interface StorageThread {
  threadId: string;
  agentId: string;
  title: string;
}

export interface StorageThreadSize {
  messageCount: number;
  bytes: number;
}

export interface StoragePlacement {
  attachmentId: string;
  threadId: string;
  messageId: string;
  createdAt: string;
}

const STORAGE_PLACEMENT_PAGE = 500;

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
