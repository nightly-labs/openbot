import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord } from "./runtime-values";

export const V40_THREAD_MESSAGE_ORDER_COLUMNS_SQL = [
  "group_start TEXT",
  "group_first INTEGER",
  "group_id TEXT",
  "turn_rank INTEGER",
] as const;

export const V40_THREAD_MESSAGE_ORDER_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS thread_messages_shown_order ON projection_thread_messages(
    thread_id, group_start, group_first, group_id, turn_rank, created_at, ordinal, message_id, author, item_type
  );
  CREATE INDEX IF NOT EXISTS thread_messages_turn ON projection_thread_messages(thread_id, turn_id);
`;

const V40_THREAD_MESSAGE_ORDER_BACKFILL_SQL = `WITH ranked AS (
  SELECT thread_id, message_id, created_at, ordinal, NULLIF(turn_id, '') AS turn,
    CASE
      WHEN author = 'user' THEN 0
      WHEN author = 'assistant' THEN CASE WHEN item_type IN ('commentary', 'plan') THEN 1 ELSE 3 END
      WHEN json_extract(message_json, '$.exchange.direction') = 'incoming' THEN 0
      ELSE 2
    END AS role_rank
  FROM projection_thread_messages
), keyed AS (
  SELECT thread_id, message_id,
    CASE WHEN turn IS NULL THEN created_at ELSE MIN(created_at) OVER turn_by_time END AS group_start,
    CASE WHEN turn IS NULL THEN ordinal ELSE FIRST_VALUE(ordinal) OVER turn_by_time END AS group_first,
    CASE WHEN turn IS NULL THEN 'message:' || message_id ELSE 'turn:' || turn END AS group_id,
    CASE WHEN turn IS NULL THEN 0
      WHEN SUM(role_rank = 0) OVER turn_by_time >= 2 THEN 4
      ELSE role_rank END AS turn_rank
  FROM ranked
  WINDOW turn_by_time AS (PARTITION BY thread_id, turn ORDER BY created_at, ordinal)
)
UPDATE projection_thread_messages AS message
SET group_start = keyed.group_start, group_first = keyed.group_first,
  group_id = keyed.group_id, turn_rank = keyed.turn_rank
FROM keyed
WHERE message.thread_id = keyed.thread_id AND message.message_id = keyed.message_id
  AND (message.group_start, message.group_first, message.group_id, message.turn_rank)
    IS NOT (keyed.group_start, keyed.group_first, keyed.group_id, keyed.turn_rank)`;

function addThreadMessageOrder(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(projection_thread_messages)").all();
  for (const column of V40_THREAD_MESSAGE_ORDER_COLUMNS_SQL) {
    const name = column.slice(0, column.indexOf(" "));
    if (columns.some((existing) => isDynamicRecord(existing) && existing.name === name)) continue;
    db.exec(`ALTER TABLE projection_thread_messages ADD COLUMN ${column}`);
  }
  db.exec(V40_THREAD_MESSAGE_ORDER_BACKFILL_SQL);
  db.exec(V40_THREAD_MESSAGE_ORDER_INDEX_SQL);
}

export const migration: OpenBotMigration = {
  version: 40,
  name: "thread-message-order",
  up: addThreadMessageOrder,
};
