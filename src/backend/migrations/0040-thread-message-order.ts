import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord } from "./runtime-values";

// Migration 40 stores the shown-order keys of each thread message, so a page reads an index range rather
// than sorting the whole thread (#2226). Frozen with the migration; `database/thread-message-order.ts`
// keeps them current, and every write to the table must call it. No default: a key of 0 or '' would look
// real. ADD COLUMN puts the columns before the PRIMARY KEY constraint that ends the table.
export const V40_THREAD_MESSAGE_ORDER_COLUMNS_SQL = [
  "group_start TEXT",
  "group_first INTEGER",
  "group_id TEXT",
  "turn_rank INTEGER",
] as const;

// The order index carries the author and item type, so the marker and unread filters read no table row.
// The turn index finds the rows of one turn for its refresh after a write.
export const V40_THREAD_MESSAGE_ORDER_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS thread_messages_shown_order ON projection_thread_messages(
    thread_id, group_start, group_first, group_id, turn_rank, created_at, ordinal, message_id, author, item_type
  );
  CREATE INDEX IF NOT EXISTS thread_messages_turn ON projection_thread_messages(thread_id, turn_id);
`;

// The order of migration 40, frozen: the window that pages ran over each thread before it, over every
// thread at once. A row that has its keys already is not written again.
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

// Migration 40 stores the shown-order keys of each thread message and indexes them.
function addThreadMessageOrder(db: DatabaseSync): void {
  // A development profile that ran this version before it shipped has the columns already.
  const columns = db.prepare("PRAGMA table_info(projection_thread_messages)").all();
  for (const column of V40_THREAD_MESSAGE_ORDER_COLUMNS_SQL) {
    const name = column.slice(0, column.indexOf(" "));
    if (columns.some((existing) => isDynamicRecord(existing) && existing.name === name)) continue;
    db.exec(`ALTER TABLE projection_thread_messages ADD COLUMN ${column}`);
  }
  // The index is built once, after the keys, rather than updated row by row.
  db.exec(V40_THREAD_MESSAGE_ORDER_BACKFILL_SQL);
  db.exec(V40_THREAD_MESSAGE_ORDER_INDEX_SQL);
}

export const migration: OpenBotMigration = {
  version: 40,
  name: "thread-message-order",
  // Adds columns with no default and two indexes: no rebuild, so no foreign-key pause and no vacuum. The
  // keys of every existing message come from the order that pages computed before, so a cursor that a
  // client holds keeps its place.
  up: addThreadMessageOrder,
};
