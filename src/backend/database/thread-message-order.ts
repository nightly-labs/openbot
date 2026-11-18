import type { DatabaseSync } from "node:sqlite";
import { databaseRow, optionalStringColumn, requiredNumberColumn, requiredStringColumn } from "./database-rows";
import { cachedStatement } from "./statement-cache";

/**
 * The stored shown order of a thread's messages: `group_start`, `group_first`, `group_id` and
 * `turn_rank` on each row of `projection_thread_messages`. Pages, cursors and read state sort by them
 * through an index, so a read does not sort the whole thread (#2226).
 *
 * A thread's messages go in the order `sortConversationMessages` shows them. A group is a turn, or a
 * message alone, and starts at its earliest message. A message queued while a turn ran then stays
 * after that turn's answer, which an ACP agent sends only when the turn ends (#1540).
 *
 * Inside a turn, `turn_rank` puts the user's and teammates' input first, then commentary and the plan,
 * then the answer. From a steer on, every row has rank 4 and goes by time. The steer is the turn's
 * second input, or an earlier `steered` input that came after the turn's first row: a turn that the
 * agent started itself has no first input. One window runs over each turn in time order, so it counts
 * the inputs and steers up to each row and starts at the turn's first row. Two groups that start at the
 * same time go by the ordinal of their first row, as the shared order keeps the earlier of two equal
 * groups.
 *
 * The keys of a row depend only on the rows of its turn, so a write refreshes the turns it touched.
 * Every write to the table calls one of these functions in its own transaction. A change to this
 * order needs a migration that refreshes the stored keys. The `steered` rule needed none: no stored
 * row had the field before it, so every stored key stayed the same.
 */

const ROLE_RANK_SQL = `CASE
      WHEN author = 'user' THEN 0
      WHEN author = 'assistant' THEN CASE WHEN item_type IN ('commentary', 'plan') THEN 1 ELSE 3 END
      WHEN json_extract(message_json, '$.exchange.direction') = 'incoming' THEN 0
      ELSE 2
    END`;

/** Whether the row joined a turn that was already running (`ConversationMessage.steered`). */
const STEERED_SQL = "json_extract(message_json, '$.steered') IS 1";

/** The keys of the rows that `filter` selects. Each selected turn must be selected whole. */
function refreshOrderSql(filter: string): string {
  return `WITH ranked AS (
  SELECT message_id, created_at, ordinal, NULLIF(turn_id, '') AS turn, ${ROLE_RANK_SQL} AS role_rank,
    ${STEERED_SQL} AS steered
  FROM projection_thread_messages WHERE thread_id = $thread ${filter}
), steers AS (
  SELECT *, role_rank = 0 AND steered AND created_at > MIN(created_at) OVER (PARTITION BY turn) AS late_steer
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

/** Refreshes the keys of every row of a thread, after a write that can renumber or remove any of them. */
export function refreshThreadOrder(db: DatabaseSync, threadId: string): void {
  db.prepare(refreshOrderSql("")).run({ thread: threadId });
}

/** What the keys of one row are computed from, and its turn. */
export interface MessageOrderInputs {
  turn: string | null;
  inputs: string;
  keyed: boolean;
}

/** The order inputs of the named rows that exist. Read before a write and given to `refreshChangedOrder`. */
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

/**
 * Refreshes the keys after a write of the named rows. A row whose inputs did not change keeps its
 * keys, so a streamed flush of text does no work here. A changed, new or removed row refreshes its
 * old and its new turn, or only itself when it has no turn.
 */
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
