import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ConversationMessage, ConversationSnapshot } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { AgentRoster } from "./agent-roster";
import { recordUsageMessage } from "./agent-usage";
import {
  type ConversationReveal,
  ConversationVisibility,
  type ConversationWriteSource,
} from "./conversation-visibility";
import { type DatabaseCore, deleteOrphanReceipts } from "./database-core";
import {
  databaseRow,
  databaseRows,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "./database-rows";
import { currentConversationMessage } from "./legacy-conversation-message";

export interface ConversationWriterOptions {
  core: DatabaseCore;
  roster: AgentRoster;
}

type ConversationStreamingWrite = {
  snapshot: ConversationSnapshot;
  messageId: string;
  eventType: string;
  detail?: unknown;
  commandId?: string;
};

type ConversationAppendWrite = {
  agentId: string;
  threadId: string;
  activeTurnId: string | null;
  message: ConversationMessage;
  eventType: string;
  detail?: unknown;
  commandId?: string;
};

type ConversationChangesWrite = {
  agentId: string;
  threadId: string;
  activeTurnId: string | null;
  changedMessages: readonly ConversationMessage[];
  source?: ConversationWriteSource;
  liveMessageIds?: readonly string[];
  reveals?: readonly ConversationReveal[];
  removedMessageIds?: readonly string[];
  eventType: string;
  detail?: unknown;
  commandId?: string;
};

type ConversationHistoryWrite = {
  agentId: string;
  threadId: string;
  activeTurnId?: string | null;
  message: ConversationMessage;
  eventType?: string;
  detail?: unknown;
  commandId?: string;
};

/**
 * The write side of a thread's conversation: a whole snapshot, one appended message, or one message
 * of a run of streamed text.
 *
 * Owns `projection_thread_messages` and `projection_thread_activities`, and compacts the thread
 * aggregate so the log keeps only the newest full snapshot and the streamed messages after it. Each
 * entry point prepares visibility in a transaction and runs a single dispatch. A caller already
 * in a transaction retains ownership of it. The agent lookup and the thread
 * projection row come from the roster. The class never imports the facade.
 *
 * Pick by how much is known to have changed, not by convenience: `persistConversation` costs as
 * much as the thread is long, so a caller on a hot path that changed one message must use
 * `persistStreamingMessage` instead.
 */
export class ConversationWriter {
  readonly #core: DatabaseCore;
  readonly #roster: AgentRoster;
  readonly #visibility: ConversationVisibility;

  constructor(options: ConversationWriterOptions) {
    this.#core = options.core;
    this.#roster = options.roster;
    this.#visibility = new ConversationVisibility(options.core);
  }

  persistConversation(
    snapshot: ConversationSnapshot,
    eventType: string,
    payload: unknown = {},
    commandId = `conversation:${eventType}:${randomUUID()}`,
    source: ConversationWriteSource = "preserve",
  ): ConversationSnapshot {
    if (!snapshot.threadId) return structuredClone(snapshot);
    const threadId = snapshot.threadId;
    return this.#visibility.transaction(() => {
      const effectiveSource = this.#core.commandResult(commandId) === undefined ? source : "preserve";
      const prepared = {
        ...snapshot,
        messages: this.#visibility.prepare(threadId, snapshot.messages, effectiveSource),
      };
      return this.#persistConversation(prepared, eventType, payload, commandId);
    });
  }

  persistStreamingMessage(input: ConversationStreamingWrite): number {
    return this.#visibility.transaction(() => {
      const message = input.snapshot.messages.find((candidate) => candidate.id === input.messageId);
      if (!input.snapshot.threadId || !message) return this.#persistStreamingMessage(input);
      const prepared = this.#visibility.prepare(input.snapshot.threadId, [message], "live");
      return this.#persistStreamingMessage({
        ...input,
        snapshot: {
          ...input.snapshot,
          messages: input.snapshot.messages.map((candidate) =>
            candidate.id === message.id ? (prepared[0] ?? candidate) : candidate,
          ),
        },
      });
    });
  }

  appendConversationMessage(input: ConversationAppendWrite): number {
    return this.#visibility.transaction(() => {
      const prepared = this.#visibility.prepare(input.threadId, [input.message], "live");
      return this.#appendConversationMessage({ ...input, message: prepared[0] ?? input.message });
    });
  }

  persistConversationChanges(input: ConversationChangesWrite): number {
    return this.#visibility.transaction(() =>
      this.#persistConversationChanges({
        ...input,
        changedMessages: this.#visibility.prepare(
          input.threadId,
          input.changedMessages,
          input.source ?? "live",
          mergeLiveMessage,
          input.liveMessageIds,
          input.reveals,
        ),
      }),
    );
  }

  upsertProviderHistoryMessage(input: ConversationHistoryWrite): number {
    return this.#visibility.transaction(() => {
      const prepared = this.#visibility.prepare(input.threadId, [input.message], "preserve", mergeImportedMessage);
      return this.#upsertProviderHistoryMessage({ ...input, message: prepared[0] ?? input.message });
    });
  }

  #persistConversation(
    snapshot: ConversationSnapshot,
    eventType: string,
    payload: unknown = {},
    commandId = `conversation:${eventType}:${randomUUID()}`,
  ): ConversationSnapshot {
    if (!snapshot.threadId) return structuredClone(snapshot);
    const threadId = snapshot.threadId;
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
        const agent = this.#roster.listAgents().find((candidate) => candidate.id === snapshot.agentId);
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
            db.prepare(`
              INSERT OR REPLACE INTO projection_attachments
                (attachment_id, owner_kind, owner_id, name, path, metadata_json, created_at, last_event_sequence)
              VALUES (?, 'thread-message', ?, ?, '', ?, ?, ?)
            `).run(
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
          snapshot.activeTurnId,
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
          `).run(snapshot.activeTurnId, snapshot.threadId, snapshot.threadId, new Date().toISOString(), sequence);
        }
        if (
          ["turn.completed", "turn.reconciled-after-restart", "turn.interrupted-by-restart"].includes(eventType) &&
          isDynamicRecord(payload) &&
          "turnId" in payload &&
          isString(payload.turnId)
        ) {
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
        pruneConversationSnapshots(db, threadId, sequence);
        return { revision: sequence };
      },
    );
    return { ...structuredClone(snapshot), revision: result.revision };
  }

  /**
   * The write behind one flushed run of streamed text.
   *
   * `persistConversation` rewrites the whole thread: it puts the entire snapshot in the event
   * payload, re-upserts every message, and clones the snapshot back out. A streaming flush arrives
   * ten times a second per streaming message, so that cost - which grows with the thread's whole
   * history - was paid ten times a second per agent, on the main process, inside a write
   * transaction that every other agent then queued behind. A six-agent channel on mature threads
   * saturated the main process with it.
   *
   * Only one message changes, so only that message is written. The event carries the message
   * whole rather than the delta, because the text is not always an append: `item/completed`
   * replaces it outright, so summing deltas would not rebuild it. A whole message also makes each
   * event idempotent and order-independent, which is what keeps a replay correct after a prune
   * removes some of the run.
   *
   * The previous unsuperseded event for the same message is deleted in the same transaction, so a
   * streaming message holds one event rather than one per flush and the log grows with the text,
   * not with the square of it.
   *
   * Returns the new revision alone. Returning the snapshot would clone the whole history back to a
   * caller that only reads `revision` from it.
   */
  #persistStreamingMessage(input: ConversationStreamingWrite): number {
    const { snapshot, messageId } = input;
    const threadId = snapshot.threadId;
    // A thread is required to address a projection row, and the message has to be in the snapshot
    // for its ordinal to be known. Neither holds for a flush that races a thread reset, so fall
    // back to the whole-snapshot write rather than drop the text.
    const ordinal = threadId ? snapshot.messages.findIndex((message) => message.id === messageId) : -1;
    if (!threadId || ordinal < 0) {
      return this.persistConversation(snapshot, input.eventType, input.detail ?? {}, input.commandId, "live").revision;
    }
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
        const agent = this.#roster.listAgents().find((candidate) => candidate.id === snapshot.agentId);
        if (!agent) throw new Error(`Unknown agent for conversation: ${snapshot.agentId}`);
        this.#roster.ensureThreadProjection(db, agent, sequence);
        supersedeStreamedMessageEvents(db, threadId, messageId, input.eventType, sequence);
        db.prepare(`
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
        `).run(
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
        // A no-op while the message streams - the helper ignores anything but a settled message -
        // and the one call that matters if a flush ever lands on a completed one.
        recordUsageMessage(db, agent.id, message, agent.provider, agent.model);
        db.prepare(
          `UPDATE projection_threads
           SET active_turn_id = ?, updated_at = ?, last_event_sequence = ? WHERE thread_id = ?`,
        ).run(snapshot.activeTurnId, new Date().toISOString(), sequence, threadId);
        return { revision: sequence };
      },
    ).revision;
  }

  #appendConversationMessage(input: ConversationAppendWrite): number {
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
        const agent = this.#roster.listAgents().find((candidate) => candidate.id === input.agentId);
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

  /**
   * Applies the changed part of a bounded conversation projection.
   *
   * The caller may omit older messages. This method only upserts the messages it receives and
   * removes the explicit ids, so a bounded working snapshot can never delete an omitted durable
   * row. The event payload is also incremental, which keeps replay independent of the full chat.
   */
  #persistConversationChanges(input: ConversationChangesWrite): number {
    const removedMessageIds = input.removedMessageIds ?? [];
    const result = this.#core.dispatch(
      input.commandId ?? `conversation:${input.eventType}:${randomUUID()}`,
      [
        {
          aggregateType: "thread",
          aggregateId: input.threadId,
          eventType: input.eventType,
          payload: {
            detail: input.detail ?? {},
            changedMessages: input.changedMessages,
            removedMessageIds,
            activeTurnId: input.activeTurnId,
          },
        },
      ],
      (db, sequences) => {
        const sequence = sequences[0] ?? 0;
        const agent = this.#roster.listAgents().find((candidate) => candidate.id === input.agentId);
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
        for (const imported of input.changedMessages) {
          const existingRow = databaseRow(findOrdinal.get(input.threadId, imported.id));
          const existing = existingRow
            ? currentConversationMessage(JSON.parse(requiredStringColumn(existingRow, "message_json")))
            : null;
          // This is a live projection update. Provider-history reconciliation uses the additive
          // merge below, but a streamed update must replace status and text from the caller. The
          // historical merge keeps the old turn id and can therefore preserve stale live state.
          const message = existing ? mergeLiveMessage(existing, imported) : imported;
          const ordinal = existingRow
            ? requiredNumberColumn(existingRow, "ordinal")
            : requiredNumberColumn(databaseRow(nextOrdinal.get(input.threadId)) ?? { ordinal: 0 }, "ordinal");
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
          db.prepare("DELETE FROM projection_attachments WHERE owner_kind = 'thread-message' AND owner_id = ?").run(
            `${input.threadId}:${message.id}`,
          );
          for (const attachment of message.attachments ?? []) {
            db.prepare(`
              INSERT OR REPLACE INTO projection_attachments
                (attachment_id, owner_kind, owner_id, name, path, metadata_json, created_at, last_event_sequence)
              VALUES (?, 'thread-message', ?, ?, '', ?, ?, ?)
            `).run(
              `${input.threadId}:${message.id}:${attachment.id}`,
              `${input.threadId}:${message.id}`,
              attachment.name,
              JSON.stringify(attachment),
              message.createdAt,
              sequence,
            );
          }
        }
        const deleteAttachments = db.prepare(
          "DELETE FROM projection_attachments WHERE owner_kind = 'thread-message' AND owner_id = ?",
        );
        const deleteMessage = db.prepare(
          "DELETE FROM projection_thread_messages WHERE thread_id = ? AND message_id = ?",
        );
        for (const messageId of removedMessageIds) {
          deleteAttachments.run(`${input.threadId}:${messageId}`);
          deleteMessage.run(input.threadId, messageId);
        }
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
          `).run(input.activeTurnId, input.threadId, input.threadId, new Date().toISOString(), sequence);
        }
        if (
          ["turn.completed", "turn.reconciled-after-restart", "turn.interrupted-by-restart"].includes(
            input.eventType,
          ) &&
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
        db.prepare(`
          INSERT INTO projection_thread_activities
            (activity_id, thread_id, turn_id, activity_type, payload_json, created_at, last_event_sequence)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(),
          input.threadId,
          input.activeTurnId,
          input.eventType,
          JSON.stringify(input.detail ?? {}),
          new Date().toISOString(),
          sequence,
        );
        return { revision: sequence };
      },
    );
    return result.revision;
  }

  /**
   * Upserts one message learned from a paged provider history read.
   *
   * This operation never removes rows that are absent from the provider page. Existing local
   * identity, author, ordering, delivery, attachments and reactions are retained while provider
   * text/status fields are refreshed. The event contains this one message, so replay has the same
   * non-destructive behavior without rebuilding a full conversation snapshot.
   */
  #upsertProviderHistoryMessage(input: ConversationHistoryWrite): number {
    const eventType = input.eventType ?? "provider-history.message-imported";
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
        const revision = databaseRow(
          this.#core.connection
            .prepare("SELECT last_event_sequence FROM projection_threads WHERE thread_id = ?")
            .get(input.threadId),
        );
        return revision ? requiredNumberColumn(revision, "last_event_sequence") : 0;
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
        const agent = this.#roster.listAgents().find((candidate) => candidate.id === input.agentId);
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
        if (input.message.visibilityEpoch === undefined) delete message.visibilityEpoch;
        if (input.message.visibilityKind === undefined) delete message.visibilityKind;
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
}

function mergeImportedMessage(existing: ConversationMessage, imported: ConversationMessage): ConversationMessage {
  const attachments = mergeValues(existing.attachments, imported.attachments, (attachment) => attachment.id);
  const reactions = mergeValues(existing.reactions, imported.reactions, (reaction) => JSON.stringify(reaction));
  const turnId = existing.turnId ?? imported.turnId;
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
  };
}

function mergeLiveMessage(existing: ConversationMessage, updated: ConversationMessage): ConversationMessage {
  const turnId = updated.turnId ?? existing.turnId;
  const merged = {
    ...existing,
    ...updated,
    id: existing.id,
    author: existing.author,
    createdAt: existing.createdAt,
    ...(turnId === undefined ? {} : { turnId }),
  };
  if (updated.visibilityEpoch === undefined) delete merged.visibilityEpoch;
  if (updated.visibilityKind === undefined) delete merged.visibilityKind;
  return merged;
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

/**
 * Drops the earlier events for a message that is still streaming, so the log holds one event per
 * streaming message instead of one per 100 ms flush.
 *
 * The receipt of each dropped event goes with it. `deleteOrphanReceipts` would find the same rows,
 * but it scans the whole receipts table to do it, and this runs on the flush path - the cost this
 * write path exists to remove. The command ids are read first so each receipt is deleted by key,
 * and the `NOT EXISTS` guard keeps a receipt whose command wrote more than the one event.
 */
function supersedeStreamedMessageEvents(
  db: DatabaseSync,
  threadId: string,
  messageId: string,
  eventType: string,
  retainedSequence: number,
): void {
  // `event_type` is matched before the payload is read on purpose. A thread keeps one whole
  // snapshot, whose payload holds every message, and `json_extract` over it costs as much as the
  // history is long - the very cost this path exists to avoid. The type match rejects that row
  // without parsing it, and leaves only the short streamed-message payloads to read.
  const matchSuperseded = `
    aggregate_type = 'thread' AND aggregate_id = ? AND event_type = ? AND sequence < ?
      AND json_extract(payload_json, '$.streamedMessage.id') = ?`;
  const supersededCommandIds = databaseRows(
    db
      .prepare(`SELECT command_id FROM orchestration_events WHERE ${matchSuperseded}`)
      .all(threadId, eventType, retainedSequence, messageId),
  ).map((row) => requiredStringColumn(row, "command_id"));
  if (supersededCommandIds.length === 0) return;
  db.prepare(`DELETE FROM orchestration_events WHERE ${matchSuperseded}`).run(
    threadId,
    eventType,
    retainedSequence,
    messageId,
  );
  const deleteReceipt = db.prepare(
    `DELETE FROM orchestration_command_receipts
     WHERE command_id = ?
       AND NOT EXISTS (SELECT 1 FROM orchestration_events WHERE command_id = ?)`,
  );
  for (const commandId of supersededCommandIds) deleteReceipt.run(commandId, commandId);
}

function pruneConversationSnapshots(db: DatabaseSync, threadId: string, retainedSequence: number): void {
  // A streamed-message event is superseded by any later whole snapshot exactly as an older snapshot
  // is: the snapshot carries that message's text too. Leaving them would let the flushes of an
  // interrupted turn stay in the log for the life of the thread.
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
  db.prepare(`DELETE FROM orchestration_events WHERE ${supersededEvents}`).run(threadId, retainedSequence);
  deleteOrphanReceipts(db);
}
