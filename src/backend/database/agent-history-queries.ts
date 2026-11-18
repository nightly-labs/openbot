import {
  AGENT_EXCHANGE_ITEM_TYPE,
  AGENT_WELCOME_ITEM_TYPE,
  CHANNEL_RESUME_ITEM_TYPE,
  CONTEXT_RESET_ITEM_TYPE,
  type ConversationTurnTrace,
  isConversationTurnTrace,
} from "@openbot/contracts/ipc";
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
  /**
   * Also the requests that this agent sent to teammates. The chat keeps them as system messages, so
   * without this the agent could not read or search what it delegated (#10380).
   */
  outgoing?: boolean;
  limit: number;
}

/** A `messageId` or `before` that names no message of the chat after its latest reset. */
export class HistoryReferenceUnavailable extends Error {
  constructor() {
    super("History reference is unavailable. Read recent history again.");
  }
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
    // An agent knows a teammate request by its "Message ID", which the chat keeps as the exchange's
    // message: the sender's copy and the recipient's copy have their own ids (#10380).
    const anchorId = selection.messageId ?? selection.before;
    const anchor = anchorId
      ? databaseRow(
          this.#core.connection
            .prepare(
              `${cte} SELECT message_id FROM allowed
              WHERE message_id = ? OR json_extract(message_json, '$.exchange.messageId') = ?
              ORDER BY message_id = ? DESC, ${ORDER_KEY_DESC} LIMIT 1`,
            )
            .get(...bindings, anchorId, anchorId, anchorId),
        )
      : null;
    if (anchorId && !anchor) throw new HistoryReferenceUnavailable();
    const anchorMessageId = anchor ? requiredStringColumn(anchor, "message_id") : null;
    const messageId = selection.messageId === undefined ? null : anchorMessageId;
    const before = selection.before === undefined ? null : anchorMessageId;
    const rows = databaseRows(
      this.#core.connection
        .prepare(`${cte}
      SELECT message_json,
        (SELECT provider_session_id FROM projection_turns WHERE thread_id = ? AND turn_id = json_extract(allowed.message_json, '$.turnId')) AS provider_session_id
      FROM allowed WHERE (author IN ('user', 'assistant', 'agent') OR (? AND author = 'system'
          AND item_type = '${AGENT_EXCHANGE_ITEM_TYPE}' AND json_extract(message_json, '$.exchange.direction') = 'outgoing'))
        AND COALESCE(item_type, '') NOT IN ('commentary', '${AGENT_WELCOME_ITEM_TYPE}', '${CHANNEL_RESUME_ITEM_TYPE}')
        AND COALESCE(json_extract(message_json, '$.delivery.status'), 'completed') IN ('completed', 'failed', 'interrupted')
        AND (? IS NULL OR author = ?)
        AND (? IS NULL OR message_id = ?)
        AND (? IS NULL OR (${ORDER_KEY_COLUMNS}) < (SELECT ${ORDER_KEY_COLUMNS} FROM allowed WHERE message_id = ?))
      ORDER BY ${ORDER_KEY_DESC} LIMIT ?`)
        .all(
          ...bindings,
          threadId,
          selection.outgoing ? 1 : 0,
          selection.author ?? null,
          selection.author ?? null,
          messageId,
          messageId,
          before,
          before,
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

  /**
   * The trace of a turn. Only one message of the turn holds it, and that message can be a thinking
   * message that `read` leaves out, or on another page.
   */
  turnTrace(threadId: string, turnId: string): ConversationTurnTrace | null {
    const row = databaseRow(
      this.#core.connection
        .prepare(
          `SELECT json_extract(message_json, '$.trace') AS trace FROM projection_thread_messages
          WHERE thread_id = ? AND turn_id = ? AND json_type(message_json, '$.trace') = 'object' LIMIT 1`,
        )
        .get(threadId, turnId),
    );
    const text = row ? optionalStringColumn(row, "trace") : null;
    if (!text) return null;
    const trace = JSON.parse(text);
    return isConversationTurnTrace(trace) ? trace : null;
  }
}
