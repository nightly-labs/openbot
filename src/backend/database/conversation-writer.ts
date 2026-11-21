import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import type { ConversationMessage, ConversationSnapshot, ImageGenerationInfo } from "@openbot/contracts/ipc";
import { mergeImageGenerationInfo } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { perfTimed } from "../perf-probe-hooks";
import type { AgentRoster } from "./agent-roster";
import { recordUsageMessage } from "./agent-usage";
import { type DatabaseCore, deleteReceiptsOf, deleteThreadAttachments } from "./database-core";
import {
  databaseRow,
  databaseRows,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "./database-rows";
import {
  deletedThreadMessageIds,
  isDeletedThreadMessage,
  recordDeletedThreadHistory,
  recordDeletedThreadMessage,
  withoutDeletedMessages,
} from "./deleted-thread-messages";
import { currentConversationMessage } from "./legacy-conversation-message";
import { readOrderInputs, refreshChangedOrder, refreshThreadOrder } from "./thread-message-order";

export function withoutQueuePositions(message: ConversationMessage): ConversationMessage {
  const { delivery, exchange } = message;
  if (!delivery && !exchange) return message;
  return {
    ...message,
    ...(delivery ? { delivery: { ...delivery, position: null } } : {}),
    ...(exchange
      ? { exchange: { ...exchange, deliveries: exchange.deliveries.map((item) => ({ ...item, position: null })) } }
      : {}),
  };
}

export interface ConversationWriterOptions {
  core: DatabaseCore;
  roster: AgentRoster;
}

export class ConversationWriter {
  readonly #core: DatabaseCore;
  readonly #roster: AgentRoster;
  readonly #streamedEvents = new StreamedEventSequences();

  constructor(options: ConversationWriterOptions) {
    this.#core = options.core;
    this.#roster = options.roster;
  }

  persistConversation(
    written: ConversationSnapshot,
    eventType: string,
    payload: unknown = {},
    commandId = `conversation:${eventType}:${randomUUID()}`,
  ): ConversationSnapshot {
    if (!written.threadId) return structuredClone(written);
    const threadId = written.threadId;
    const snapshot = {
      ...written,
      messages: withoutDeletedMessages(this.#core.connection, threadId, written.messages),
    };
    const recovery = conversationRecoveryState(this.#core.connection, threadId, snapshot.activeTurnId);
    const result = this.#core.dispatch(
      commandId,
      [
        {
          aggregateType: "thread",
          aggregateId: threadId,
          eventType,
          payload: { detail: payload, snapshot, recovery },
        },
      ],
      (db, sequences) => {
        const sequence = sequences[0] ?? snapshot.revision;
        const agent = this.#roster.getAgent(snapshot.agentId);
        if (!agent) throw new Error(`Unknown agent for conversation: ${snapshot.agentId}`);
        this.#roster.ensureThreadProjection(db, agent, sequence);
        db.prepare(
          `UPDATE projection_threads
           SET active_turn_id = ?, updated_at = ?, last_event_sequence = ? WHERE thread_id = ?`,
        ).run(snapshot.activeTurnId, new Date().toISOString(), sequence, snapshot.threadId);
        const messageIds = new Set(snapshot.messages.map((message) => message.id));
        const staleMessageIds = databaseRows(
          db.prepare("SELECT message_id FROM projection_thread_messages WHERE thread_id = ?").all(threadId),
        )
          .map((row) => requiredStringColumn(row, "message_id"))
          .filter((messageId) => !messageIds.has(messageId));
        const deleteMessage = db.prepare(
          "DELETE FROM projection_thread_messages WHERE thread_id = ? AND message_id = ?",
        );
        const deleteAttachments = db.prepare(
          "DELETE FROM projection_attachments WHERE owner_kind = 'thread-message' AND owner_id = ?",
        );
        for (const messageId of staleMessageIds) {
          deleteAttachments.run(`${threadId}:${messageId}`);
          deleteMessage.run(threadId, messageId);
        }
        const upsert = db.prepare(`
          INSERT INTO projection_thread_messages (
            thread_id, message_id, turn_id, author, status, item_type, created_at,
            ordinal, message_json, last_event_sequence
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(thread_id, message_id) DO UPDATE SET
            turn_id = excluded.turn_id,
            author = excluded.author,
            status = excluded.status,
            item_type = excluded.item_type,
            created_at = excluded.created_at,
            ordinal = excluded.ordinal,
            message_json = excluded.message_json,
            last_event_sequence = excluded.last_event_sequence
        `);
        const insertAttachment = db.prepare(`
          INSERT OR REPLACE INTO projection_attachments
            (attachment_id, owner_kind, owner_id, name, path, metadata_json, created_at, last_event_sequence)
          VALUES (?, 'thread-message', ?, ?, '', ?, ?, ?)
        `);
        snapshot.messages.forEach((message, ordinal) => {
          recordUsageMessage(db, agent.id, message, agent.provider, agent.model);
          upsert.run(
            snapshot.threadId,
            message.id,
            message.turnId ?? null,
            message.author,
            message.status,
            message.itemType ?? null,
            message.createdAt,
            ordinal,
            JSON.stringify(message),
            sequence,
          );
          for (const attachment of message.attachments ?? []) {
            insertAttachment.run(
              `${snapshot.threadId}:${message.id}:${attachment.id}`,
              `${snapshot.threadId}:${message.id}`,
              attachment.name,
              JSON.stringify(attachment),
              message.createdAt,
              sequence,
            );
          }
        });
        db.prepare(`
          INSERT INTO projection_thread_activities
            (activity_id, thread_id, turn_id, activity_type, payload_json, created_at, last_event_sequence)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(),
          snapshot.threadId,
          activityTurnId(eventType, payload, snapshot.activeTurnId),
          eventType,
          JSON.stringify(payload),
          new Date().toISOString(),
          sequence,
        );
        if (snapshot.activeTurnId) {
          db.prepare(`
            INSERT INTO projection_turns
              (turn_id, thread_id, provider_session_id, status, started_at, completed_at, last_event_sequence)
            VALUES (?, ?, (
              SELECT id FROM projection_provider_sessions
              WHERE thread_id = ? AND state = 'active' ORDER BY created_at DESC LIMIT 1
            ), 'running', ?, NULL, ?)
            ON CONFLICT(turn_id) DO UPDATE SET status = 'running', last_event_sequence = excluded.last_event_sequence
            WHERE projection_turns.completed_at IS NULL
          `).run(snapshot.activeTurnId, snapshot.threadId, snapshot.threadId, new Date().toISOString(), sequence);
        }
        if (isTurnEndEvent(eventType) && isDynamicRecord(payload) && "turnId" in payload && isString(payload.turnId)) {
          const status =
            "status" in payload && isString(payload.status)
              ? payload.status
              : eventType === "turn.interrupted-by-restart"
                ? "interrupted"
                : "completed";
          db.prepare(
            `UPDATE projection_turns
             SET status = ?, completed_at = ?, last_event_sequence = ?
             WHERE thread_id = ? AND turn_id = ?`,
          ).run(status, new Date().toISOString(), sequence, snapshot.threadId, payload.turnId);
        }
        refreshThreadOrder(db, threadId);
        pruneConversationSnapshots(db, threadId, sequence);
        return { revision: sequence };
      },
    );
    return { ...structuredClone(snapshot), revision: result.revision };
  }

  persistStreamingMessage(input: {
    snapshot: ConversationSnapshot;
    messageId: string;
    eventType: string;
    detail?: unknown;
    commandId?: string;
  }): number {
    const { snapshot, messageId } = input;
    const threadId = snapshot.threadId;
    if (threadId && isDeletedThreadMessage(this.#core.connection, threadId, messageId)) {
      return this.#threadRevision(threadId);
    }
    if (!threadId) return snapshot.revision;
    const ordinal = snapshot.messages.findIndex((message) => message.id === messageId);
    if (ordinal < 0) return this.#threadRevision(threadId);
    const message = snapshot.messages[ordinal];
    if (!message) throw new Error(`Streamed message is missing from the snapshot: ${messageId}`);
    return this.#core.dispatch(
      input.commandId ?? `conversation:${input.eventType}:${randomUUID()}`,
      [
        {
          aggregateType: "thread",
          aggregateId: threadId,
          eventType: input.eventType,
          payload: {
            detail: input.detail ?? {},
            streamedMessage: message,
            activeTurnId: snapshot.activeTurnId,
          },
        },
      ],
      (db, sequences) => {
        const sequence = sequences[0] ?? snapshot.revision;
        const agent = this.#roster.getAgent(snapshot.agentId);
        if (!agent) throw new Error(`Unknown agent for conversation: ${snapshot.agentId}`);
        this.#roster.ensureThreadProjection(db, agent, sequence);
        const streamedEvent = { threadId, messageId, eventType: input.eventType };
        perfTimed("db.supersedeStreamed", () =>
          supersedeStreamedMessageEvents(this.#core, streamedEvent, sequence, this.#streamedEvents.get(streamedEvent)),
        );
        this.#streamedEvents.set(streamedEvent, sequence);
        const orderBefore = readOrderInputs(db, threadId, [message.id]);
        this.#core
          .statement(`
          INSERT INTO projection_thread_messages (
            thread_id, message_id, turn_id, author, status, item_type, created_at,
            ordinal, message_json, last_event_sequence
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(thread_id, message_id) DO UPDATE SET
            turn_id = excluded.turn_id,
            author = excluded.author,
            status = excluded.status,
            item_type = excluded.item_type,
            created_at = excluded.created_at,
            ordinal = excluded.ordinal,
            message_json = excluded.message_json,
            last_event_sequence = excluded.last_event_sequence
        `)
          .run(
            threadId,
            message.id,
            message.turnId ?? null,
            message.author,
            message.status,
            message.itemType ?? null,
            message.createdAt,
            ordinal,
            JSON.stringify(message),
            sequence,
          );
        refreshChangedOrder(db, threadId, orderBefore, [message.id]);
        recordUsageMessage(db, agent.id, message, agent.provider, agent.model);
        this.#core
          .statement(
            `UPDATE projection_threads
             SET active_turn_id = ?, updated_at = ?, last_event_sequence = ? WHERE thread_id = ?`,
          )
          .run(snapshot.activeTurnId, new Date().toISOString(), sequence, threadId);
        return { revision: sequence };
      },
    ).revision;
  }

  appendConversationMessage(input: {
    agentId: string;
    threadId: string;
    activeTurnId: string | null;
    message: ConversationMessage;
    eventType: string;
    detail?: unknown;
    commandId?: string;
  }): number {
    if (isDeletedThreadMessage(this.#core.connection, input.threadId, input.message.id)) {
      return this.#threadRevision(input.threadId);
    }
    const result = this.#core.dispatch(
      input.commandId ?? `conversation:${input.eventType}:${randomUUID()}`,
      [
        {
          aggregateType: "thread",
          aggregateId: input.threadId,
          eventType: input.eventType,
          occurredAt: input.message.createdAt,
          payload: {
            detail: input.detail ?? {},
            appendedMessage: input.message,
            activeTurnId: input.activeTurnId,
          },
        },
      ],
      (db, sequences) => {
        const sequence = sequences[0] ?? 0;
        const agent = this.#roster.getAgent(input.agentId);
        if (!agent || agent.threadId !== input.threadId) {
          throw new Error(`Unknown agent thread for conversation append: ${input.agentId}`);
        }
        this.#roster.ensureThreadProjection(db, agent, sequence);
        const ordinalRow = databaseRow(
          db
            .prepare(
              `SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal
               FROM projection_thread_messages WHERE thread_id = ?`,
            )
            .get(input.threadId),
        );
        const ordinal = ordinalRow ? requiredNumberColumn(ordinalRow, "ordinal") : 0;
        db.prepare(
          `INSERT INTO projection_thread_messages (
             thread_id, message_id, turn_id, author, status, item_type, created_at,
             ordinal, message_json, last_event_sequence
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          input.threadId,
          input.message.id,
          input.message.turnId ?? null,
          input.message.author,
          input.message.status,
          input.message.itemType ?? null,
          input.message.createdAt,
          ordinal,
          JSON.stringify(input.message),
          sequence,
        );
        refreshChangedOrder(db, input.threadId, new Map(), [input.message.id]);
        recordUsageMessage(db, agent.id, input.message, agent.provider, agent.model);
        for (const attachment of input.message.attachments ?? []) {
          db.prepare(
            `INSERT INTO projection_attachments
               (attachment_id, owner_kind, owner_id, name, path, metadata_json, created_at, last_event_sequence)
             VALUES (?, 'thread-message', ?, ?, '', ?, ?, ?)`,
          ).run(
            `${input.threadId}:${input.message.id}:${attachment.id}`,
            `${input.threadId}:${input.message.id}`,
            attachment.name,
            JSON.stringify(attachment),
            input.message.createdAt,
            sequence,
          );
        }
        db.prepare(
          `UPDATE projection_threads
           SET active_turn_id = ?, updated_at = ?, last_event_sequence = ? WHERE thread_id = ?`,
        ).run(input.activeTurnId, input.message.createdAt, sequence, input.threadId);
        db.prepare(
          `INSERT INTO projection_thread_activities
             (activity_id, thread_id, turn_id, activity_type, payload_json, created_at, last_event_sequence)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          randomUUID(),
          input.threadId,
          input.message.turnId ?? input.activeTurnId,
          input.eventType,
          JSON.stringify(input.detail ?? {}),
          input.message.createdAt,
          sequence,
        );
        return { revision: sequence };
      },
    );
    return result.revision;
  }

  changedConversationMessages(threadId: string, written: readonly ConversationMessage[]): ConversationMessage[] {
    const messages = withoutDeletedMessages(this.#core.connection, threadId, written);
    if (messages.length === 0) return [];
    const stored = new Map(
      databaseRows(
        this.#core.connection
          .prepare(
            `SELECT message_id, message_json FROM projection_thread_messages
             WHERE thread_id = ? AND message_id IN (${messages.map(() => "?").join(", ")})`,
          )
          .all(threadId, ...messages.map((message) => message.id)),
      ).map((row) => [
        requiredStringColumn(row, "message_id"),
        currentConversationMessage(JSON.parse(requiredStringColumn(row, "message_json"))),
      ]),
    );
    return messages.filter((message) => {
      const existing = stored.get(message.id);
      if (!existing) return true;
      return !isDeepStrictEqual(
        JSON.parse(JSON.stringify(withoutQueuePositions(mergeLiveMessage(existing, message)))),
        withoutQueuePositions(existing),
      );
    });
  }

  persistConversationChanges(input: {
    agentId: string;
    threadId: string;
    activeTurnId: string | null;
    changedMessages: readonly ConversationMessage[];
    removedMessageIds?: readonly string[];
    eventType: string;
    detail?: unknown;
    commandId?: string;
    deletedMessageIds?: readonly string[];
  }): number {
    const deletedMessageIds = input.deletedMessageIds ?? [];
    const removedMessageIds = [...new Set([...(input.removedMessageIds ?? []), ...deletedMessageIds])];
    const deleted = deletedThreadMessageIds(this.#core.connection, input.threadId);
    for (const messageId of deletedMessageIds) deleted.add(messageId);
    const changedMessages = input.changedMessages.filter((message) => !deleted.has(message.id));
    const result = this.#core.dispatch(
      input.commandId ?? `conversation:${input.eventType}:${randomUUID()}`,
      [
        {
          aggregateType: "thread",
          aggregateId: input.threadId,
          eventType: input.eventType,
          payload: {
            detail: input.detail ?? {},
            changedMessages,
            removedMessageIds,
            activeTurnId: input.activeTurnId,
          },
        },
      ],
      (db, sequences) => {
        const sequence = sequences[0] ?? 0;
        const agent = this.#roster.getAgent(input.agentId);
        const threadOwner = databaseRow(
          db.prepare("SELECT agent_id FROM projection_threads WHERE thread_id = ?").get(input.threadId),
        );
        if (
          !agent ||
          (threadOwner ? requiredStringColumn(threadOwner, "agent_id") !== agent.id : agent.threadId !== input.threadId)
        ) {
          throw new Error(`Unknown agent for conversation changes: ${input.agentId}`);
        }
        if (!threadOwner) this.#roster.ensureThreadProjection(db, agent, sequence);
        const writtenMessageIds = [...changedMessages.map((message) => message.id), ...removedMessageIds];
        const orderBefore = readOrderInputs(db, input.threadId, writtenMessageIds);
        const findOrdinal = db.prepare(
          "SELECT ordinal, message_json FROM projection_thread_messages WHERE thread_id = ? AND message_id = ?",
        );
        const nextOrdinal = db.prepare(
          "SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM projection_thread_messages WHERE thread_id = ?",
        );
        const upsert = db.prepare(`
          INSERT INTO projection_thread_messages (
            thread_id, message_id, turn_id, author, status, item_type, created_at,
            ordinal, message_json, last_event_sequence
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(thread_id, message_id) DO UPDATE SET
            turn_id = excluded.turn_id,
            author = excluded.author,
            status = excluded.status,
            item_type = excluded.item_type,
            created_at = excluded.created_at,
            ordinal = excluded.ordinal,
            message_json = excluded.message_json,
            last_event_sequence = excluded.last_event_sequence
        `);
        const deleteAttachments = db.prepare(
          "DELETE FROM projection_attachments WHERE owner_kind = 'thread-message' AND owner_id = ?",
        );
        const insertAttachment = db.prepare(`
          INSERT OR REPLACE INTO projection_attachments
            (attachment_id, owner_kind, owner_id, name, path, metadata_json, created_at, last_event_sequence)
          VALUES (?, 'thread-message', ?, ?, '', ?, ?, ?)
        `);
        let appendOrdinal: number | undefined;
        for (const imported of changedMessages) {
          const existingRow = databaseRow(findOrdinal.get(input.threadId, imported.id));
          const existing = existingRow
            ? currentConversationMessage(JSON.parse(requiredStringColumn(existingRow, "message_json")))
            : null;
          const message = existing ? mergeLiveMessage(existing, imported) : imported;
          let ordinal: number;
          if (existingRow) {
            ordinal = requiredNumberColumn(existingRow, "ordinal");
          } else {
            appendOrdinal ??= requiredNumberColumn(
              databaseRow(nextOrdinal.get(input.threadId)) ?? { ordinal: 0 },
              "ordinal",
            );
            ordinal = appendOrdinal;
            appendOrdinal += 1;
          }
          upsert.run(
            input.threadId,
            message.id,
            message.turnId ?? null,
            message.author,
            message.status,
            message.itemType ?? null,
            message.createdAt,
            ordinal,
            JSON.stringify(message),
            sequence,
          );
          recordUsageMessage(db, agent.id, message, agent.provider, agent.model);
          deleteAttachments.run(`${input.threadId}:${message.id}`);
          for (const attachment of message.attachments ?? []) {
            insertAttachment.run(
              `${input.threadId}:${message.id}:${attachment.id}`,
              `${input.threadId}:${message.id}`,
              attachment.name,
              JSON.stringify(attachment),
              message.createdAt,
              sequence,
            );
          }
        }
        const deleteMessage = db.prepare(
          "DELETE FROM projection_thread_messages WHERE thread_id = ? AND message_id = ?",
        );
        const deletedAt = new Date().toISOString();
        for (const messageId of deletedMessageIds) recordDeletedThreadMessage(db, input.threadId, messageId, deletedAt);
        for (const messageId of removedMessageIds) {
          deleteAttachments.run(`${input.threadId}:${messageId}`);
          deleteMessage.run(input.threadId, messageId);
        }
        refreshChangedOrder(db, input.threadId, orderBefore, writtenMessageIds);
        db.prepare(
          `UPDATE projection_threads
           SET active_turn_id = ?, updated_at = ?, last_event_sequence = ? WHERE thread_id = ?`,
        ).run(input.activeTurnId, new Date().toISOString(), sequence, input.threadId);
        if (input.activeTurnId) {
          db.prepare(`
            INSERT INTO projection_turns
              (turn_id, thread_id, provider_session_id, status, started_at, completed_at, last_event_sequence)
            VALUES (?, ?, (
              SELECT id FROM projection_provider_sessions
              WHERE thread_id = ? AND state = 'active' ORDER BY created_at DESC LIMIT 1
            ), 'running', ?, NULL, ?)
            ON CONFLICT(turn_id) DO UPDATE SET status = 'running', last_event_sequence = excluded.last_event_sequence
            WHERE projection_turns.completed_at IS NULL
          `).run(input.activeTurnId, input.threadId, input.threadId, new Date().toISOString(), sequence);
        }
        if (
          isTurnEndEvent(input.eventType) &&
          isDynamicRecord(input.detail) &&
          "turnId" in input.detail &&
          isString(input.detail.turnId)
        ) {
          const status =
            "status" in input.detail && isString(input.detail.status)
              ? input.detail.status
              : input.eventType === "turn.interrupted-by-restart"
                ? "interrupted"
                : "completed";
          db.prepare(
            `UPDATE projection_turns
             SET status = ?, completed_at = ?, last_event_sequence = ?
             WHERE thread_id = ? AND turn_id = ?`,
          ).run(status, new Date().toISOString(), sequence, input.threadId, input.detail.turnId);
        }
        if (input.eventType === "turn.interrupted-by-restart") {
          db.prepare(
            `UPDATE projection_turns
             SET status = 'interrupted', completed_at = COALESCE(completed_at, ?), last_event_sequence = ?
             WHERE thread_id = ? AND status = 'running'`,
          ).run(new Date().toISOString(), sequence, input.threadId);
        }
        db.prepare(`
          INSERT INTO projection_thread_activities
            (activity_id, thread_id, turn_id, activity_type, payload_json, created_at, last_event_sequence)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          input.eventType === CONVERSATION_UPDATED ? updateActivityId(sequence) : randomUUID(),
          input.threadId,
          activityTurnId(input.eventType, input.detail, input.activeTurnId),
          input.eventType,
          JSON.stringify(input.detail ?? {}),
          new Date().toISOString(),
          sequence,
        );
        if (input.eventType === CONVERSATION_UPDATED && input.commandId === undefined)
          supersedePreviousConversationUpdate(db, input.threadId, sequence, changedMessages, input.activeTurnId);
        return { revision: sequence };
      },
    );
    return result.revision;
  }

  deleteThreadHistory(input: { agentId: string; threadId: string }): number {
    const eventType = "conversation.history-deleted";
    return this.#core.dispatch(
      `conversation:${eventType}:${randomUUID()}`,
      [
        {
          aggregateType: "thread",
          aggregateId: input.threadId,
          eventType,
          payload: { detail: {}, changedMessages: [], removedMessageIds: [], activeTurnId: null },
        },
      ],
      (db, sequences) => {
        const sequence = sequences[0] ?? 0;
        const threadOwner = databaseRow(
          db.prepare("SELECT agent_id FROM projection_threads WHERE thread_id = ?").get(input.threadId),
        );
        if (!threadOwner || requiredStringColumn(threadOwner, "agent_id") !== input.agentId)
          throw new Error(`Unknown agent for conversation changes: ${input.agentId}`);
        recordDeletedThreadHistory(db, input.threadId, new Date().toISOString());
        deleteThreadAttachments(db, input.threadId);
        db.prepare("DELETE FROM projection_thread_messages WHERE thread_id = ?").run(input.threadId);
        db.prepare("DELETE FROM projection_thread_summaries WHERE thread_id = ?").run(input.threadId);
        const summaryEvents =
          "FROM orchestration_events WHERE aggregate_type = 'thread' AND aggregate_id = ? AND event_type = 'thread.summary-created'";
        const summaryCommands = databaseRows(
          db.prepare(`SELECT DISTINCT command_id ${summaryEvents}`).all(input.threadId),
        ).map((row) => requiredStringColumn(row, "command_id"));
        db.prepare(
          `DELETE FROM projection_thread_activities WHERE thread_id = ? AND last_event_sequence IN (SELECT sequence ${summaryEvents})`,
        ).run(input.threadId, input.threadId);
        db.prepare(`DELETE ${summaryEvents}`).run(input.threadId);
        deleteReceiptsOf(db, summaryCommands);
        db.prepare("UPDATE projection_threads SET updated_at = ?, last_event_sequence = ? WHERE thread_id = ?").run(
          new Date().toISOString(),
          sequence,
          input.threadId,
        );
        return sequence;
      },
    );
  }

  upsertProviderHistoryMessage(input: {
    agentId: string;
    threadId: string;
    activeTurnId?: string | null;
    message: ConversationMessage;
    eventType?: string;
    detail?: unknown;
    commandId?: string;
  }): number {
    const eventType = input.eventType ?? "provider-history.message-imported";
    if (isDeletedThreadMessage(this.#core.connection, input.threadId, input.message.id)) {
      return this.#threadRevision(input.threadId);
    }
    const existingBeforeWrite = databaseRow(
      this.#core.connection
        .prepare(
          `SELECT message_json FROM projection_thread_messages
           WHERE thread_id = ? AND message_id = ?`,
        )
        .get(input.threadId, input.message.id),
    );
    if (existingBeforeWrite && input.activeTurnId === undefined) {
      const existingMessage = currentConversationMessage(
        JSON.parse(requiredStringColumn(existingBeforeWrite, "message_json")),
      );
      if (
        existingMessage &&
        JSON.stringify(mergeImportedMessage(existingMessage, input.message)) === JSON.stringify(existingMessage)
      ) {
        return this.#threadRevision(input.threadId);
      }
    }
    const result = this.#core.dispatch(
      input.commandId ?? `conversation:${eventType}:${randomUUID()}`,
      [
        {
          aggregateType: "thread",
          aggregateId: input.threadId,
          eventType,
          occurredAt: input.message.createdAt,
          payload: {
            detail: input.detail ?? {},
            importedMessage: input.message,
            ...(input.activeTurnId === undefined ? {} : { activeTurnId: input.activeTurnId }),
          },
        },
      ],
      (db, sequences) => {
        const sequence = sequences[0] ?? 0;
        const agent = this.#roster.getAgent(input.agentId);
        if (!agent) {
          throw new Error(`Unknown agent thread for provider history: ${input.agentId}`);
        }
        const threadRow = databaseRow(
          db.prepare("SELECT agent_id FROM projection_threads WHERE thread_id = ?").get(input.threadId),
        );
        if (threadRow && requiredStringColumn(threadRow, "agent_id") !== agent.id) {
          throw new Error(`Provider history thread belongs to another agent: ${input.threadId}`);
        }
        if (!threadRow) {
          if (agent.threadId !== input.threadId) {
            throw new Error(`Unknown provider history thread: ${input.threadId}`);
          }
          this.#roster.ensureThreadProjection(db, agent, sequence);
        }
        const existingRow = databaseRow(
          db
            .prepare(
              `SELECT ordinal, message_json FROM projection_thread_messages
               WHERE thread_id = ? AND message_id = ?`,
            )
            .get(input.threadId, input.message.id),
        );
        const existing = existingRow
          ? currentConversationMessage(JSON.parse(requiredStringColumn(existingRow, "message_json")))
          : null;
        const message = existing ? mergeImportedMessage(existing, input.message) : input.message;
        const orderBefore = readOrderInputs(db, input.threadId, [message.id]);
        const ordinal = existingRow
          ? requiredNumberColumn(existingRow, "ordinal")
          : requiredNumberColumn(
              databaseRow(
                db
                  .prepare(
                    `SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal
                     FROM projection_thread_messages WHERE thread_id = ?`,
                  )
                  .get(input.threadId),
              ) ?? { ordinal: 0 },
              "ordinal",
            );
        db.prepare(
          `INSERT INTO projection_thread_messages (
             thread_id, message_id, turn_id, author, status, item_type, created_at,
             ordinal, message_json, last_event_sequence
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(thread_id, message_id) DO UPDATE SET
             turn_id = excluded.turn_id,
             author = excluded.author,
             status = excluded.status,
             item_type = excluded.item_type,
             created_at = excluded.created_at,
             ordinal = excluded.ordinal,
             message_json = excluded.message_json,
             last_event_sequence = excluded.last_event_sequence`,
        ).run(
          input.threadId,
          message.id,
          message.turnId ?? null,
          message.author,
          message.status,
          message.itemType ?? null,
          message.createdAt,
          ordinal,
          JSON.stringify(message),
          sequence,
        );
        refreshChangedOrder(db, input.threadId, orderBefore, [message.id]);
        recordUsageMessage(db, agent.id, message, agent.provider, agent.model);
        for (const attachment of message.attachments ?? []) {
          db.prepare(
            `INSERT OR REPLACE INTO projection_attachments
               (attachment_id, owner_kind, owner_id, name, path, metadata_json, created_at, last_event_sequence)
             VALUES (?, 'thread-message', ?, ?, '', ?, ?, ?)`,
          ).run(
            `${input.threadId}:${message.id}:${attachment.id}`,
            `${input.threadId}:${message.id}`,
            attachment.name,
            JSON.stringify(attachment),
            message.createdAt,
            sequence,
          );
        }
        if (input.activeTurnId !== undefined) {
          db.prepare(
            `UPDATE projection_threads
             SET active_turn_id = ?, updated_at = ?, last_event_sequence = ? WHERE thread_id = ?`,
          ).run(input.activeTurnId, new Date().toISOString(), sequence, input.threadId);
        } else {
          db.prepare(`UPDATE projection_threads SET updated_at = ?, last_event_sequence = ? WHERE thread_id = ?`).run(
            new Date().toISOString(),
            sequence,
            input.threadId,
          );
        }
        db.prepare(
          `INSERT INTO projection_thread_activities
             (activity_id, thread_id, turn_id, activity_type, payload_json, created_at, last_event_sequence)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          randomUUID(),
          input.threadId,
          message.turnId ?? input.activeTurnId ?? null,
          eventType,
          JSON.stringify(input.detail ?? {}),
          input.message.createdAt,
          sequence,
        );
        return { revision: sequence };
      },
    );
    return result.revision;
  }

  #threadRevision(threadId: string): number {
    const revision = databaseRow(
      this.#core.connection
        .prepare("SELECT last_event_sequence FROM projection_threads WHERE thread_id = ?")
        .get(threadId),
    );
    return revision ? requiredNumberColumn(revision, "last_event_sequence") : 0;
  }
}

export function isTurnEndEvent(eventType: string): boolean {
  return ["turn.completed", "turn.reconciled-after-restart", "turn.interrupted-by-restart"].includes(eventType);
}

export function activityTurnId(eventType: string, detail: unknown, activeTurnId: string | null): string | null {
  return isTurnEndEvent(eventType) && isDynamicRecord(detail) && isString(detail.turnId) ? detail.turnId : activeTurnId;
}

export function keptUnsavedImage(
  existing: ConversationMessage,
  imported: ConversationMessage,
  imageGeneration: ImageGenerationInfo | undefined,
): Partial<ConversationMessage> {
  if (
    existing.itemType !== "image_generation" ||
    (existing.status !== "failed" && existing.status !== "interrupted") ||
    existing.attachments?.length ||
    imported.attachments?.length
  )
    return {};
  const stored = existing.imageGeneration;
  return {
    status: existing.status,
    ...(stored?.error === undefined
      ? {}
      : { imageGeneration: { ...(imageGeneration ?? stored), error: stored.error } }),
  };
}

function mergeImportedMessage(existing: ConversationMessage, imported: ConversationMessage): ConversationMessage {
  const attachments = mergeValues(existing.attachments, imported.attachments, (attachment) => attachment.id);
  const reactions = mergeValues(existing.reactions, imported.reactions, (reaction) => JSON.stringify(reaction));
  const turnId = existing.turnId ?? imported.turnId;
  const imageGeneration = mergeImageGenerationInfo(existing.imageGeneration, imported.imageGeneration);
  return {
    ...existing,
    ...imported,
    id: existing.id,
    author: existing.author,
    createdAt: existing.createdAt,
    ...(turnId === undefined ? {} : { turnId }),
    ...(attachments === undefined ? {} : { attachments }),
    ...(reactions === undefined ? {} : { reactions }),
    ...(imported.delivery === undefined && existing.delivery ? { delivery: existing.delivery } : {}),
    ...(imported.exchange === undefined && existing.exchange ? { exchange: existing.exchange } : {}),
    ...(imported.senderMember === undefined && existing.senderMember ? { senderMember: existing.senderMember } : {}),
    ...(imageGeneration ? { imageGeneration } : {}),
    ...keptUnsavedImage(existing, imported, imageGeneration),
  };
}

function mergeLiveMessage(existing: ConversationMessage, updated: ConversationMessage): ConversationMessage {
  const turnId = updated.turnId ?? existing.turnId;
  return {
    ...existing,
    ...updated,
    id: existing.id,
    author: existing.author,
    createdAt: updated.delivery ? updated.createdAt : existing.createdAt,
    ...(turnId === undefined ? {} : { turnId }),
  };
}

function mergeValues<T>(
  existing: T[] | undefined,
  imported: T[] | undefined,
  key: (value: T) => string,
): T[] | undefined {
  if (existing === undefined && imported === undefined) return undefined;
  const values = new Map((existing ?? []).map((value) => [key(value), value]));
  for (const value of imported ?? []) values.set(key(value), value);
  return [...values.values()];
}

function conversationRecoveryState(
  db: DatabaseSync,
  threadId: string,
  activeTurnId: string | null,
): { turnProviderSessionIds: Record<string, string | null> } {
  const turnProviderSessionIds: Record<string, string | null> = {};
  for (const row of databaseRows(
    db.prepare("SELECT turn_id, provider_session_id FROM projection_turns WHERE thread_id = ?").all(threadId),
  )) {
    const turnId = requiredStringColumn(row, "turn_id");
    turnProviderSessionIds[turnId] = optionalStringColumn(row, "provider_session_id");
  }
  if (activeTurnId && !(activeTurnId in turnProviderSessionIds)) {
    const activeSession = databaseRow(
      db
        .prepare(
          `SELECT id FROM projection_provider_sessions
           WHERE thread_id = ? AND state = 'active'
           ORDER BY created_at DESC, last_event_sequence DESC LIMIT 1`,
        )
        .get(threadId),
    );
    turnProviderSessionIds[activeTurnId] = activeSession ? requiredStringColumn(activeSession, "id") : null;
  }
  return { turnProviderSessionIds };
}

interface StreamedEvent {
  threadId: string;
  messageId: string;
  eventType: string;
}

const REMEMBERED_STREAMED_EVENTS = 1024;

class StreamedEventSequences {
  readonly #sequences = new Map<string, number>();

  get(event: StreamedEvent): number | undefined {
    return this.#sequences.get(streamedEventKey(event));
  }

  set(event: StreamedEvent, sequence: number): void {
    const key = streamedEventKey(event);
    this.#sequences.delete(key);
    this.#sequences.set(key, sequence);
    if (this.#sequences.size <= REMEMBERED_STREAMED_EVENTS) return;
    const oldest = this.#sequences.keys().next().value;
    if (oldest !== undefined) this.#sequences.delete(oldest);
  }
}

function streamedEventKey(event: StreamedEvent): string {
  return JSON.stringify([event.threadId, event.eventType, event.messageId]);
}

function supersedeStreamedMessageEvents(
  core: DatabaseCore,
  event: StreamedEvent,
  retainedSequence: number,
  rememberedSequence: number | undefined,
): void {
  const { threadId, messageId, eventType } = event;
  const previous =
    databaseRow(
      core
        .statement(
          `SELECT e.sequence, e.command_id FROM projection_thread_messages m
         JOIN orchestration_events e ON e.sequence = m.last_event_sequence
         WHERE m.thread_id = ? AND m.message_id = ? AND e.aggregate_type = 'thread' AND e.aggregate_id = ?
           AND e.event_type = ? AND e.sequence < ? AND json_extract(e.payload_json, '$.streamedMessage.id') = ?`,
        )
        .get(threadId, messageId, threadId, eventType, retainedSequence, messageId),
    ) ??
    (rememberedSequence === undefined
      ? undefined
      : databaseRow(
          core
            .statement(
              `SELECT sequence, command_id FROM orchestration_events
               WHERE sequence = ? AND aggregate_type = 'thread' AND aggregate_id = ? AND event_type = ?
                 AND sequence < ? AND json_extract(payload_json, '$.streamedMessage.id') = ?`,
            )
            .get(rememberedSequence, threadId, eventType, retainedSequence, messageId),
        ));
  if (!previous) return;
  core.statement("DELETE FROM orchestration_events WHERE sequence = ?").run(requiredNumberColumn(previous, "sequence"));
  deleteReceiptsOf(core.connection, [requiredStringColumn(previous, "command_id")]);
}

const CONVERSATION_UPDATED = "conversation.snapshot-updated";
const GENERATED_UPDATE_COMMAND =
  /^conversation:conversation\.snapshot-updated:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function updateActivityId(sequence: number): string {
  return `${CONVERSATION_UPDATED}:${sequence}`;
}

function supersedePreviousConversationUpdate(
  db: DatabaseSync,
  threadId: string,
  sequence: number,
  changedMessages: readonly ConversationMessage[],
  activeTurnId: string | null,
): void {
  const previous = databaseRow(
    db
      .prepare(
        `SELECT sequence, command_id, event_type FROM orchestration_events
         WHERE aggregate_type = 'thread' AND aggregate_id = ? AND sequence < ?
         ORDER BY sequence DESC LIMIT 1`,
      )
      .get(threadId, sequence),
  );
  if (!previous || requiredStringColumn(previous, "event_type") !== CONVERSATION_UPDATED) return;
  const commandId = requiredStringColumn(previous, "command_id");
  if (!GENERATED_UPDATE_COMMAND.test(commandId)) return;
  const previousSequence = requiredNumberColumn(previous, "sequence");
  const payload = databaseRow(
    db.prepare("SELECT payload_json FROM orchestration_events WHERE sequence = ?").get(previousSequence),
  );
  if (
    !payload ||
    !replacedUpdate(JSON.parse(requiredStringColumn(payload, "payload_json")), changedMessages, activeTurnId)
  )
    return;
  db.prepare("DELETE FROM projection_thread_activities WHERE activity_id = ?").run(updateActivityId(previousSequence));
  db.prepare("DELETE FROM orchestration_events WHERE sequence = ?").run(previousSequence);
  deleteReceiptsOf(db, [commandId]);
}

function replacedUpdate(
  previous: unknown,
  changedMessages: readonly ConversationMessage[],
  activeTurnId: string | null,
): boolean {
  if (!isDynamicRecord(previous) || previous.activeTurnId !== activeTurnId) return false;
  if (!Array.isArray(previous.removedMessageIds) || previous.removedMessageIds.length > 0) return false;
  const messages = previous.changedMessages;
  if (!Array.isArray(messages) || messages.length > changedMessages.length) return false;
  return messages.every((message, index) => {
    const next = changedMessages[index];
    if (!isDynamicRecord(message) || next === undefined || message.id !== next.id) return false;
    if (message.author !== next.author || (next.delivery === undefined && message.createdAt !== next.createdAt))
      return false;
    const nextKeys = new Set(Object.entries(next).flatMap(([key, value]) => (value === undefined ? [] : [key])));
    return Object.keys(message).every((key) => nextKeys.has(key));
  });
}

function pruneConversationSnapshots(db: DatabaseSync, threadId: string, retainedSequence: number): void {
  const supersededEvents = `
    aggregate_type = 'thread' AND aggregate_id = ? AND sequence < ?
      AND (json_type(payload_json, '$.snapshot') = 'object'
        OR json_type(payload_json, '$.streamedMessage') = 'object')`;
  db.prepare(
    `DELETE FROM projection_thread_activities
     WHERE thread_id = ? AND last_event_sequence IN (
       SELECT sequence FROM orchestration_events WHERE ${supersededEvents}
     )`,
  ).run(threadId, threadId, retainedSequence);
  const supersededCommandIds = databaseRows(
    db
      .prepare(`DELETE FROM orchestration_events WHERE ${supersededEvents} RETURNING command_id`)
      .all(threadId, retainedSequence),
  ).map((row) => requiredStringColumn(row, "command_id"));
  deleteReceiptsOf(db, supersededCommandIds);
}
