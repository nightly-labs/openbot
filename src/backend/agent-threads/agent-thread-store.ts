import { randomUUID } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_TASK_OUTCOMES,
  type AgentTaskOutcome,
  type AttachmentSummary,
  type ConversationMessage,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { ORDER_KEY_DESC } from "../database/conversation-queries";
import { deleteAggregateHistory, deleteThreadAttachments } from "../database/database-core";
import {
  databaseRow,
  databaseRows,
  decodeConversationMessageJson,
  optionalStringColumn,
  requiredStringColumn,
} from "../database/database-rows";
import { refreshThreadOrder } from "../database/thread-message-order";
import type { OpenBotDatabase } from "../openbot-database";

const AGENT_THREAD_ORIGINS = ["user", "agent"] as const;
export type AgentThreadOrigin = (typeof AGENT_THREAD_ORIGINS)[number];

const AGENT_THREAD_TITLE_SOURCES = ["auto", "agent", "user"] as const;
type AgentThreadTitleSource = (typeof AGENT_THREAD_TITLE_SOURCES)[number];

export interface ThreadListPosition {
  updatedAt: string;
  threadId: string;
}

export interface AgentThreadRecord {
  taskId: string;
  agentId: string;
  threadId: string;
  origin: AgentThreadOrigin;
  title: string;
  titleSource: AgentThreadTitleSource;
  outcome: AgentTaskOutcome | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  branch: AgentThreadBranch | null;
  routineId: string | null;
}

interface AgentThreadBranch {
  sourceThreadId: string;
  sourceMessageId: string;
  throughMessageId: string;
}

export interface AgentThreadBranchInput {
  agentId: string;
  requestId: string;
  threadId: string;
  title: string;
  sourceThreadId: string;
  sourceMessageId: string;
  messages: readonly ConversationMessage[];
}

export interface AgentThreadInput {
  agentId: string;
  origin: AgentThreadOrigin;
  title: string;
  titleSource: Exclude<AgentThreadTitleSource, "user">;
  routineId?: string;
}

const SELECT_THREAD = "SELECT *, COALESCE(legacy_task_id, thread_id) AS task_id FROM projection_agent_threads";

export class AgentThreadStore {
  readonly #database: OpenBotDatabase;

  constructor(database: OpenBotDatabase) {
    this.#database = database;
  }

  task(taskId: string): AgentThreadRecord | null {
    const row = databaseRow(
      this.#database.connection
        .prepare(`${SELECT_THREAD} WHERE legacy_task_id = ? OR (legacy_task_id IS NULL AND thread_id = ?)`)
        .get(taskId, taskId),
    );
    return row ? decodeThread(row) : null;
  }

  threadForRoutine(agentId: string, routineId: string): AgentThreadRecord | null {
    const row = databaseRow(
      this.#database.connection
        .prepare(`${SELECT_THREAD} WHERE agent_id = ? AND routine_id = ?`)
        .get(agentId, routineId),
    );
    return row ? decodeThread(row) : null;
  }

  taskForThread(threadId: string): AgentThreadRecord | null {
    const row = databaseRow(this.#database.connection.prepare(`${SELECT_THREAD} WHERE thread_id = ?`).get(threadId));
    return row ? decodeThread(row) : null;
  }

  list(agentId: string): AgentThreadRecord[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `${SELECT_THREAD} WHERE agent_id = ?
           ORDER BY archived_at IS NOT NULL, updated_at DESC, thread_id LIMIT ?`,
        )
        .all(agentId, INPUT_LIMITS.agentTasks),
    ).map(decodeThread);
  }

  recent(
    agentId: string,
    after: string | null,
    limit: number,
    last: ThreadListPosition | null = null,
  ): AgentThreadRecord[] {
    const lastUpdatedAt = last?.updatedAt ?? null;
    return databaseRows(
      this.#database.connection
        .prepare(
          `${SELECT_THREAD} WHERE agent_id = ? AND (? IS NULL OR updated_at >= ?)
           AND (? IS NULL OR updated_at < ? OR (updated_at = ? AND thread_id > ?))
           ORDER BY updated_at DESC, thread_id LIMIT ?`,
        )
        .all(agentId, after, after, lastUpdatedAt, lastUpdatedAt, lastUpdatedAt, last?.threadId ?? null, limit),
    ).map(decodeThread);
  }

  executionThreads(): Array<{ id: string; threadId: string }> {
    return databaseRows(
      this.#database.connection.prepare("SELECT agent_id, thread_id FROM projection_agent_threads").all(),
    ).map((row) => ({ id: requiredStringColumn(row, "agent_id"), threadId: requiredStringColumn(row, "thread_id") }));
  }

  openExecutionThreads(): Array<{ id: string; threadId: string }> {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT agent_id, thread_id FROM projection_agent_threads
           WHERE archived_at IS NULL ORDER BY updated_at DESC, thread_id`,
        )
        .all(),
    ).map((row) => ({ id: requiredStringColumn(row, "agent_id"), threadId: requiredStringColumn(row, "thread_id") }));
  }

  openTaskIds(agentId: string): string[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT COALESCE(legacy_task_id, thread_id) AS task_id FROM projection_agent_threads
           WHERE agent_id = ? AND archived_at IS NULL ORDER BY created_at, thread_id`,
        )
        .all(agentId),
    ).map((row) => requiredStringColumn(row, "task_id"));
  }

  taskIdsForAgent(agentId: string): string[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          "SELECT COALESCE(legacy_task_id, thread_id) AS task_id FROM projection_agent_threads WHERE agent_id = ?",
        )
        .all(agentId),
    ).map((row) => requiredStringColumn(row, "task_id"));
  }

  threadIdsForAgent(agentId: string): string[] {
    return databaseRows(
      this.#database.connection
        .prepare("SELECT thread_id FROM projection_agent_threads WHERE agent_id = ?")
        .all(agentId),
    ).map((row) => requiredStringColumn(row, "thread_id"));
  }

  titles(agentId: string): string[] {
    return databaseRows(
      this.#database.connection.prepare("SELECT title FROM projection_agent_threads WHERE agent_id = ?").all(agentId),
    ).map((row) => requiredStringColumn(row, "title"));
  }

  branchFor(agentId: string, requestId: string): AgentThreadRecord | null {
    const result = this.#database.commandResult(branchCommandId(agentId, requestId));
    if (!isDynamicRecord(result) || !isString(result.threadId)) return null;
    const thread = this.taskForThread(result.threadId);
    return thread?.agentId === agentId ? thread : null;
  }

  branchSource(threadId: string, messageId: string): ConversationMessage[] | null {
    const db = this.#database.connection;
    const chosen = databaseRow(
      db
        .prepare(
          `SELECT 1 FROM projection_thread_messages
           WHERE thread_id = ? AND message_id = ? AND author = 'assistant' AND status != 'streaming'
             AND group_start IS NOT NULL`,
        )
        .get(threadId, messageId),
    );
    if (!chosen) return null;
    const rows = databaseRows(
      db
        .prepare(
          `SELECT message.message_json FROM projection_thread_messages AS message
           JOIN projection_thread_messages AS chosen ON chosen.thread_id = message.thread_id AND chosen.message_id = ?
           WHERE message.thread_id = ?
             AND (message.group_start, message.group_first, message.group_id)
               <= (chosen.group_start, chosen.group_first, chosen.group_id)
           ORDER BY message.ordinal, message.message_id`,
        )
        .all(messageId, threadId),
    );
    return rows.map((row) => decodeConversationMessageJson(requiredStringColumn(row, "message_json")));
  }

  branch(input: AgentThreadBranchInput): AgentThreadRecord {
    const result = this.#database.dispatch(
      branchCommandId(input.agentId, input.requestId),
      [
        {
          aggregateType: "agent-thread",
          aggregateId: input.threadId,
          eventType: "agent-thread.branched",
          payload: {
            agentId: input.agentId,
            origin: "user",
            sourceThreadId: input.sourceThreadId,
            sourceMessageId: input.sourceMessageId,
          },
        },
        {
          aggregateType: "thread",
          aggregateId: input.threadId,
          eventType: "thread.branched",
          payload: {
            detail: { sourceThreadId: input.sourceThreadId, sourceMessageId: input.sourceMessageId },
            snapshot: {
              agentId: input.agentId,
              threadId: input.threadId,
              activeTurnId: null,
              revision: 0,
              messages: input.messages,
            },
            recovery: { turnProviderSessionIds: {} },
          },
        },
      ],
      (db, sequences) => {
        const now = new Date().toISOString();
        const threadSequence = sequences[0] ?? 0;
        const conversationSequence = sequences[1] ?? threadSequence;
        db.prepare("INSERT INTO projection_threads VALUES (?, ?, ?, NULL, ?, ?, ?)").run(
          input.threadId,
          input.agentId,
          input.title,
          now,
          now,
          conversationSequence,
        );
        const insertMessage = db.prepare(`
          INSERT INTO projection_thread_messages (
            thread_id, message_id, turn_id, author, status, item_type, created_at,
            ordinal, message_json, last_event_sequence
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertAttachment = db.prepare(`
          INSERT INTO projection_attachments
            (attachment_id, owner_kind, owner_id, name, path, metadata_json, created_at, last_event_sequence)
          VALUES (?, 'thread-message', ?, ?, '', ?, ?, ?)
        `);
        input.messages.forEach((message, ordinal) => {
          insertMessage.run(
            input.threadId,
            message.id,
            message.turnId ?? null,
            message.author,
            message.status,
            message.itemType ?? null,
            message.createdAt,
            ordinal,
            JSON.stringify(message),
            conversationSequence,
          );
          for (const attachment of message.attachments ?? []) {
            insertAttachment.run(
              `${input.threadId}:${message.id}:${attachment.id}`,
              `${input.threadId}:${message.id}`,
              attachment.name,
              JSON.stringify(attachment),
              message.createdAt,
              conversationSequence,
            );
          }
        });
        refreshThreadOrder(db, input.threadId);
        const last = databaseRow(
          db
            .prepare(
              `SELECT message_id FROM projection_thread_messages WHERE thread_id = ? ORDER BY ${ORDER_KEY_DESC} LIMIT 1`,
            )
            .get(input.threadId),
        );
        if (!last) throw new Error("A branch needs at least one message.");
        db.prepare(
          `INSERT INTO projection_agent_threads
             (thread_id, agent_id, legacy_task_id, origin, title, title_source, outcome, error, created_at,
              updated_at, archived_at, last_event_sequence, branch_source_thread_id, branch_source_message_id,
              branch_through_message_id)
           VALUES (?, ?, NULL, 'user', ?, 'auto', NULL, NULL, ?, ?, NULL, ?, ?, ?, ?)`,
        ).run(
          input.threadId,
          input.agentId,
          input.title,
          now,
          now,
          threadSequence,
          input.sourceThreadId,
          input.sourceMessageId,
          requiredStringColumn(last, "message_id"),
        );
        return { threadId: input.threadId };
      },
    );
    const created = this.taskForThread(result.threadId);
    if (!created) throw new Error("The branch was not stored.");
    return created;
  }

  create(input: AgentThreadInput): AgentThreadRecord {
    const threadId = `openbot-thread-${randomUUID()}`;
    this.#database.dispatch(
      `agent-thread:${threadId}`,
      [
        {
          aggregateType: "agent-thread",
          aggregateId: threadId,
          eventType: "agent-thread.created",
          payload: { agentId: input.agentId, origin: input.origin },
        },
      ],
      (db, sequences) => {
        const now = new Date().toISOString();
        const sequence = sequences[0] ?? 0;
        db.prepare("INSERT INTO projection_threads VALUES (?, ?, ?, NULL, ?, ?, ?)").run(
          threadId,
          input.agentId,
          input.title,
          now,
          now,
          sequence,
        );
        db.prepare(
          `INSERT INTO projection_agent_threads
             (thread_id, agent_id, legacy_task_id, origin, title, title_source, outcome, error, created_at,
              updated_at, archived_at, last_event_sequence, routine_id)
           VALUES (?, ?, NULL, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?, ?)`,
        ).run(
          threadId,
          input.agentId,
          input.origin,
          input.title,
          input.titleSource,
          now,
          now,
          sequence,
          input.routineId ?? null,
        );
        return null;
      },
    );
    const created = this.taskForThread(threadId);
    if (!created) throw new Error("The thread was not stored.");
    return created;
  }

  rename(threadId: string, title: string): void {
    this.#database.dispatch(
      `agent-thread-renamed:${threadId}:${randomUUID()}`,
      [{ aggregateType: "agent-thread", aggregateId: threadId, eventType: "agent-thread.renamed", payload: {} }],
      (db, sequences) => {
        db.prepare(
          `UPDATE projection_agent_threads SET title = ?, title_source = 'user', last_event_sequence = ?
           WHERE thread_id = ?`,
        ).run(title, sequences[0] ?? 0, threadId);
        return null;
      },
    );
  }

  retitle(threadId: string, title: string): void {
    this.#database.dispatch(
      `agent-thread-retitled:${threadId}:${randomUUID()}`,
      [{ aggregateType: "agent-thread", aggregateId: threadId, eventType: "agent-thread.renamed", payload: {} }],
      (db, sequences) => {
        db.prepare(
          `UPDATE projection_agent_threads SET title = ?, last_event_sequence = ?
           WHERE thread_id = ? AND title_source <> 'user'`,
        ).run(title, sequences[0] ?? 0, threadId);
        return null;
      },
    );
  }

  setOutcome(taskId: string, outcome: AgentTaskOutcome): void {
    this.#database.connection
      .prepare(`UPDATE projection_agent_threads SET outcome = ?, updated_at = ? WHERE ${BY_TASK_ID}`)
      .run(outcome, new Date().toISOString(), taskId, taskId);
  }

  setError(taskId: string, error: string | null): void {
    this.#database.connection
      .prepare(`UPDATE projection_agent_threads SET error = ? WHERE ${BY_TASK_ID}`)
      .run(error, taskId, taskId);
  }

  touch(taskId: string): void {
    this.#database.connection
      .prepare(`UPDATE projection_agent_threads SET updated_at = ? WHERE ${BY_TASK_ID}`)
      .run(new Date().toISOString(), taskId, taskId);
  }

  close(taskId: string): void {
    const now = new Date().toISOString();
    this.#database.connection
      .prepare(
        `UPDATE projection_agent_threads SET archived_at = ?, updated_at = ? WHERE ${BY_TASK_ID} AND archived_at IS NULL`,
      )
      .run(now, now, taskId, taskId);
  }

  reopen(taskId: string): void {
    this.#database.connection
      .prepare(`UPDATE projection_agent_threads SET archived_at = NULL, updated_at = ? WHERE ${BY_TASK_ID}`)
      .run(new Date().toISOString(), taskId, taskId);
  }

  delete(taskId: string): void {
    const thread = this.task(taskId);
    if (!thread) return;
    this.#database.dispatch(
      `agent-thread-deleted:${thread.threadId}:${randomUUID()}`,
      [
        {
          aggregateType: "agent-threads",
          aggregateId: thread.agentId,
          eventType: "agent-thread.deleted",
          payload: { threadIds: [thread.threadId] },
        },
      ],
      (db) => {
        deleteThreadRows(db, [thread]);
        return null;
      },
    );
  }

  deleteForAgent(agentId: string): void {
    const threads = databaseRows(
      this.#database.connection.prepare(`${SELECT_THREAD} WHERE agent_id = ?`).all(agentId),
    ).map(decodeThread);
    if (threads.length === 0) return;
    this.#database.dispatch(
      `agent-threads-deleted:${agentId}:${randomUUID()}`,
      [
        {
          aggregateType: "agent-threads",
          aggregateId: agentId,
          eventType: "agent-thread.agent-deleted",
          payload: { threadIds: threads.map((thread) => thread.threadId) },
        },
      ],
      (db) => {
        deleteThreadRows(db, threads);
        return null;
      },
    );
  }
}

function branchCommandId(agentId: string, requestId: string): string {
  return `agent-thread-branch:${agentId}:${requestId}`;
}

export function copyBranchMessages(
  messages: readonly ConversationMessage[],
  files: ReadonlyMap<string, AttachmentSummary>,
): ConversationMessage[] {
  const ids = new Map(messages.map((message) => [message.id, randomUUID()]));
  const file = (attachment: AttachmentSummary) => files.get(attachment.id) ?? attachment;
  return messages.map((message) => {
    const { delivery: _delivery, reaction: _reaction, reactions: _reactions, replyToMessageId, ...copy } = message;
    const replyTo = replyToMessageId ? ids.get(replyToMessageId) : undefined;
    return {
      ...structuredClone(copy),
      id: ids.get(message.id) ?? message.id,
      ...(replyTo ? { replyToMessageId: replyTo } : {}),
      ...(message.attachments ? { attachments: message.attachments.map(file) } : {}),
      ...(message.voiceRecording ? { voiceRecording: file(message.voiceRecording) } : {}),
    };
  });
}

const BY_TASK_ID = "(legacy_task_id = ? OR (legacy_task_id IS NULL AND thread_id = ?))";

type Connection = OpenBotDatabase["connection"];

function deleteThreadRows(db: Connection, threads: readonly AgentThreadRecord[]): void {
  deleteAggregateHistory(
    db,
    "agent-task",
    threads.filter((thread) => thread.taskId !== thread.threadId).map((thread) => thread.taskId),
  );
  deleteAggregateHistory(
    db,
    "agent-thread",
    threads.map((thread) => thread.threadId),
  );
  for (const { threadId } of threads) {
    deleteAggregateHistory(db, "thread", [threadId]);
    deleteThreadAttachments(db, threadId);
    db.prepare("DELETE FROM projection_threads WHERE thread_id = ?").run(threadId);
  }
}

function decodeThread(row: DynamicRecord): AgentThreadRecord {
  const origin = requiredStringColumn(row, "origin");
  const titleSource = requiredStringColumn(row, "title_source");
  const outcome = optionalStringColumn(row, "outcome");
  const sourceThreadId = optionalStringColumn(row, "branch_source_thread_id");
  const sourceMessageId = optionalStringColumn(row, "branch_source_message_id");
  const throughMessageId = optionalStringColumn(row, "branch_through_message_id");
  const branchColumns = [sourceThreadId, sourceMessageId, throughMessageId].filter((value) => value !== null).length;
  if (branchColumns !== 0 && branchColumns !== 3) throw new Error("Incomplete branch link.");
  if (!isOneOf(AGENT_THREAD_ORIGINS, origin)) throw new Error(`Unknown thread origin: ${origin}`);
  if (!isOneOf(AGENT_THREAD_TITLE_SOURCES, titleSource)) throw new Error(`Unknown title source: ${titleSource}`);
  if (outcome !== null && !isOneOf(AGENT_TASK_OUTCOMES, outcome)) throw new Error(`Unknown thread outcome: ${outcome}`);
  return {
    taskId: requiredStringColumn(row, "task_id"),
    agentId: requiredStringColumn(row, "agent_id"),
    threadId: requiredStringColumn(row, "thread_id"),
    origin,
    title: requiredStringColumn(row, "title"),
    titleSource,
    outcome,
    error: optionalStringColumn(row, "error"),
    createdAt: requiredStringColumn(row, "created_at"),
    updatedAt: requiredStringColumn(row, "updated_at"),
    closedAt: optionalStringColumn(row, "archived_at"),
    branch:
      sourceThreadId !== null && sourceMessageId !== null && throughMessageId !== null
        ? { sourceThreadId, sourceMessageId, throughMessageId }
        : null,
    routineId: optionalStringColumn(row, "routine_id"),
  };
}
