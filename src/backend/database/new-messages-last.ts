import type { DatabaseSync } from "node:sqlite";
import type { ConversationMessage } from "@openbot/contracts/ipc";
import {
  databaseRow,
  databaseRows,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "./database-rows";
import { cachedStatement } from "./statement-cache";

export function keepNewMessagesLast(
  db: DatabaseSync,
  threadId: string,
  messages: readonly ConversationMessage[],
  now = Date.now(),
): void {
  if (messages.length === 0) return;
  keepMovedDeliveryTimes(db, threadId, messages);
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
  const moving: ConversationMessage[] = [];
  for (const message of messages) {
    const savedFuture = futureTimes.get(message.id);
    const steeredNow = message.steered === true && savedFuture?.steered === false;
    if (savedFuture !== undefined && !steeredNow) {
      if (message.createdAt < savedFuture.time) message.createdAt = savedFuture.time;
      continue;
    }
    if (message.createdAt >= newestSaved || (newestPast !== null && message.createdAt <= newestPast)) continue;
    moving.push(message);
  }
  moving.sort((left, right) => (left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : 0));
  for (const message of moving) {
    latest += 1;
    message.createdAt = new Date(latest).toISOString();
  }
}

function keepMovedDeliveryTimes(db: DatabaseSync, threadId: string, messages: readonly ConversationMessage[]): void {
  const deliveries = messages.filter((message) => message.delivery && !message.steered);
  if (deliveries.length === 0) return;
  const rows = databaseRows(
    cachedStatement(
      db,
      `SELECT saved.message_id, saved.created_at
       FROM json_each(?) AS incoming
       JOIN projection_thread_messages AS saved
         ON saved.thread_id = ? AND saved.message_id = json_extract(incoming.value, '$[0]')
       WHERE saved.created_at > json_extract(incoming.value, '$[1]')
         AND json_extract(saved.message_json, '$.steered') IS NOT 1`,
    ).all(JSON.stringify(deliveries.map((message) => [message.id, message.createdAt])), threadId),
  );
  const savedTimes = new Map(
    rows.map((row) => [requiredStringColumn(row, "message_id"), requiredStringColumn(row, "created_at")]),
  );
  for (const message of deliveries) {
    const savedTime = savedTimes.get(message.id);
    if (savedTime !== undefined && message.createdAt < savedTime) message.createdAt = savedTime;
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

function savedFutureTimes(
  db: DatabaseSync,
  threadId: string,
  hostTime: string,
): Map<string, { time: string; steered: boolean }> {
  const rows = databaseRows(
    cachedStatement(
      db,
      `SELECT message_id, created_at, json_extract(message_json, '$.steered') IS 1 AS steered
       FROM projection_thread_messages WHERE thread_id = ? AND created_at > ?`,
    ).all(threadId, hostTime),
  );
  return new Map(
    rows.map((row) => [
      requiredStringColumn(row, "message_id"),
      { time: requiredStringColumn(row, "created_at"), steered: requiredNumberColumn(row, "steered") === 1 },
    ]),
  );
}
