import type { DatabaseSync } from "node:sqlite";
import { databaseRow, optionalStringColumn, requiredNumberColumn, requiredStringColumn } from "./database-rows";
import { cachedStatement } from "./statement-cache";

const ROLE_RANK_SQL = `CASE
      WHEN author = 'user' THEN 0
      WHEN author = 'assistant' THEN CASE WHEN item_type IN ('commentary', 'plan', 'question_prompt') THEN 1 ELSE 3 END
      WHEN json_extract(message_json, '$.exchange.direction') = 'incoming' THEN 0
      ELSE 2
    END`;

const STEERED_SQL = "json_extract(message_json, '$.steered') IS 1";

function refreshOrderSql(filter: string): string {
  return `WITH ranked AS (
  SELECT message_id, created_at, ordinal, NULLIF(turn_id, '') AS turn, ${ROLE_RANK_SQL} AS role_rank,
    ${STEERED_SQL} AS steered, item_type = 'question_prompt' AS question
  FROM projection_thread_messages WHERE thread_id = $thread ${filter}
), steers AS (
  SELECT *, role_rank = 0 AND created_at > CASE WHEN steered THEN MIN(created_at) OVER (PARTITION BY turn)
    ELSE MIN(CASE WHEN question THEN created_at END) OVER (PARTITION BY turn) END AS late_steer
  FROM ranked
), keyed AS (
  SELECT message_id,
    CASE WHEN turn IS NULL THEN created_at ELSE MIN(created_at) OVER turn_by_time END AS group_start,
    CASE WHEN turn IS NULL THEN ordinal ELSE FIRST_VALUE(ordinal) OVER turn_by_time END AS group_first,
    CASE WHEN turn IS NULL THEN 'message:' || message_id ELSE 'turn:' || turn END AS group_id,
    CASE WHEN turn IS NULL THEN 0
      WHEN SUM(role_rank = 0) OVER turn_by_time >= 2 OR SUM(late_steer) OVER turn_by_time >= 1 THEN 4
      ELSE role_rank END AS turn_rank
  FROM steers
  WINDOW turn_by_time AS (PARTITION BY turn ORDER BY created_at, ordinal)
)
UPDATE projection_thread_messages AS message
SET group_start = keyed.group_start, group_first = keyed.group_first,
  group_id = keyed.group_id, turn_rank = keyed.turn_rank
FROM keyed
WHERE message.thread_id = $thread AND message.message_id = keyed.message_id
  AND (message.group_start, message.group_first, message.group_id, message.turn_rank)
    IS NOT (keyed.group_start, keyed.group_first, keyed.group_id, keyed.turn_rank)`;
}

export function refreshThreadOrder(db: DatabaseSync, threadId: string): void {
  db.prepare(refreshOrderSql("")).run({ thread: threadId });
}

export interface MessageOrderInputs {
  turn: string | null;
  inputs: string;
  keyed: boolean;
}

export function readOrderInputs(
  db: DatabaseSync,
  threadId: string,
  messageIds: readonly string[],
): Map<string, MessageOrderInputs> {
  const read = cachedStatement(
    db,
    `SELECT NULLIF(turn_id, '') AS turn,
       created_at || char(0) || ordinal || char(0) || (${ROLE_RANK_SQL}) || char(0) || (${STEERED_SQL}) AS inputs,
       group_id IS NOT NULL AS keyed
     FROM projection_thread_messages WHERE thread_id = ? AND message_id = ?`,
  );
  const result = new Map<string, MessageOrderInputs>();
  for (const messageId of new Set(messageIds)) {
    const row = databaseRow(read.get(threadId, messageId));
    if (!row) continue;
    result.set(messageId, {
      turn: optionalStringColumn(row, "turn"),
      inputs: requiredStringColumn(row, "inputs"),
      keyed: requiredNumberColumn(row, "keyed") === 1,
    });
  }
  return result;
}

export function refreshChangedOrder(
  db: DatabaseSync,
  threadId: string,
  before: ReadonlyMap<string, MessageOrderInputs>,
  messageIds: readonly string[],
): void {
  const after = readOrderInputs(db, threadId, messageIds);
  const turns = new Set<string>();
  const singles = new Set<string>();
  for (const messageId of new Set(messageIds)) {
    const previous = before.get(messageId);
    const current = after.get(messageId);
    if (previous && current?.keyed && previous.inputs === current.inputs && previous.turn === current.turn) continue;
    if (previous?.turn) turns.add(previous.turn);
    if (current?.turn) turns.add(current.turn);
    else if (current) singles.add(messageId);
  }
  if (turns.size > 0) {
    const refreshTurn = cachedStatement(db, refreshOrderSql("AND turn_id = $key"));
    for (const turn of turns) refreshTurn.run({ thread: threadId, key: turn });
  }
  if (singles.size > 0) {
    const refreshMessage = cachedStatement(db, refreshOrderSql("AND message_id = $key"));
    for (const messageId of singles) refreshMessage.run({ thread: threadId, key: messageId });
  }
}
