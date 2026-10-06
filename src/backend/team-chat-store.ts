import { createHash } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  DirectConversationPage,
  DirectConversationPageAnchor,
  DirectConversationReadState,
  DirectConversationSnapshot,
  DirectMessage,
  DirectThreadSummary,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import {
  databaseRow,
  databaseRows,
  optionalNumberColumn,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "./database/database-rows";
import type { OpenBotDatabase } from "./openbot-database";

export class TeamChatStore {
  constructor(readonly database: OpenBotDatabase) {}

  listThreads(memberId: string): DirectThreadSummary[] {
    const rows = databaseRows(
      this.database.connection
        .prepare(
          `SELECT
             thread.thread_id,
             thread.member_a_id,
             thread.member_b_id,
             thread.updated_at,
             message.message_json,
             (
               SELECT COUNT(*)
               FROM projection_direct_messages unread
               WHERE unread.thread_id = thread.thread_id
                 AND unread.sender_member_id != ?
                 AND unread.last_event_sequence > COALESCE(read_state.last_read_sequence, 0)
             ) AS unread_count
           FROM projection_direct_threads thread
           JOIN projection_direct_messages message
             ON message.message_id = thread.last_message_id
           LEFT JOIN projection_direct_reads read_state
             ON read_state.thread_id = thread.thread_id AND read_state.member_id = ?
           WHERE thread.member_a_id = ? OR thread.member_b_id = ?
           ORDER BY thread.updated_at DESC, thread.last_event_sequence DESC`,
        )
        .all(memberId, memberId, memberId, memberId),
    );
    return rows.map((row) => ({
      threadId: requiredStringColumn(row, "thread_id"),
      otherMemberId:
        requiredStringColumn(row, "member_a_id") === memberId
          ? requiredStringColumn(row, "member_b_id")
          : requiredStringColumn(row, "member_a_id"),
      lastMessage: JSON.parse(requiredStringColumn(row, "message_json")),
      unreadCount: requiredNumberColumn(row, "unread_count"),
      updatedAt: requiredStringColumn(row, "updated_at"),
    }));
  }

  readConversation(memberId: string, otherMemberId: string): DirectConversationSnapshot {
    const threadId = directThreadId(memberId, otherMemberId);
    const thread = databaseRow(
      this.database.connection
        .prepare(
          `SELECT last_event_sequence
           FROM projection_direct_threads
           WHERE thread_id = ? AND (member_a_id = ? OR member_b_id = ?)`,
        )
        .get(threadId, memberId, memberId),
    );
    const rows = databaseRows(
      this.database.connection
        .prepare(
          `SELECT message_json FROM projection_direct_messages
           WHERE thread_id = ? ORDER BY last_event_sequence, message_id`,
        )
        .all(threadId),
    );
    const messages = rows.map((row) => decodeDirectMessage(JSON.parse(requiredStringColumn(row, "message_json"))));
    return {
      threadId,
      otherMemberId,
      messages,
      revision: thread ? requiredNumberColumn(thread, "last_event_sequence") : 0,
      readState: this.#readState(memberId, threadId, messages),
    };
  }

  readConversationPage(
    memberId: string,
    otherMemberId: string,
    anchor: DirectConversationPageAnchor = { type: "latest" },
    requestedLimit = 50,
  ): DirectConversationPage {
    const limit = directPageLimit(requestedLimit);
    const threadId = directThreadId(memberId, otherMemberId);
    const thread = databaseRow(
      this.database.connection
        .prepare(
          `SELECT last_event_sequence FROM projection_direct_threads
           WHERE thread_id = ? AND (member_a_id = ? OR member_b_id = ?)`,
        )
        .get(threadId, memberId, memberId),
    );
    let rows: DynamicRecord[];
    if (anchor.type === "latest") {
      rows = databaseRows(
        this.database.connection
          .prepare(
            `SELECT message_json, last_event_sequence FROM projection_direct_messages
             WHERE thread_id = ? ORDER BY last_event_sequence DESC, message_id DESC LIMIT ?`,
          )
          .all(threadId, limit),
      ).reverse();
    } else if (anchor.type === "before") {
      const sequence = decodeDirectCursor(anchor.cursor);
      rows = databaseRows(
        this.database.connection
          .prepare(
            `SELECT message_json, last_event_sequence FROM projection_direct_messages
             WHERE thread_id = ? AND last_event_sequence < ?
             ORDER BY last_event_sequence DESC, message_id DESC LIMIT ?`,
          )
          .all(threadId, sequence, limit),
      ).reverse();
    } else {
      const anchorRow = databaseRow(
        this.database.connection
          .prepare(
            `SELECT last_event_sequence FROM projection_direct_messages
             WHERE thread_id = ? AND message_id = ?`,
          )
          .get(threadId, anchor.messageId),
      );
      if (!anchorRow) rows = [];
      else {
        const sequence = requiredNumberColumn(anchorRow, "last_event_sequence");
        const olderLimit = Math.floor(limit / 2) + 1;
        const older = databaseRows(
          this.database.connection
            .prepare(
              `SELECT message_json, last_event_sequence FROM projection_direct_messages
               WHERE thread_id = ? AND last_event_sequence <= ?
               ORDER BY last_event_sequence DESC, message_id DESC LIMIT ?`,
            )
            .all(threadId, sequence, olderLimit),
        ).reverse();
        const newer = databaseRows(
          this.database.connection
            .prepare(
              `SELECT message_json, last_event_sequence FROM projection_direct_messages
               WHERE thread_id = ? AND last_event_sequence > ?
               ORDER BY last_event_sequence, message_id LIMIT ?`,
            )
            .all(threadId, sequence, Math.max(0, limit - older.length)),
        );
        rows = [...older, ...newer];
      }
    }
    const messages = rows.map((row) => decodeDirectMessage(JSON.parse(requiredStringColumn(row, "message_json"))));
    const firstSequence = rows[0] ? requiredNumberColumn(rows[0], "last_event_sequence") : 0;
    // How much is older than the page, and since when: the day rail draws the unloaded part from it.
    const older =
      firstSequence > 0
        ? databaseRow(
            this.database.connection
              .prepare(
                `SELECT COUNT(*) AS older_count, MIN(created_at) AS oldest_at FROM projection_direct_messages
                 WHERE thread_id = ? AND last_event_sequence < ?`,
              )
              .get(threadId, firstSequence),
          )
        : undefined;
    const olderCount = older ? requiredNumberColumn(older, "older_count") : 0;
    const oldestAt = older ? optionalStringColumn(older, "oldest_at") : null;
    const hasOlder = olderCount > 0;
    return {
      threadId,
      otherMemberId,
      messages,
      revision: thread ? requiredNumberColumn(thread, "last_event_sequence") : 0,
      pageInfo: {
        hasOlder,
        olderCursor: hasOlder ? encodeDirectCursor(firstSequence) : null,
        ...(hasOlder ? { olderCount } : {}),
        ...(oldestAt ? { oldestAt } : {}),
      },
      readState: this.#readStateFromDatabase(memberId, threadId),
    };
  }

  sendMessage(input: {
    clientMessageId: string;
    senderMemberId: string;
    recipientMemberId: string;
    text: string;
    createdAt?: string;
  }): DirectMessage {
    const text = input.text.trim();
    if (!text) throw new Error(sourceText("error.backend.directMessageRequired"));
    if (text.length > INPUT_LIMITS.directMessageText) {
      throw new Error(sourceText("error.backend.directMessageTooLong", { limit: INPUT_LIMITS.directMessageText }));
    }
    if (input.senderMemberId === input.recipientMemberId) {
      throw new Error(sourceText("error.backend.directMessageSelf"));
    }
    const memberIds = sortedMemberIds(input.senderMemberId, input.recipientMemberId);
    const threadId = directThreadId(memberIds[0], memberIds[1]);
    const message: DirectMessage = {
      id: input.clientMessageId,
      threadId,
      senderMemberId: input.senderMemberId,
      recipientMemberId: input.recipientMemberId,
      text,
      createdAt: input.createdAt ?? new Date().toISOString(),
      sequence: 0,
    };
    return this.database.dispatch(
      `direct-message:${message.senderMemberId}:${message.id}`,
      [
        {
          aggregateType: "direct-thread",
          aggregateId: threadId,
          eventType: "direct-message.sent",
          payload: message,
          occurredAt: message.createdAt,
        },
      ],
      (db, sequences) => {
        const sequence = sequences[0] ?? 0;
        const stored = { ...message, sequence };
        db.prepare(
          `INSERT INTO projection_direct_threads (
             thread_id, member_a_id, member_b_id, created_at, updated_at,
             last_message_id, last_event_sequence
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(thread_id) DO UPDATE SET
             updated_at = excluded.updated_at,
             last_message_id = excluded.last_message_id,
             last_event_sequence = excluded.last_event_sequence`,
        ).run(threadId, memberIds[0], memberIds[1], message.createdAt, message.createdAt, message.id, sequence);
        db.prepare(
          `INSERT INTO projection_direct_messages (
             message_id, thread_id, sender_member_id, recipient_member_id, text,
             created_at, message_json, last_event_sequence
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          stored.id,
          stored.threadId,
          stored.senderMemberId,
          stored.recipientMemberId,
          stored.text,
          stored.createdAt,
          JSON.stringify(stored),
          sequence,
        );
        return stored;
      },
    );
  }

  markRead(memberId: string, otherMemberId: string, throughSequence: number): DirectConversationReadState {
    const threadId = directThreadId(memberId, otherMemberId);
    const state = databaseRow(
      this.database.connection
        .prepare(
          `SELECT thread.last_event_sequence, read_state.last_read_sequence
           FROM projection_direct_threads thread
           LEFT JOIN projection_direct_reads read_state
             ON read_state.thread_id = thread.thread_id AND read_state.member_id = ?
           WHERE thread.thread_id = ? AND (thread.member_a_id = ? OR thread.member_b_id = ?)`,
        )
        .get(memberId, threadId, memberId, memberId),
    );
    if (!state) {
      return { unreadCount: 0, firstUnreadMessageId: null, throughSequence: 0 };
    }
    const lastEventSequence = requiredNumberColumn(state, "last_event_sequence");
    const lastReadSequence = optionalNumberColumn(state, "last_read_sequence");
    const nextSequence = Math.max(lastReadSequence ?? 0, Math.min(Math.max(0, throughSequence), lastEventSequence));
    if ((lastReadSequence ?? 0) >= nextSequence) {
      return this.#readStateFromDatabase(memberId, threadId);
    }
    const updatedAt = new Date().toISOString();
    this.database.dispatch(
      `direct-read:${threadId}:${memberId}:${nextSequence}`,
      [
        {
          aggregateType: "direct-thread",
          aggregateId: threadId,
          eventType: "direct-thread.read",
          payload: { memberId, throughSequence: nextSequence },
          occurredAt: updatedAt,
        },
      ],
      (db) => {
        db.prepare(
          `INSERT INTO projection_direct_reads (
             thread_id, member_id, last_read_sequence, updated_at
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT(thread_id, member_id) DO UPDATE SET
             last_read_sequence = MAX(last_read_sequence, excluded.last_read_sequence),
             updated_at = excluded.updated_at`,
        ).run(threadId, memberId, nextSequence, updatedAt);
        return null;
      },
    );
    return this.#readStateFromDatabase(memberId, threadId);
  }

  #readState(memberId: string, threadId: string, messages: DirectMessage[]): DirectConversationReadState {
    const row = databaseRow(
      this.database.connection
        .prepare(
          `SELECT last_read_sequence FROM projection_direct_reads
           WHERE thread_id = ? AND member_id = ?`,
        )
        .get(threadId, memberId),
    );
    const throughSequence = row ? requiredNumberColumn(row, "last_read_sequence") : 0;
    const unread = messages.filter(
      (message) => message.senderMemberId !== memberId && message.sequence > throughSequence,
    );
    return {
      unreadCount: unread.length,
      firstUnreadMessageId: unread[0]?.id ?? null,
      throughSequence,
    };
  }

  #readStateFromDatabase(memberId: string, threadId: string): DirectConversationReadState {
    const row = databaseRow(
      this.database.connection
        .prepare(
          `SELECT last_read_sequence FROM projection_direct_reads
           WHERE thread_id = ? AND member_id = ?`,
        )
        .get(threadId, memberId),
    );
    const throughSequence = row ? requiredNumberColumn(row, "last_read_sequence") : 0;
    const unreadCountRow = databaseRow(
      this.database.connection
        .prepare(
          `SELECT COUNT(*) AS unread_count
           FROM projection_direct_messages
           WHERE thread_id = ?
             AND sender_member_id != ?
             AND last_event_sequence > ?`,
        )
        .get(threadId, memberId, throughSequence),
    );
    const firstUnreadRow = databaseRow(
      this.database.connection
        .prepare(
          `SELECT message_id
           FROM projection_direct_messages
           WHERE thread_id = ?
             AND sender_member_id != ?
             AND last_event_sequence > ?
           ORDER BY last_event_sequence, message_id
           LIMIT 1`,
        )
        .get(threadId, memberId, throughSequence),
    );
    return {
      unreadCount: unreadCountRow ? requiredNumberColumn(unreadCountRow, "unread_count") : 0,
      firstUnreadMessageId: firstUnreadRow ? requiredStringColumn(firstUnreadRow, "message_id") : null,
      throughSequence,
    };
  }
}

export function directThreadId(leftMemberId: string, rightMemberId: string): string {
  const memberIds = sortedMemberIds(leftMemberId, rightMemberId);
  const digest = createHash("sha256").update(`${memberIds[0]}\0${memberIds[1]}`).digest("hex").slice(0, 32);
  return `dm-${digest}`;
}

function directPageLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error("The direct-message page limit is invalid.");
  return Math.min(value, 100);
}

function encodeDirectCursor(sequence: number): string {
  return Buffer.from(JSON.stringify({ version: 1, sequence }), "utf8").toString("base64url");
}

function decodeDirectCursor(value: string): number {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !isDynamicRecord(parsed) ||
      parsed.version !== 1 ||
      !isNumber(parsed.sequence) ||
      !Number.isSafeInteger(parsed.sequence) ||
      parsed.sequence < 0
    ) {
      throw new Error("invalid cursor");
    }
    return parsed.sequence;
  } catch {
    throw new Error("The direct-message page cursor is invalid.");
  }
}

function decodeDirectMessage(value: unknown): DirectMessage {
  if (
    !isDynamicRecord(value) ||
    !isString(value.id) ||
    !isString(value.threadId) ||
    !isString(value.senderMemberId) ||
    !isString(value.recipientMemberId) ||
    !isString(value.text) ||
    !isString(value.createdAt) ||
    !isNumber(value.sequence) ||
    !Number.isSafeInteger(value.sequence)
  ) {
    throw new Error("Invalid direct-message payload.");
  }
  return {
    id: value.id,
    threadId: value.threadId,
    senderMemberId: value.senderMemberId,
    recipientMemberId: value.recipientMemberId,
    text: value.text,
    createdAt: value.createdAt,
    sequence: value.sequence,
  };
}

function sortedMemberIds(leftMemberId: string, rightMemberId: string): [string, string] {
  return leftMemberId.localeCompare(rightMemberId) <= 0 ? [leftMemberId, rightMemberId] : [rightMemberId, leftMemberId];
}
