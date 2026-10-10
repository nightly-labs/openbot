import { CONTEXT_RESET_ITEM_TYPE } from "@openbot/contracts/ipc";
import { ORDER_KEY_COLUMNS, ORDER_KEY_DESC, ORDERED_THREAD_MESSAGES } from "./conversation-queries";
import type { DatabaseCore } from "./database-core";
import {
  databaseRow,
  databaseRows,
  decodeConversationMessageJson,
  optionalStringColumn,
  requiredStringColumn,
} from "./database-rows";

export interface AgentHistorySelection {
  before?: string;
  messageId?: string;
  author?: string;
  limit: number;
}

/** Model history reads use a thread and reset boundary; UI history remains unchanged. */
export class AgentHistoryQueries {
  readonly #core: DatabaseCore;
  constructor(core: DatabaseCore) {
    this.#core = core;
  }

  read(agentId: string, threadId: string, selection: AgentHistorySelection) {
    const owner = this.#core.connection
      .prepare("SELECT thread_id FROM projection_threads WHERE thread_id = ? AND agent_id = ?")
      .get(threadId, agentId);
    if (!owner) throw new Error("History is unavailable in this conversation.");
    const cte = `${ORDERED_THREAD_MESSAGES}, visible AS (
      SELECT ordered.*, message.message_json FROM ordered
      JOIN projection_thread_messages message ON message.thread_id = ? AND message.message_id = ordered.message_id
    ), boundary AS (
      SELECT * FROM visible WHERE item_type = ? AND author = 'system'
      AND json_extract(message_json, '$.source') = 'system' AND json_extract(message_json, '$.status') = 'completed'
      ORDER BY ${ORDER_KEY_DESC} LIMIT 1
    ), allowed AS (
      SELECT * FROM visible WHERE NOT EXISTS (SELECT 1 FROM boundary)
      OR (${ORDER_KEY_COLUMNS}) > (SELECT ${ORDER_KEY_COLUMNS} FROM boundary)
    )`;
    const bindings = [threadId, threadId, CONTEXT_RESET_ITEM_TYPE];
    const reset = databaseRow(this.#core.connection.prepare(`${cte} SELECT message_id FROM boundary`).get(...bindings));
    const resetMessageId = reset ? requiredStringColumn(reset, "message_id") : null;
    const anchorId = selection.messageId ?? selection.before;
    if (
      anchorId &&
      !this.#core.connection
        .prepare(`${cte} SELECT message_id FROM allowed WHERE message_id = ?`)
        .get(...bindings, anchorId)
    ) {
      throw new Error("History reference is unavailable. Read recent history again.");
    }
    const rows = databaseRows(
      this.#core.connection
        .prepare(`${cte}
      SELECT message_json,
        (SELECT provider_session_id FROM projection_turns WHERE thread_id = ? AND turn_id = json_extract(allowed.message_json, '$.turnId')) AS provider_session_id
      FROM allowed WHERE author IN ('user', 'assistant', 'agent')
        AND COALESCE(item_type, '') != 'commentary'
        AND COALESCE(json_extract(message_json, '$.delivery.status'), 'completed') IN ('completed', 'failed', 'interrupted')
        AND (? IS NULL OR author = ?)
        AND (? IS NULL OR message_id = ?)
        AND (? IS NULL OR (${ORDER_KEY_COLUMNS}) < (SELECT ${ORDER_KEY_COLUMNS} FROM allowed WHERE message_id = ?))
      ORDER BY ${ORDER_KEY_DESC} LIMIT ?`)
        .all(
          ...bindings,
          threadId,
          selection.author ?? null,
          selection.author ?? null,
          selection.messageId ?? null,
          selection.messageId ?? null,
          selection.before ?? null,
          selection.before ?? null,
          selection.limit,
        ),
    );
    return {
      resetMessageId,
      messages: rows.map((row) => ({
        message: decodeConversationMessageJson(requiredStringColumn(row, "message_json")),
        providerSessionId: optionalStringColumn(row, "provider_session_id"),
      })),
    };
  }
}
