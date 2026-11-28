import type { DatabaseSync } from "node:sqlite";
import type { ConversationMessage } from "@openbot/contracts/ipc";
import { databaseRow, databaseRows, optionalStringColumn, requiredStringColumn } from "./database-rows";
import { cachedStatement } from "./statement-cache";

export function keepNewMessagesLast(
  db: DatabaseSync,
  threadId: string,
  messages: readonly ConversationMessage[],
  now = Date.now(),
): void {
  if (messages.length === 0) return;
  const hostTime = new Date(now).toISOString();
  const newestSaved = newestSavedTime(db, threadId);
  if (newestSaved === null || newestSaved <= hostTime) return;
  let latest = Date.parse(newestSaved);
  if (!Number.isFinite(latest)) return;
  const futureTimes = savedFutureTimes(db, threadId, hostTime);
  const newestPast = newestSavedTimeUntil(db, threadId, hostTime);
  for (const message of messages) {
    const shownAt = Date.parse(message.createdAt);
    if (message.createdAt > newestSaved && Number.isFinite(shownAt)) latest = Math.max(latest, shownAt);
  }
  for (const message of messages) {
    const savedFuture = futureTimes.get(message.id);
    if (savedFuture !== undefined) {
      if (message.createdAt < savedFuture) message.createdAt = savedFuture;
      continue;
    }
    if (message.createdAt >= newestSaved || (newestPast !== null && message.createdAt <= newestPast)) continue;
    latest += 1;
    message.createdAt = new Date(latest).toISOString();
  }
}

function newestSavedTime(db: DatabaseSync, threadId: string): string | null {
  const row = databaseRow(
    cachedStatement(db, "SELECT MAX(created_at) AS time FROM projection_thread_messages WHERE thread_id = ?").get(
      threadId,
    ),
  );
  return row ? optionalStringColumn(row, "time") : null;
}

function newestSavedTimeUntil(db: DatabaseSync, threadId: string, hostTime: string): string | null {
  const row = databaseRow(
    cachedStatement(
      db,
      "SELECT MAX(created_at) AS time FROM projection_thread_messages WHERE thread_id = ? AND created_at <= ?",
    ).get(threadId, hostTime),
  );
  return row ? optionalStringColumn(row, "time") : null;
}

function savedFutureTimes(db: DatabaseSync, threadId: string, hostTime: string): Map<string, string> {
  const rows = databaseRows(
    cachedStatement(
      db,
      "SELECT message_id, created_at FROM projection_thread_messages WHERE thread_id = ? AND created_at > ?",
    ).all(threadId, hostTime),
  );
  return new Map(rows.map((row) => [requiredStringColumn(row, "message_id"), requiredStringColumn(row, "created_at")]));
}
