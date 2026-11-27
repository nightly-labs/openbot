import { randomUUID } from "node:crypto";
import {
  itemTypeCountsAsUnread,
  READ_EXCLUDED_ITEM_TYPE_PREFIXES,
  READ_EXCLUDED_ITEM_TYPES,
} from "@openbot/contracts/conversation-read";
import type { AgentSummary, ConversationReadState, ConversationSnapshot } from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import {
  type ConversationMarkerExclusions,
  ORDER_KEY_COLUMNS,
  ORDER_KEY_DESC,
  ORDERED_THREAD_MESSAGES,
} from "./database/conversation-queries";
import { cachedStatement } from "./database/statement-cache";
import type { OpenBotDatabase } from "./openbot-database";

export type { ConversationMarkerExclusions } from "./database/conversation-queries";

const UNREAD_FILTER = [
  "author != 'user'",
  ...READ_EXCLUDED_ITEM_TYPES.map((itemType) => `COALESCE(item_type, '') != '${itemType}'`),
  ...READ_EXCLUDED_ITEM_TYPE_PREFIXES.map((prefix) => `COALESCE(item_type, '') NOT LIKE '${prefix}%'`),
].join(" AND ");

export class ConversationReadStore {
  constructor(readonly database: OpenBotDatabase) {}

  listStates(
    memberId: string,
    agents: AgentSummary[],
    options: ConversationMarkerExclusions = {},
  ): Record<string, ConversationReadState> {
    return Object.fromEntries(
      agents.map((agent) => [agent.id, this.readStateForThread(memberId, agent.threadId, options)]),
    );
  }

  readStateForThread(
    memberId: string,
    threadId: string | null,
    options: ConversationMarkerExclusions = {},
  ): ConversationReadState {
    if (!threadId) return emptyReadState();
    const stored = this.#storedCursor(threadId, memberId);
    let state: ConversationReadState;
    if (stored === undefined) {
      const baseline = this.#migrationCursor(threadId);
      const initialCursor =
        baseline && !this.#messageExists(threadId, baseline) ? this.#latestMessageId(threadId) : baseline;
      this.#saveCursor(threadId, memberId, initialCursor, "initialized");
      state = this.#stateFromDatabase(threadId, initialCursor);
    } else if (stored !== null && !this.#messageExists(threadId, stored)) {
      const latestMessageId = this.#latestMessageId(threadId);
      this.#saveCursor(threadId, memberId, latestMessageId, "initialized");
      state = this.#stateFromDatabase(threadId, latestMessageId);
    } else {
      state = this.#stateFromDatabase(threadId, stored);
    }
    return this.#withSupportedCursor(threadId, state, options);
  }

  adoptMemberState(sourceMemberId: string, targetMemberId: string): void {
    if (sourceMemberId === targetMemberId) return;
    const rows = this.database.connection
      .prepare(
        `SELECT thread_id, through_message_id FROM projection_thread_reads
         WHERE member_id = ?`,
      )
      .all(sourceMemberId);
    if (!Array.isArray(rows)) throw new Error("The conversation read states are malformed.");
    for (const value of rows) {
      if (!isDynamicRecord(value) || !isString(value.thread_id)) {
        throw new Error("The conversation read state is malformed.");
      }
      const cursor = value.through_message_id;
      if (cursor !== null && !isString(cursor)) {
        throw new Error("The conversation read cursor is malformed.");
      }
      if (this.#storedCursor(value.thread_id, targetMemberId) === undefined) {
        this.#saveCursor(value.thread_id, targetMemberId, cursor, "initialized");
      }
    }
  }

  readState(memberId: string, snapshot: ConversationSnapshot): ConversationReadState {
    if (!snapshot.threadId) return emptyReadState();
    const stored = this.#storedCursor(snapshot.threadId, memberId);
    if (stored === undefined) {
      const baseline = this.#migrationCursor(snapshot.threadId);
      const initialCursor =
        baseline && !snapshot.messages.some((message) => message.id === baseline)
          ? (snapshot.messages.at(-1)?.id ?? null)
          : baseline;
      return this.#initialize(memberId, snapshot, initialCursor);
    }
    if (stored !== null && !snapshot.messages.some((message) => message.id === stored)) {
      return this.#initialize(memberId, snapshot, snapshot.messages.at(-1)?.id ?? null);
    }
    return stateFromSnapshot(snapshot, stored);
  }

  markRead(
    memberId: string,
    snapshot: ConversationSnapshot,
    throughMessageId: string | null,
    options: ConversationMarkerExclusions = {},
  ): ConversationReadState {
    if (!snapshot.threadId) return emptyReadState();
    const requestedIndex = throughMessageId
      ? snapshot.messages.findIndex((message) => message.id === throughMessageId)
      : -1;
    if (throughMessageId && requestedIndex < 0) {
      throw new Error(sourceText("error.backend.readBoundaryUnavailable"));
    }
    const stored = this.#storedCursor(snapshot.threadId, memberId);
    const storedIndex = stored ? snapshot.messages.findIndex((message) => message.id === stored) : -1;
    const nextThroughMessageId = storedIndex > requestedIndex ? (stored ?? null) : (throughMessageId ?? null);
    this.#saveCursor(snapshot.threadId, memberId, nextThroughMessageId, "marked");
    return this.#withSupportedCursor(snapshot.threadId, stateFromSnapshot(snapshot, nextThroughMessageId), options);
  }

  markReadForThread(
    memberId: string,
    threadId: string | null,
    throughMessageId: string | null,
    options: ConversationMarkerExclusions = {},
  ): ConversationReadState {
    if (!threadId) return emptyReadState();
    const requestedKey = throughMessageId ? this.#messageOrderKey(threadId, throughMessageId) : undefined;
    if (throughMessageId && !requestedKey) return this.readStateForThread(memberId, threadId, options);
    const stored = this.#storedCursor(threadId, memberId);
    let nextThroughMessageId = throughMessageId;
    if (stored && (!throughMessageId || this.#isAfter(threadId, stored, requestedKey))) {
      nextThroughMessageId = stored;
    }
    this.#saveCursor(threadId, memberId, nextThroughMessageId, "marked");
    return this.#withSupportedCursor(threadId, this.#stateFromDatabase(threadId, nextThroughMessageId), options);
  }

  markUnread(memberId: string, snapshot: ConversationSnapshot): ConversationReadState {
    if (!snapshot.threadId) return emptyReadState();
    this.#saveCursor(snapshot.threadId, memberId, null, "marked");
    return stateFromSnapshot(snapshot, null);
  }

  markUnreadForThread(
    memberId: string,
    threadId: string | null,
    fromMessageId: string | null = null,
    options: ConversationMarkerExclusions = {},
  ): ConversationReadState {
    if (!threadId) return emptyReadState();
    const fromKey = fromMessageId ? this.#messageOrderKey(threadId, fromMessageId) : undefined;
    if (fromMessageId && !fromKey) throw new Error(sourceText("error.backend.readBoundaryUnavailable"));
    const throughMessageId = fromKey ? this.#messageBefore(threadId, fromKey) : null;
    this.#saveCursor(threadId, memberId, throughMessageId, "marked");
    return this.#withSupportedCursor(threadId, this.#stateFromDatabase(threadId, throughMessageId), options);
  }

  #withSupportedCursor(
    threadId: string,
    state: ConversationReadState,
    options: ConversationMarkerExclusions,
  ): ConversationReadState {
    return {
      ...state,
      throughMessageId: this.database.supportedConversationCursor(threadId, state.throughMessageId, options),
    };
  }

  #storedCursor(threadId: string, memberId: string): string | null | undefined {
    const row = cachedStatement(
      this.database.connection,
      `SELECT through_message_id FROM projection_thread_reads
       WHERE thread_id = ? AND member_id = ?`,
    ).get(threadId, memberId);
    if (row === undefined) return undefined;
    if (!isDynamicRecord(row)) {
      throw new Error("The stored conversation read state is malformed.");
    }
    const value = row.through_message_id;
    if (value === null || isString(value)) return value;
    throw new Error("The stored conversation read cursor is malformed.");
  }

  #messageExists(threadId: string, messageId: string): boolean {
    return Boolean(
      this.database.connection
        .prepare(
          `SELECT 1 FROM projection_thread_messages
           WHERE thread_id = ? AND message_id = ? LIMIT 1`,
        )
        .get(threadId, messageId),
    );
  }

  #messageOrderKey(threadId: string, messageId: string): MessageOrderKey | undefined {
    const row = this.database.connection
      .prepare(
        `${ORDERED_THREAD_MESSAGES}
         SELECT ${ORDER_KEY_COLUMNS} FROM ordered WHERE message_id = ?`,
      )
      .get(threadId, messageId);
    if (row === undefined) return undefined;
    if (
      !isDynamicRecord(row) ||
      !isString(row.group_start) ||
      !isNumber(row.group_first) ||
      !isString(row.group_id) ||
      !isNumber(row.turn_rank) ||
      !isString(row.created_at) ||
      !isNumber(row.ordinal) ||
      !isString(row.message_id)
    ) {
      throw new Error("The conversation message order is malformed.");
    }
    return [row.group_start, row.group_first, row.group_id, row.turn_rank, row.created_at, row.ordinal, row.message_id];
  }

  #isAfter(threadId: string, candidateMessageId: string, boundary: MessageOrderKey | undefined): boolean {
    if (!boundary) return false;
    return Boolean(
      this.database.connection
        .prepare(
          `${ORDERED_THREAD_MESSAGES}
           SELECT 1 FROM ordered
           WHERE message_id = ? AND (${ORDER_KEY_COLUMNS}) > (?, ?, ?, ?, ?, ?, ?)`,
        )
        .get(threadId, candidateMessageId, ...boundary),
    );
  }

  #messageBefore(threadId: string, boundary: MessageOrderKey): string | null {
    const row = this.database.connection
      .prepare(
        `${ORDERED_THREAD_MESSAGES}
         SELECT message_id FROM ordered
         WHERE (${ORDER_KEY_COLUMNS}) < (?, ?, ?, ?, ?, ?, ?)
         ORDER BY ${ORDER_KEY_DESC} LIMIT 1`,
      )
      .get(threadId, ...boundary);
    if (row === undefined) return null;
    if (!isDynamicRecord(row) || !isString(row.message_id)) {
      throw new Error("The previous conversation message is malformed.");
    }
    return row.message_id;
  }

  #latestMessageId(threadId: string): string | null {
    const row = this.database.connection
      .prepare(
        `${ORDERED_THREAD_MESSAGES}
         SELECT message_id FROM ordered ORDER BY ${ORDER_KEY_DESC} LIMIT 1`,
      )
      .get(threadId);
    if (row === undefined) return null;
    if (!isDynamicRecord(row) || !isString(row.message_id)) {
      throw new Error("The latest conversation message is malformed.");
    }
    return row.message_id;
  }

  #stateFromDatabase(threadId: string, throughMessageId: string | null): ConversationReadState {
    const boundaryKey = throughMessageId ? this.#messageOrderKey(threadId, throughMessageId) : undefined;
    const afterBoundary = boundaryKey ? `AND (${ORDER_KEY_COLUMNS}) > (?, ?, ?, ?, ?, ?, ?)` : "";
    const parameters = boundaryKey ? [threadId, ...boundaryKey] : [threadId];
    const firstRow = this.database.connection
      .prepare(
        `${ORDERED_THREAD_MESSAGES}
         SELECT message_id, COUNT(*) OVER () AS unread_count FROM ordered
         WHERE 1 = 1 ${afterBoundary} AND ${UNREAD_FILTER}
         ORDER BY ${ORDER_KEY_COLUMNS} LIMIT 1`,
      )
      .get(...parameters);
    if (firstRow === undefined) return { unreadCount: 0, firstUnreadMessageId: null, throughMessageId };
    if (!isDynamicRecord(firstRow) || !isString(firstRow.message_id) || !isNumber(firstRow.unread_count)) {
      throw new Error("The conversation unread count is malformed.");
    }
    return {
      unreadCount: firstRow.unread_count,
      firstUnreadMessageId: firstRow.message_id,
      throughMessageId,
    };
  }

  #migrationCursor(threadId: string): string | null {
    const row = this.database.connection
      .prepare(
        `SELECT through_message_id FROM projection_thread_read_baselines
         WHERE thread_id = ?`,
      )
      .get(threadId);
    if (row === undefined) return null;
    if (!isDynamicRecord(row)) {
      throw new Error("The conversation read baseline is malformed.");
    }
    const value = row.through_message_id;
    if (value === null || isString(value)) return value;
    throw new Error("The conversation read baseline cursor is malformed.");
  }

  #initialize(
    memberId: string,
    snapshot: ConversationSnapshot,
    throughMessageId: string | null,
  ): ConversationReadState {
    if (!snapshot.threadId) return emptyReadState();
    this.#saveCursor(snapshot.threadId, memberId, throughMessageId, "initialized");
    return stateFromSnapshot(snapshot, throughMessageId);
  }

  #saveCursor(
    threadId: string,
    memberId: string,
    throughMessageId: string | null,
    event: "initialized" | "marked",
  ): void {
    if (this.#storedCursor(threadId, memberId) === throughMessageId) return;
    const updatedAt = new Date().toISOString();
    this.database.dispatch(
      `thread-read:${event}:${threadId}:${memberId}:${randomUUID()}`,
      [
        {
          aggregateType: "thread-read",
          aggregateId: `${threadId}:${memberId}`,
          eventType: `thread-read.${event}`,
          payload: { threadId, memberId, throughMessageId },
          occurredAt: updatedAt,
        },
      ],
      (db) => {
        db.prepare(
          `INSERT INTO projection_thread_reads (
             thread_id, member_id, through_message_id, updated_at
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT(thread_id, member_id) DO UPDATE SET
             through_message_id = excluded.through_message_id,
             updated_at = excluded.updated_at`,
        ).run(threadId, memberId, throughMessageId, updatedAt);
        return null;
      },
    );
  }
}

function stateFromSnapshot(snapshot: ConversationSnapshot, throughMessageId: string | null): ConversationReadState {
  const throughIndex = throughMessageId
    ? snapshot.messages.findIndex((message) => message.id === throughMessageId)
    : -1;
  const unread = snapshot.messages
    .slice(throughIndex + 1)
    .filter((message) => message.author !== "user" && itemTypeCountsAsUnread(message.itemType));
  return {
    unreadCount: unread.length,
    firstUnreadMessageId: unread[0]?.id ?? null,
    throughMessageId,
  };
}

type MessageOrderKey = [
  groupStart: string,
  groupFirst: number,
  groupId: string,
  turnRank: number,
  createdAt: string,
  ordinal: number,
  messageId: string,
];

function emptyReadState(): ConversationReadState {
  return { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null };
}
