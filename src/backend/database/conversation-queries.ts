import { CHAT_VISUAL_ITEM_TYPE_PREFIX } from "@openbot/contracts/chat-visual";
import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import type {
  ConversationFileSearchPage,
  ConversationFileSearchResult,
  ConversationMessage,
  ConversationPage,
  ConversationPageAnchor,
  ConversationSearchPage,
  ConversationSnapshot,
} from "@openbot/contracts/ipc";
import {
  HOSTED_SITE_EVENT_ITEM_TYPE_PREFIX,
  isAttachmentSummary,
  MARKETPLACE_SUGGESTION_ITEM_TYPE_PREFIX,
  ROUTINE_EVENT_ITEM_TYPE_PREFIX,
  ROUTINE_QUIET_ANSWER_ITEM_TYPE,
  ROUTINE_RUN_EVENT_ITEM_TYPE_PREFIX,
  SKILL_EVENT_ITEM_TYPE_PREFIX,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { COLLAPSE_WHITESPACE_FUNCTION, type DatabaseCore, LOWERCASE_FUNCTION } from "./database-core";
import {
  databaseRow,
  databaseRows,
  decodeConversationMessageJson,
  decodeConversationThreadRow,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "./database-rows";

export interface ConversationQueriesOptions {
  core: DatabaseCore;
}

/** The message kinds that a Team API client cannot show, left out of its pages and read state. */
export interface ConversationMarkerExclusions {
  excludeRoutineEvents?: boolean;
  excludeRoutineRunEvents?: boolean;
  excludeHostedSiteEvents?: boolean;
  excludeRoutineQuietAnswers?: boolean;
}

/**
 * A channel gives each of its members a thread of its own, and a side thread has one too, under the same
 * agent id as the normal chat. A search result carries an agent id and a message, and opening one
 * shows the normal conversation of that agent, where a channel or task message does not exist. These
 * threads stay out of the search until a result can name the channel or task it belongs to. A message
 * search that asks for side threads names the thread of each result.
 */
const CHANNEL_THREAD_EXCLUSION = "AND message.thread_id NOT IN (SELECT thread_id FROM projection_channel_contexts)";
const SIDE_THREAD_EXCLUSION = `${CHANNEL_THREAD_EXCLUSION}
             AND message.thread_id NOT IN (SELECT thread_id FROM projection_agent_threads)`;
/** An archived side thread does not show, so its messages stay out of the search. */
const ARCHIVED_SIDE_THREAD_EXCLUSION = `${CHANNEL_THREAD_EXCLUSION}
             AND message.thread_id NOT IN (SELECT thread_id FROM projection_agent_threads WHERE archived_at IS NOT NULL)`;

/**
 * Every read of a thread's messages: the whole snapshot, one anchored page, a page's supported
 * cursor, and a text search across the thread.
 *
 * Owns the read side of `projection_thread_messages` and the opaque base64url cursors that page it,
 * including the marker filters that hide routine and hosted-site events from a page whose caller
 * did not ask for them. Reads only — nothing here dispatches an event or opens a transaction. The
 * class never imports the facade.
 */
export class ConversationQueries {
  readonly #core: DatabaseCore;

  constructor(options: ConversationQueriesOptions) {
    this.#core = options.core;
  }

  readConversation(agentId: string, threadId: string | null): ConversationSnapshot {
    if (!threadId) return { agentId, threadId: null, activeTurnId: null, revision: 0, messages: [] };
    const thread = decodeConversationThreadRow(
      this.#core.connection
        .prepare(
          `SELECT active_turn_id, last_event_sequence
           FROM projection_threads WHERE thread_id = ? AND agent_id = ?`,
        )
        .get(threadId, agentId),
    );
    const rows = databaseRows(
      this.#core.connection
        .prepare(
          `SELECT message_json FROM projection_thread_messages
           WHERE thread_id = ? ORDER BY created_at, ordinal, message_id`,
        )
        .all(threadId),
    );
    return {
      agentId,
      threadId,
      activeTurnId: thread?.active_turn_id ?? null,
      revision: thread?.last_event_sequence ?? 0,
      messages: sortConversationMessages(rows.map((row) => JSON.parse(requiredStringColumn(row, "message_json")))),
    };
  }

  /**
   * The assistant messages of one turn, in order. A routine flow reads only the answer of a turn,
   * so it does not load and parse the whole history of the thread for it.
   */
  readTurnAssistantMessages(agentId: string, threadId: string, turnId: string): ConversationMessage[] {
    const rows = databaseRows(
      this.#core.connection
        .prepare(
          `SELECT message.message_json FROM projection_thread_messages AS message
           JOIN projection_threads AS thread ON thread.thread_id = message.thread_id
           WHERE message.thread_id = ? AND thread.agent_id = ? AND message.turn_id = ? AND message.author = 'assistant'
           ORDER BY message.created_at, message.ordinal, message.message_id`,
        )
        .all(threadId, agentId, turnId),
    );
    return rows.map((row) => JSON.parse(requiredStringColumn(row, "message_json")));
  }

  /**
   * The turn that runs on one thread, read from the thread row alone.
   *
   * `readConversation` answers this as well, but it loads and parses every message of the thread to
   * do it. The callers here ask only "is this thread busy" - a refresh after an MCP or tool change
   * asks it of every thread of every agent - so a whole history would be read and thrown away.
   */
  readActiveTurnId(agentId: string, threadId: string | null): string | null {
    if (!threadId) return null;
    const row = databaseRow(
      this.#core.connection
        .prepare("SELECT active_turn_id FROM projection_threads WHERE thread_id = ? AND agent_id = ?")
        .get(threadId, agentId),
    );
    return row ? optionalStringColumn(row, "active_turn_id") : null;
  }

  /**
   * The turns that the store still shows as running, by thread. A running turn that is not the
   * thread's active turn has no writer left: its end was never stored. Restart recovery reads this
   * once to close such rows (#2214); `projection_turns` has no thread index, so one scan serves
   * every thread.
   */
  readRunningTurnIds(): Map<string, string[]> {
    const turns = new Map<string, string[]>();
    for (const row of databaseRows(
      this.#core.connection.prepare("SELECT thread_id, turn_id FROM projection_turns WHERE status = 'running'").all(),
    )) {
      const threadId = requiredStringColumn(row, "thread_id");
      turns.set(threadId, [...(turns.get(threadId) ?? []), requiredStringColumn(row, "turn_id")]);
    }
    return turns;
  }

  readConversationRevision(agentId: string, threadId: string | null): number {
    if (!threadId) return 0;
    const row = databaseRow(
      this.#core.connection
        .prepare("SELECT last_event_sequence FROM projection_threads WHERE thread_id = ? AND agent_id = ?")
        .get(threadId, agentId),
    );
    return row ? requiredNumberColumn(row, "last_event_sequence") : 0;
  }

  readConversationRuntime(
    agentId: string,
    threadId: string | null,
  ): { activeTurnId: string | null; latestMessage: ConversationMessage | null } {
    if (!threadId) return { activeTurnId: null, latestMessage: null };
    const row = databaseRow(
      this.#core.connection
        .prepare(
          `SELECT thread.active_turn_id,
                  (SELECT message.message_json
                   FROM projection_thread_messages message
                   WHERE message.thread_id = thread.thread_id
                     AND json_extract(message.message_json, '$.author') IN ('assistant', 'agent')
                     AND COALESCE(json_extract(message.message_json, '$.itemType'), '') != 'commentary'
                     AND COALESCE(json_extract(message.message_json, '$.itemType'), '') != 'question_prompt'
                     AND COALESCE(json_extract(message.message_json, '$.itemType'), '') != 'agent_attachment'
                     AND COALESCE(json_extract(message.message_json, '$.itemType'), '') NOT LIKE '${CHAT_VISUAL_ITEM_TYPE_PREFIX}%'
                     AND COALESCE(json_extract(message.message_json, '$.itemType'), '') != 'plan'
                     AND COALESCE(json_extract(message.message_json, '$.itemType'), '') != 'subagents'
                     AND COALESCE(json_extract(message.message_json, '$.itemType'), '') != '${ROUTINE_QUIET_ANSWER_ITEM_TYPE}'
                     AND json_extract(message.message_json, '$.senderAgentId') IS NULL
                   ORDER BY message.created_at DESC, message.ordinal DESC, message.message_id DESC
                   LIMIT 1) AS latest_message_json
           FROM projection_threads thread
           WHERE thread.thread_id = ? AND thread.agent_id = ?`,
        )
        .get(threadId, agentId),
    );
    if (!row) return { activeTurnId: null, latestMessage: null };
    const latestMessage = optionalStringColumn(row, "latest_message_json");
    return {
      activeTurnId: optionalStringColumn(row, "active_turn_id"),
      latestMessage: latestMessage ? decodeConversationMessageJson(latestMessage) : null,
    };
  }

  /** Reads only named messages for a row-level conversation update. */
  readConversationMessages(
    agentId: string,
    threadId: string | null,
    messageIds: readonly string[],
  ): ConversationMessage[] {
    if (!threadId || messageIds.length === 0) return [];
    const placeholders = messageIds.map(() => "?").join(", ");
    return databaseRows(
      this.#core.connection
        .prepare(
          `SELECT message_json FROM projection_thread_messages
           WHERE thread_id = ? AND message_id IN (${placeholders})
           AND thread_id IN (SELECT thread_id FROM projection_threads WHERE agent_id = ?)
           ORDER BY created_at, ordinal, message_id`,
        )
        .all(threadId, ...messageIds, agentId),
    ).map((row) => decodeConversationMessageJson(requiredStringColumn(row, "message_json")));
  }

  /** Reads only messages that restart recovery can change. */
  readConversationRecoveryMessages(
    agentId: string,
    threadId: string | null,
    activeTurnId: string | null,
  ): ConversationMessage[] {
    if (!threadId) return [];
    const rows = databaseRows(
      this.#core.connection
        .prepare(
          `SELECT message_json FROM projection_thread_messages
           WHERE thread_id = ?
             AND thread_id IN (SELECT thread_id FROM projection_threads WHERE agent_id = ?)
             AND (
               (? IS NOT NULL AND turn_id = ? AND status = 'streaming')
               OR json_type(message_json, '$.questionPrompt.resolution') = 'null'
                  AND json_type(message_json, '$.questionPrompt') = 'object'
               OR json_extract(message_json, '$.itemType') = 'subagents'
                  AND EXISTS (
                    SELECT 1 FROM json_each(message_json, '$.subagents')
                    WHERE json_extract(value, '$.status') = 'running'
                  )
             )
           ORDER BY created_at, ordinal, message_id`,
        )
        .all(threadId, agentId, activeTurnId, activeTurnId),
    );
    return rows.map((row) => decodeConversationMessageJson(requiredStringColumn(row, "message_json")));
  }

  readConversationPage(
    agentId: string,
    threadId: string | null,
    anchor: ConversationPageAnchor = { type: "latest" },
    requestedLimit = 50,
    options: ConversationMarkerExclusions = {},
  ): ConversationPage {
    if (!threadId) {
      return {
        agentId,
        threadId: null,
        activeTurnId: null,
        revision: 0,
        messages: [],
        references: {},
        pageInfo: { hasOlder: false, olderCursor: null },
      };
    }
    const limit = pageLimit(requestedLimit);
    const thread = decodeConversationThreadRow(
      this.#core.connection
        .prepare(
          `SELECT active_turn_id, last_event_sequence
           FROM projection_threads WHERE thread_id = ? AND agent_id = ?`,
        )
        .get(threadId, agentId),
    );
    const rows = this.#conversationPageRows(threadId, anchor, limit, options);
    // The rows come in the shown order, which a cursor follows. A page of a split turn is not sorted
    // again: it does not hold the turn's first input, which the shared order needs to find a steer.
    const messages = rows.map((row) => decodeConversationMessageJson(requiredStringColumn(row, "message_json")));
    const messageIds = new Set(messages.map((message) => message.id));
    const referenceIdSet = new Set<string>();
    for (const message of messages) {
      const referenceId = message.replyToMessageId;
      if (referenceId && !messageIds.has(referenceId)) referenceIdSet.add(referenceId);
    }
    const referenceIds = [...referenceIdSet];
    const references: Record<string, ConversationMessage> = {};
    if (referenceIds.length > 0) {
      const placeholders = referenceIds.map(() => "?").join(", ");
      const referenceRows = databaseRows(
        this.#core.connection
          .prepare(
            `SELECT message_id, message_json FROM projection_thread_messages
             WHERE thread_id = ? AND message_id IN (${placeholders})
             ${conversationMarkerSqlFilter(options)}`,
          )
          .all(threadId, ...referenceIds),
      );
      for (const row of referenceRows) {
        references[requiredStringColumn(row, "message_id")] = decodeConversationMessageJson(
          requiredStringColumn(row, "message_json"),
        );
      }
    }
    const first = rows[0];
    const older = first
      ? this.#conversationRowsBefore(threadId, conversationRowCursor(first), options)
      : { count: 0, oldestAt: null };
    const hasOlder = older.count > 0;
    return {
      agentId,
      threadId,
      activeTurnId: thread?.active_turn_id ?? null,
      revision: thread?.last_event_sequence ?? 0,
      messages,
      references,
      pageInfo: {
        hasOlder,
        olderCursor: hasOlder && first ? encodePageCursor(conversationRowCursor(first)) : null,
        ...(hasOlder ? { olderCount: older.count } : {}),
        ...(older.oldestAt ? { oldestAt: older.oldestAt } : {}),
      },
    };
  }

  supportedConversationCursor(
    threadId: string,
    throughMessageId: string | null,
    options: ConversationMarkerExclusions = {},
  ): string | null {
    if (!throughMessageId) return null;
    const boundary = databaseRow(
      this.#core.connection
        .prepare(
          `${ORDERED_THREAD_MESSAGES}
           SELECT ${ORDER_KEY_COLUMNS} FROM ordered WHERE message_id = ?`,
        )
        .get(threadId, throughMessageId),
    );
    if (!boundary) return null;
    const row = databaseRow(
      this.#core.connection
        .prepare(
          `${ORDERED_THREAD_MESSAGES}
           SELECT message_id FROM ordered
           WHERE (${ORDER_KEY_COLUMNS}) <= (?, ?, ?, ?, ?, ?, ?)
             ${conversationMarkerSqlFilter(options)}
           ORDER BY ${ORDER_KEY_DESC}
           LIMIT 1`,
        )
        .get(threadId, ...pageKeyValues(conversationRowCursor(boundary))),
    );
    return row ? requiredStringColumn(row, "message_id") : null;
  }

  searchConversationMessages(
    query: string,
    agentId?: string,
    cursor?: string,
    requestedLimit = 100,
    includeSideThreads = false,
  ): ConversationSearchPage {
    const normalized = query.trim().replace(/\s+/g, " ").toLocaleLowerCase();
    if (!normalized) return { results: [], total: 0, nextCursor: null };
    const limit = pageLimit(requestedLimit);
    const offset = cursor ? decodeSearchCursor(cursor) : 0;
    const pattern = `%${escapeLike(normalized)}%`;
    const storedText = "json_extract(message.message_json, '$.text')";
    const textMatch = `LOWER(${storedText}) LIKE ? ESCAPE '\\'`;
    const terms = normalized.split(" ");
    // A query with a space can match across a line break. Only the rows that contain its longest
    // term pay for the whitespace call.
    const longestTerm = terms.reduce((longest, term) => (term.length > longest.length ? term : longest));
    const textFilter =
      terms.length > 1
        ? `${textMatch} AND LOWER(${COLLAPSE_WHITESPACE_FUNCTION}(${storedText})) LIKE ? ESCAPE '\\'`
        : textMatch;
    const textParameters = terms.length > 1 ? [`%${escapeLike(longestTerm)}%`, pattern] : [pattern];
    const filter = agentId ? "AND thread.agent_id = ?" : "";
    const parameters = agentId ? [...textParameters, agentId] : textParameters;
    // The text filter reads every stored message, so it runs one time: the matches keep only their
    // keys, the total counts them, and only the page's rows read their message (#2279). The left
    // join gives the total also for a cursor past the last page.
    const rows = databaseRows(
      this.#core.connection
        .prepare(
          `WITH matches AS MATERIALIZED (
             SELECT message.rowid AS message_rowid, thread.agent_id, message.created_at, message.ordinal, message.message_id
             FROM projection_thread_messages message
             JOIN projection_threads thread ON thread.thread_id = message.thread_id
             WHERE ${textFilter}
               AND COALESCE(json_extract(message.message_json, '$.delivery.status'), '') NOT IN ('queued', 'cancelled')
               AND COALESCE(message.item_type, '') NOT IN ('commentary', '${ROUTINE_QUIET_ANSWER_ITEM_TYPE}')
               AND COALESCE(message.item_type, '') NOT LIKE '${SKILL_EVENT_ITEM_TYPE_PREFIX}%' AND COALESCE(message.item_type, '') NOT LIKE '${ROUTINE_EVENT_ITEM_TYPE_PREFIX}%'
               AND COALESCE(message.item_type, '') NOT LIKE '${ROUTINE_RUN_EVENT_ITEM_TYPE_PREFIX}%'
               AND COALESCE(message.item_type, '') NOT LIKE '${HOSTED_SITE_EVENT_ITEM_TYPE_PREFIX}%'
               AND COALESCE(message.item_type, '') NOT LIKE '${MARKETPLACE_SUGGESTION_ITEM_TYPE_PREFIX}%'
               AND json_extract(message.message_json, '$.routine') IS NULL
               ${includeSideThreads ? ARCHIVED_SIDE_THREAD_EXCLUSION : SIDE_THREAD_EXCLUSION}
               ${filter}
           )
           SELECT counted.count, page.agent_id, message.message_json,
             COALESCE(side.legacy_task_id, side.thread_id) AS task_id
           FROM (SELECT COUNT(*) AS count FROM matches) counted
           LEFT JOIN (
             SELECT * FROM matches
             ORDER BY created_at DESC, ordinal DESC, message_id DESC
             LIMIT ? OFFSET ?
           ) page
           LEFT JOIN projection_thread_messages message ON message.rowid = page.message_rowid
           LEFT JOIN projection_agent_threads side ON side.thread_id = message.thread_id
           ORDER BY page.created_at DESC, page.ordinal DESC, page.message_id DESC`,
        )
        .all(...parameters, limit, offset),
    );
    const total = rows[0] ? requiredNumberColumn(rows[0], "count") : 0;
    // An empty page is one row with the count only.
    const results = rows.flatMap((row) => {
      const messageJson = optionalStringColumn(row, "message_json");
      if (messageJson === null) return [];
      const taskId = optionalStringColumn(row, "task_id");
      return [
        {
          agentId: requiredStringColumn(row, "agent_id"),
          message: decodeConversationMessageJson(messageJson),
          ...(taskId === null ? {} : { taskId }),
        },
      ];
    });
    const nextOffset = offset + results.length;
    return {
      results,
      total,
      nextCursor: nextOffset < total ? encodeSearchCursor(nextOffset) : null,
    };
  }

  /**
   * The files of agent chat messages whose name contains the query, newest first. The owner of a
   * chat attachment is `${threadId}:${messageId}`, and a thread id has no colon. Channel threads
   * stay out for the same reason as in the message search.
   */
  searchConversationFiles(query: string, cursor?: string, requestedLimit = 50): ConversationFileSearchPage {
    const normalized = query.trim().replace(/\s+/g, " ").toLocaleLowerCase();
    const limit = pageLimit(requestedLimit);
    const offset = cursor ? decodeSearchCursor(cursor) : 0;
    const threadId = "substr(attachment.owner_id, 1, instr(attachment.owner_id, ':') - 1)";
    const messageId = "substr(attachment.owner_id, instr(attachment.owner_id, ':') + 1)";
    const nameFilter = normalized
      ? `AND ${LOWERCASE_FUNCTION}(${COLLAPSE_WHITESPACE_FUNCTION}(attachment.name)) LIKE ? ESCAPE '\\'`
      : "";
    const parameters = normalized ? [`%${escapeLike(normalized)}%`] : [];
    const rows = databaseRows(
      this.#core.connection
        .prepare(
          `SELECT thread.agent_id, message.message_id, attachment.created_at, attachment.metadata_json
           FROM projection_attachments attachment
           JOIN projection_threads thread ON thread.thread_id = ${threadId}
           JOIN projection_thread_messages message
             ON message.thread_id = thread.thread_id AND message.message_id = ${messageId}
           WHERE attachment.owner_kind = 'thread-message'
             AND instr(attachment.owner_id, ':') > 1
             AND COALESCE(json_extract(message.message_json, '$.delivery.status'), '') NOT IN ('queued', 'cancelled')
             ${nameFilter}
             ${SIDE_THREAD_EXCLUSION}
           ORDER BY attachment.created_at DESC, attachment.attachment_id DESC
           LIMIT ? OFFSET ?`,
        )
        // One row more than the page tells if another page follows.
        .all(...parameters, limit + 1, offset),
    );
    const hasMore = rows.length > limit;
    const results = rows.slice(0, limit).flatMap((row): ConversationFileSearchResult[] => {
      const attachment = JSON.parse(requiredStringColumn(row, "metadata_json"));
      if (!isAttachmentSummary(attachment)) return [];
      return [
        {
          agentId: requiredStringColumn(row, "agent_id"),
          messageId: requiredStringColumn(row, "message_id"),
          createdAt: requiredStringColumn(row, "created_at"),
          attachment,
        },
      ];
    });
    return { results, nextCursor: hasMore ? encodeSearchCursor(offset + limit) : null };
  }

  #conversationPageRows(
    threadId: string,
    anchor: ConversationPageAnchor,
    limit: number,
    exclusions: ConversationMarkerExclusions,
  ): DynamicRecord[] {
    const rows = this.#conversationPageKeys(threadId, anchor, limit, exclusions);
    if (rows.length === 0) return [];
    // The order index carries only the keys. The page's messages are read after it is chosen.
    const json = new Map(
      databaseRows(
        this.#core.connection
          .prepare(
            `SELECT message_id, message_json FROM projection_thread_messages
             WHERE thread_id = ? AND message_id IN (${rows.map(() => "?").join(", ")})`,
          )
          .all(threadId, ...rows.map((row) => requiredStringColumn(row, "message_id"))),
      ).map((row) => [requiredStringColumn(row, "message_id"), requiredStringColumn(row, "message_json")]),
    );
    return rows.map((row) => ({ ...row, message_json: json.get(requiredStringColumn(row, "message_id")) }));
  }

  #conversationPageKeys(
    threadId: string,
    anchor: ConversationPageAnchor,
    limit: number,
    exclusions: ConversationMarkerExclusions,
  ): DynamicRecord[] {
    const routineFilter = conversationMarkerSqlFilter(exclusions);
    if (anchor.type === "latest") {
      const rows = databaseRows(
        this.#core.connection
          .prepare(
            `${ORDERED_THREAD_MESSAGES}
             SELECT ${ORDER_KEY_COLUMNS} FROM ordered
             WHERE 1 = 1 ${routineFilter}
             ORDER BY ${ORDER_KEY_DESC} LIMIT ?`,
          )
          .all(threadId, PAGE_MESSAGE_LIMIT + 1),
      );
      return wholeGroups(rows, limit, PAGE_MESSAGE_LIMIT).reverse();
    }
    if (anchor.type === "before") {
      const cursor = this.#pageCursor(threadId, anchor.cursor);
      const rows = databaseRows(
        this.#core.connection
          .prepare(
            `${ORDERED_THREAD_MESSAGES}
             SELECT ${ORDER_KEY_COLUMNS} FROM ordered
             WHERE (${ORDER_KEY_COLUMNS}) < (?, ?, ?, ?, ?, ?, ?)
             ${routineFilter}
             ORDER BY ${ORDER_KEY_DESC} LIMIT ?`,
          )
          .all(threadId, ...pageKeyValues(cursor), PAGE_MESSAGE_LIMIT + 1),
      );
      return wholeGroups(rows, limit, PAGE_MESSAGE_LIMIT).reverse();
    }
    const anchorRow = databaseRow(
      this.#core.connection
        .prepare(
          `${ORDERED_THREAD_MESSAGES}
           SELECT ${ORDER_KEY_COLUMNS} FROM ordered
           WHERE message_id = ? ${routineFilter}`,
        )
        .get(threadId, anchor.messageId),
    );
    if (!anchorRow) return [];
    const anchorKey = pageKeyValues(conversationRowCursor(anchorRow));
    const newerRows = databaseRows(
      this.#core.connection
        .prepare(
          `${ORDERED_THREAD_MESSAGES}
           SELECT ${ORDER_KEY_COLUMNS} FROM ordered
           WHERE (${ORDER_KEY_COLUMNS}) > (?, ?, ?, ?, ?, ?, ?)
           ${routineFilter}
           ORDER BY ${ORDER_KEY_COLUMNS} LIMIT ?`,
        )
        .all(threadId, ...anchorKey, PAGE_MESSAGE_LIMIT + 1),
    );
    // An around page has no newer cursor, so it keeps room for the rest of the anchor's turn when that
    // fits on a page, and for at least half the limit when the turn is larger.
    const anchorGroupId = requiredStringColumn(anchorRow, "group_id");
    const rowsAfterInTurn = newerRows.findIndex((row) => requiredStringColumn(row, "group_id") !== anchorGroupId);
    const reserved = Math.max(
      Math.min(rowsAfterInTurn < 0 ? newerRows.length : rowsAfterInTurn, PAGE_MESSAGE_LIMIT - 1),
      Math.ceil(limit / 2),
    );
    const olderCap = PAGE_MESSAGE_LIMIT - reserved;
    const olderRows = databaseRows(
      this.#core.connection
        .prepare(
          `${ORDERED_THREAD_MESSAGES}
           SELECT ${ORDER_KEY_COLUMNS} FROM ordered
           WHERE (${ORDER_KEY_COLUMNS}) <= (?, ?, ?, ?, ?, ?, ?)
           ${routineFilter}
           ORDER BY ${ORDER_KEY_DESC} LIMIT ?`,
        )
        .all(threadId, ...anchorKey, olderCap + 1),
    );
    const older = wholeGroups(olderRows, Math.floor(limit / 2) + 1, olderCap).reverse();
    return [...older, ...wholeGroups(newerRows, Math.max(limit - older.length, 1), PAGE_MESSAGE_LIMIT - older.length)];
  }

  /** A page cursor from a client. A version 1 cursor, from before pages kept turns whole, gets its row's group. */
  #pageCursor(threadId: string, value: string): ConversationPageCursor {
    const cursor = decodeConversationCursor(value);
    if (cursor.version === 2) return cursor;
    const row = databaseRow(
      this.#core.connection
        .prepare(
          `${ORDERED_THREAD_MESSAGES}
           SELECT group_start, group_first, group_id, turn_rank FROM ordered WHERE message_id = ?`,
        )
        .get(threadId, cursor.messageId),
    );
    return {
      ...cursor,
      version: 2,
      groupStart: row ? requiredStringColumn(row, "group_start") : cursor.createdAt,
      groupFirst: row ? requiredNumberColumn(row, "group_first") : cursor.ordinal,
      groupId: row ? requiredStringColumn(row, "group_id") : `message:${cursor.messageId}`,
      turnRank: row ? requiredNumberColumn(row, "turn_rank") : 0,
    };
  }

  /** How many rows are older than the page, and when the oldest was written: the chat's unloaded length. */
  #conversationRowsBefore(
    threadId: string,
    cursor: ConversationPageCursor,
    exclusions: ConversationMarkerExclusions,
  ): { count: number; oldestAt: string | null } {
    const routineFilter = conversationMarkerSqlFilter(exclusions);
    // The oldest time is the first row in the time index, not a minimum over every older row.
    const row = databaseRow(
      this.#core.connection
        .prepare(
          `${ORDERED_THREAD_MESSAGES}
           SELECT COUNT(*) AS older_count,
             (SELECT created_at FROM projection_thread_messages WHERE thread_id = ? ${routineFilter}
              ORDER BY created_at, ordinal, message_id LIMIT 1) AS oldest_at
           FROM ordered
           WHERE (${ORDER_KEY_COLUMNS}) < (?, ?, ?, ?, ?, ?, ?)
           ${routineFilter}`,
        )
        .get(threadId, threadId, ...pageKeyValues(cursor)),
    );
    return {
      count: row ? requiredNumberColumn(row, "older_count") : 0,
      oldestAt: row ? optionalStringColumn(row, "oldest_at") : null,
    };
  }
}

/**
 * A thread's messages with their stored shown-order keys, which `database/thread-message-order.ts`
 * computes and documents. The order index serves a filter or sort on `ORDER_KEY_COLUMNS`, so a page
 * reads only its range. Pages, cursors and read state use this one order. The one parameter is the
 * thread id.
 */
export const ORDERED_THREAD_MESSAGES = `WITH ordered AS (
  SELECT created_at, ordinal, message_id, author, item_type, group_start, group_first, group_id, turn_rank
  FROM projection_thread_messages WHERE thread_id = ?
)`;
export const ORDER_KEY_COLUMNS = "group_start, group_first, group_id, turn_rank, created_at, ordinal, message_id";
export const ORDER_KEY_DESC =
  "group_start DESC, group_first DESC, group_id DESC, turn_rank DESC, created_at DESC, ordinal DESC, message_id DESC";

/** Page decoders on IPC and every Team API version reject a conversation page of more than 100 messages. */
const PAGE_MESSAGE_LIMIT = 100;

/**
 * The first whole groups of `rows`, until there are `target` rows. `rows` holds up to `cap + 1`
 * rows, so a group that reaches the end may be cut. A group that does not fit waits for the next
 * page, unless it is the first: a turn larger than `cap` is split rather than never shown.
 */
function wholeGroups(rows: readonly DynamicRecord[], target: number, cap: number): DynamicRecord[] {
  const taken: DynamicRecord[] = [];
  let start = 0;
  while (start < rows.length && taken.length < target) {
    const groupId = requiredStringColumn(rows[start] ?? {}, "group_id");
    let end = start + 1;
    while (end < rows.length && requiredStringColumn(rows[end] ?? {}, "group_id") === groupId) end += 1;
    if (end > cap) {
      if (taken.length === 0) taken.push(...rows.slice(0, cap));
      break;
    }
    taken.push(...rows.slice(start, end));
    start = end;
  }
  return taken;
}

interface ConversationPageCursor {
  version: 2;
  groupStart: string;
  groupFirst: number;
  groupId: string;
  turnRank: number;
  createdAt: string;
  ordinal: number;
  messageId: string;
}

type ConversationPageCursorV1 = Omit<
  ConversationPageCursor,
  "version" | "groupStart" | "groupFirst" | "groupId" | "turnRank"
> & {
  version: 1;
};

function pageLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error("The conversation page limit is invalid.");
  return Math.min(value, PAGE_MESSAGE_LIMIT);
}

function conversationRowCursor(row: DynamicRecord): ConversationPageCursor {
  return {
    version: 2,
    groupStart: requiredStringColumn(row, "group_start"),
    groupFirst: requiredNumberColumn(row, "group_first"),
    groupId: requiredStringColumn(row, "group_id"),
    turnRank: requiredNumberColumn(row, "turn_rank"),
    createdAt: requiredStringColumn(row, "created_at"),
    ordinal: requiredNumberColumn(row, "ordinal"),
    messageId: requiredStringColumn(row, "message_id"),
  };
}

function pageKeyValues(cursor: ConversationPageCursor): [string, number, string, number, string, number, string] {
  return [
    cursor.groupStart,
    cursor.groupFirst,
    cursor.groupId,
    cursor.turnRank,
    cursor.createdAt,
    cursor.ordinal,
    cursor.messageId,
  ];
}

function conversationMarkerSqlFilter(exclusions: ConversationMarkerExclusions): string {
  return [
    exclusions.excludeRoutineEvents
      ? `AND COALESCE(item_type, '') NOT LIKE '${SKILL_EVENT_ITEM_TYPE_PREFIX}%' AND COALESCE(item_type, '') NOT LIKE '${ROUTINE_EVENT_ITEM_TYPE_PREFIX}%' AND COALESCE(item_type, '') NOT LIKE '${MARKETPLACE_SUGGESTION_ITEM_TYPE_PREFIX}%'`
      : "",
    exclusions.excludeRoutineRunEvents
      ? `AND COALESCE(item_type, '') NOT LIKE '${ROUTINE_RUN_EVENT_ITEM_TYPE_PREFIX}%'`
      : "",
    exclusions.excludeHostedSiteEvents
      ? `AND COALESCE(item_type, '') NOT LIKE '${HOSTED_SITE_EVENT_ITEM_TYPE_PREFIX}%'`
      : "",
    exclusions.excludeRoutineQuietAnswers ? `AND COALESCE(item_type, '') != '${ROUTINE_QUIET_ANSWER_ITEM_TYPE}'` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function encodePageCursor(cursor: ConversationPageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeConversationCursor(value: string): ConversationPageCursor | ConversationPageCursorV1 {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !isDynamicRecord(parsed) ||
      (parsed.version !== 1 && parsed.version !== 2) ||
      !isString(parsed.createdAt) ||
      !isNumber(parsed.ordinal) ||
      !Number.isInteger(parsed.ordinal) ||
      !isString(parsed.messageId)
    ) {
      throw new Error("invalid cursor");
    }
    const row = { createdAt: parsed.createdAt, ordinal: parsed.ordinal, messageId: parsed.messageId };
    if (parsed.version === 1) return { version: 1, ...row };
    if (
      !isString(parsed.groupStart) ||
      !isNumber(parsed.groupFirst) ||
      !Number.isInteger(parsed.groupFirst) ||
      !isString(parsed.groupId) ||
      !isNumber(parsed.turnRank) ||
      !Number.isInteger(parsed.turnRank)
    ) {
      throw new Error("invalid cursor");
    }
    return {
      version: 2,
      groupStart: parsed.groupStart,
      groupFirst: parsed.groupFirst,
      groupId: parsed.groupId,
      turnRank: parsed.turnRank,
      ...row,
    };
  } catch {
    throw new Error("The conversation page cursor is invalid.");
  }
}

function encodeSearchCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ version: 1, offset }), "utf8").toString("base64url");
}

function decodeSearchCursor(value: string): number {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !isDynamicRecord(parsed) ||
      parsed.version !== 1 ||
      !isNumber(parsed.offset) ||
      !Number.isSafeInteger(parsed.offset) ||
      parsed.offset < 0
    ) {
      throw new Error("invalid cursor");
    }
    return parsed.offset;
  } catch {
    throw new Error("The conversation search cursor is invalid.");
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
