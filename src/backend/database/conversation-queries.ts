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
  SentMessageStats,
} from "@openbot/contracts/ipc";
import {
  AGENT_WELCOME_ITEM_TYPE,
  CHANNEL_RESUME_ITEM_TYPE,
  HOSTED_SITE_EVENT_ITEM_TYPE_PREFIX,
  isAttachmentSummary,
  MARKETPLACE_SUGGESTION_ITEM_TYPE_PREFIX,
  ROUTINE_EVENT_ITEM_TYPE_PREFIX,
  ROUTINE_QUIET_ANSWER_ITEM_TYPE,
  ROUTINE_RUN_EVENT_ITEM_TYPE_PREFIX,
  SETTING_LINK_ITEM_TYPE_PREFIX,
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

export interface ConversationMarkerExclusions {
  excludeRoutineEvents?: boolean;
  excludeRoutineRunEvents?: boolean;
  excludeHostedSiteEvents?: boolean;
  excludeRoutineQuietAnswers?: boolean;
  excludeSettingLinks?: boolean;
}

const CHANNEL_THREAD_EXCLUSION = "AND message.thread_id NOT IN (SELECT thread_id FROM projection_channel_contexts)";
const SIDE_THREAD_EXCLUSION = `${CHANNEL_THREAD_EXCLUSION}
             AND message.thread_id NOT IN (SELECT thread_id FROM projection_agent_threads)`;
const ARCHIVED_SIDE_THREAD_EXCLUSION = `${CHANNEL_THREAD_EXCLUSION}
             AND message.thread_id NOT IN (SELECT thread_id FROM projection_agent_threads WHERE archived_at IS NOT NULL)`;

export class ConversationQueries {
  readonly #core: DatabaseCore;
  readonly #latestReplies = new Map<
    string,
    { agentId: string; revision: number; message: ConversationMessage | null }
  >();

  constructor(options: ConversationQueriesOptions) {
    this.#core = options.core;
  }

  readConversation(agentId: string, threadId: string | null): ConversationSnapshot {
    if (!threadId) return { agentId, threadId: null, activeTurnId: null, revision: 0, messages: [] };
    return this.#snapshot(agentId, threadId, () =>
      databaseRows(
        this.#core.connection
          .prepare(
            `SELECT message_json FROM projection_thread_messages
               WHERE thread_id = ? ORDER BY created_at, ordinal, message_id`,
          )
          .all(threadId),
      ),
    );
  }

  readTurnConversation(agentId: string, threadId: string, turnId: string): ConversationSnapshot {
    return this.#snapshot(agentId, threadId, () =>
      databaseRows(
        this.#core.connection
          .prepare(
            `SELECT message_json FROM projection_thread_messages
               WHERE thread_id = ? AND turn_id = ? ORDER BY created_at, ordinal, message_id`,
          )
          .all(threadId, turnId),
      ),
    );
  }

  readLatestTurnId(turnIds: string[]): string | null {
    if (turnIds.length === 0) return null;
    const row = databaseRow(
      this.#core.connection
        .prepare(
          `SELECT turn_id FROM projection_turns
           WHERE turn_id IN (SELECT value FROM json_each(?))
           ORDER BY started_at DESC, last_event_sequence DESC LIMIT 1`,
        )
        .get(JSON.stringify(turnIds)),
    );
    return row ? requiredStringColumn(row, "turn_id") : null;
  }

  #snapshot(agentId: string, threadId: string, readRows: () => DynamicRecord[]): ConversationSnapshot {
    const thread = decodeConversationThreadRow(
      this.#core.connection
        .prepare(
          `SELECT active_turn_id, last_event_sequence
           FROM projection_threads WHERE thread_id = ? AND agent_id = ?`,
        )
        .get(threadId, agentId),
    );
    return {
      agentId,
      threadId,
      activeTurnId: thread?.active_turn_id ?? null,
      revision: thread?.last_event_sequence ?? 0,
      messages: thread
        ? sortConversationMessages(readRows().map((row) => JSON.parse(requiredStringColumn(row, "message_json"))))
        : [],
    };
  }

  readTurnAssistantMessages(agentId: string, turnId: string): ConversationMessage[] {
    const rows = databaseRows(
      this.#core.connection
        .prepare(
          `SELECT message.message_json FROM projection_turns AS turn
           JOIN projection_threads AS thread ON thread.thread_id = turn.thread_id
           JOIN projection_thread_messages AS message INDEXED BY thread_messages_turn
             ON message.thread_id = turn.thread_id AND message.turn_id = turn.turn_id
           WHERE turn.turn_id = ? AND thread.agent_id = ? AND message.author = 'assistant'
           ORDER BY message.created_at, message.ordinal, message.message_id`,
        )
        .all(turnId, agentId),
    );
    return rows.map((row) => JSON.parse(requiredStringColumn(row, "message_json")));
  }

  readActiveTurnId(agentId: string, threadId: string | null): string | null {
    if (!threadId) return null;
    const row = databaseRow(
      this.#core.connection
        .prepare("SELECT active_turn_id FROM projection_threads WHERE thread_id = ? AND agent_id = ?")
        .get(threadId, agentId),
    );
    return row ? optionalStringColumn(row, "active_turn_id") : null;
  }

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

  readSentMessageStats(): SentMessageStats {
    const row = databaseRow(
      this.#core.connection
        .prepare(
          "SELECT MIN(created_at) AS first_sent_at, COUNT(*) AS sent_count FROM projection_thread_messages WHERE author = 'user' AND item_type IS NOT 'routine'",
        )
        .get(),
    );
    if (!row) return { firstSentAt: null, sentCount: 0 };
    return {
      firstSentAt: optionalStringColumn(row, "first_sent_at"),
      sentCount: requiredNumberColumn(row, "sent_count"),
    };
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
    const thread = databaseRow(
      this.#core
        .statement(
          "SELECT active_turn_id, last_event_sequence FROM projection_threads WHERE thread_id = ? AND agent_id = ?",
        )
        .get(threadId, agentId),
    );
    if (!thread) {
      this.#latestReplies.delete(threadId);
      return { activeTurnId: null, latestMessage: null };
    }
    const activeTurnId = optionalStringColumn(thread, "active_turn_id");
    const revision = requiredNumberColumn(thread, "last_event_sequence");
    const cached = !this.#core.connection.isTransaction;
    const known = cached ? this.#latestReplies.get(threadId) : undefined;
    if (known?.agentId === agentId && known.revision === revision) {
      return { activeTurnId, latestMessage: known.message };
    }
    const row = databaseRow(
      this.#core.connection
        .prepare(
          `SELECT message.message_json AS latest_message_json
                   FROM projection_thread_messages message
                   WHERE message.thread_id = ?
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
                   LIMIT 1`,
        )
        .get(threadId),
    );
    const latestJson = row ? optionalStringColumn(row, "latest_message_json") : null;
    const latestMessage = latestJson ? decodeConversationMessageJson(latestJson) : null;
    if (cached) this.#latestReplies.set(threadId, { agentId, revision, message: latestMessage });
    return { activeTurnId, latestMessage };
  }

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
           AND EXISTS (SELECT 1 FROM projection_threads AS owner WHERE owner.thread_id = projection_thread_messages.thread_id AND owner.agent_id = ?)
           ORDER BY created_at, ordinal, message_id`,
        )
        .all(threadId, ...messageIds, agentId),
    ).map((row) => decodeConversationMessageJson(requiredStringColumn(row, "message_json")));
  }

  readConversationMessagesOfItemType(agentId: string, threadId: string, itemType: string): ConversationMessage[] {
    return databaseRows(
      this.#core.connection
        .prepare(
          `SELECT message_json FROM projection_thread_messages
           WHERE thread_id = ? AND item_type = ?
           AND EXISTS (SELECT 1 FROM projection_threads AS owner WHERE owner.thread_id = projection_thread_messages.thread_id AND owner.agent_id = ?)
           ORDER BY created_at, ordinal, message_id`,
        )
        .all(threadId, itemType, agentId),
    ).map((row) => decodeConversationMessageJson(requiredStringColumn(row, "message_json")));
  }

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
             AND EXISTS (SELECT 1 FROM projection_threads AS owner WHERE owner.thread_id = projection_thread_messages.thread_id AND owner.agent_id = ?)
             AND (
               (? IS NOT NULL AND turn_id = ? AND status = 'streaming')
               OR json_type(message_json, '$.questionPrompt.resolution') = 'null'
                  AND json_type(message_json, '$.questionPrompt') = 'object'
               OR json_extract(message_json, '$.nearPayment.state') = 'sending'
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
    const emptyPage = {
      agentId,
      threadId,
      activeTurnId: null,
      revision: 0,
      messages: [],
      references: {},
      pageInfo: { hasOlder: false, olderCursor: null },
    };
    if (!threadId) return emptyPage;
    const limit = pageLimit(requestedLimit);
    const thread = decodeConversationThreadRow(
      this.#core.connection
        .prepare(
          `SELECT active_turn_id, last_event_sequence
           FROM projection_threads WHERE thread_id = ? AND agent_id = ?`,
        )
        .get(threadId, agentId),
    );
    if (!thread) return emptyPage;
    const rows = this.#conversationPageRows(threadId, anchor, limit, options);
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

  conversationCursorAt(threadId: string, messageId: string): string | null {
    const row = this.#messageOrderRow(threadId, messageId);
    return row ? encodePageCursor(conversationRowCursor(row)) : null;
  }

  conversationCountBefore(threadId: string, messageId: string, options: ConversationMarkerExclusions = {}): number {
    const row = this.#messageOrderRow(threadId, messageId);
    return row ? this.#conversationRowsBefore(threadId, conversationRowCursor(row), options).count : 0;
  }

  conversationHasAfter(threadId: string, messageId: string, options: ConversationMarkerExclusions = {}): boolean {
    const row = this.#messageOrderRow(threadId, messageId);
    if (!row) return false;
    const next = databaseRow(
      this.#core.connection
        .prepare(
          `${ORDERED_THREAD_MESSAGES}
           SELECT 1 AS found FROM ordered
           WHERE (${ORDER_KEY_COLUMNS}) > (?, ?, ?, ?, ?, ?, ?)
           ${conversationMarkerSqlFilter(options)}
           LIMIT 1`,
        )
        .get(threadId, ...pageKeyValues(conversationRowCursor(row))),
    );
    return next !== null;
  }

  #messageOrderRow(threadId: string, messageId: string): DynamicRecord | null {
    return databaseRow(
      this.#core.connection
        .prepare(
          `${ORDERED_THREAD_MESSAGES}
           SELECT ${ORDER_KEY_COLUMNS} FROM ordered WHERE message_id = ?`,
        )
        .get(threadId, messageId),
    );
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
    const longestTerm = terms.reduce((longest, term) => (term.length > longest.length ? term : longest));
    const textFilter =
      terms.length > 1
        ? `${textMatch} AND LOWER(${COLLAPSE_WHITESPACE_FUNCTION}(${storedText})) LIKE ? ESCAPE '\\'`
        : textMatch;
    const textParameters = terms.length > 1 ? [`%${escapeLike(longestTerm)}%`, pattern] : [pattern];
    const filter = agentId ? "AND thread.agent_id = ?" : "";
    const parameters = agentId ? [...textParameters, agentId] : textParameters;
    const rows = databaseRows(
      this.#core.connection
        .prepare(
          `WITH matches AS MATERIALIZED (
             SELECT message.rowid AS message_rowid, thread.agent_id, message.created_at, message.ordinal, message.message_id
             FROM projection_thread_messages message
             JOIN projection_threads thread ON thread.thread_id = message.thread_id
             WHERE ${textFilter}
               AND COALESCE(json_extract(message.message_json, '$.delivery.status'), '') NOT IN ('queued', 'cancelled')
               AND COALESCE(message.item_type, '') NOT IN ('commentary', '${ROUTINE_QUIET_ANSWER_ITEM_TYPE}', '${AGENT_WELCOME_ITEM_TYPE}', '${CHANNEL_RESUME_ITEM_TYPE}')
               AND COALESCE(message.item_type, '') NOT LIKE '${SKILL_EVENT_ITEM_TYPE_PREFIX}%' AND COALESCE(message.item_type, '') NOT LIKE '${ROUTINE_EVENT_ITEM_TYPE_PREFIX}%'
               AND COALESCE(message.item_type, '') NOT LIKE '${ROUTINE_RUN_EVENT_ITEM_TYPE_PREFIX}%'
               AND COALESCE(message.item_type, '') NOT LIKE '${HOSTED_SITE_EVENT_ITEM_TYPE_PREFIX}%'
               AND COALESCE(message.item_type, '') NOT LIKE '${MARKETPLACE_SUGGESTION_ITEM_TYPE_PREFIX}%'
               AND COALESCE(message.item_type, '') NOT LIKE '${SETTING_LINK_ITEM_TYPE_PREFIX}%'
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

  #conversationRowsBefore(
    threadId: string,
    cursor: ConversationPageCursor,
    exclusions: ConversationMarkerExclusions,
  ): { count: number; oldestAt: string | null } {
    const routineFilter = conversationMarkerSqlFilter(exclusions);
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

export const ORDERED_THREAD_MESSAGES = `WITH ordered AS (
  SELECT created_at, ordinal, message_id, author, item_type, group_start, group_first, group_id, turn_rank
  FROM projection_thread_messages WHERE thread_id = ?
)`;
export const ORDER_KEY_COLUMNS = "group_start, group_first, group_id, turn_rank, created_at, ordinal, message_id";
export const ORDER_KEY_DESC =
  "group_start DESC, group_first DESC, group_id DESC, turn_rank DESC, created_at DESC, ordinal DESC, message_id DESC";

const PAGE_MESSAGE_LIMIT = 100;

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

export function conversationMarkerSqlFilter(exclusions: ConversationMarkerExclusions): string {
  return [
    `AND COALESCE(item_type, '') NOT IN ('${AGENT_WELCOME_ITEM_TYPE}', '${CHANNEL_RESUME_ITEM_TYPE}')`,
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
    exclusions.excludeSettingLinks ? `AND COALESCE(item_type, '') NOT LIKE '${SETTING_LINK_ITEM_TYPE_PREFIX}%'` : "",
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
