import { randomUUID } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { AGENT_TASK_OUTCOMES, type AgentTaskOutcome } from "@openbot/contracts/ipc";
import { type DynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";
import { deleteAggregateHistory, deleteThreadAttachments } from "../database/database-core";
import { databaseRow, databaseRows, optionalStringColumn, requiredStringColumn } from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";

const AGENT_THREAD_ORIGINS = ["user", "agent"] as const;
export type AgentThreadOrigin = (typeof AGENT_THREAD_ORIGINS)[number];

const AGENT_THREAD_TITLE_SOURCES = ["auto", "agent", "user"] as const;
type AgentThreadTitleSource = (typeof AGENT_THREAD_TITLE_SOURCES)[number];

/**
 * A side thread: a second conversation of one agent, with its own thread, next to the agent's own chat.
 *
 * `taskId` is the id that mailbox records, the drain's lanes and `agent-tasks-v1` clients use: the task id
 * of a thread from before migration 47, else the thread id. The two never collide: task ids start with
 * `agent-task-` and thread ids with `openbot-thread-`.
 */
export interface AgentThreadRecord {
  taskId: string;
  agentId: string;
  threadId: string;
  origin: AgentThreadOrigin;
  title: string;
  titleSource: AgentThreadTitleSource;
  /** The end of the last turn. Null before the first turn ends. */
  outcome: AgentTaskOutcome | null;
  /** The redacted provider error of the last failed turn. A new turn clears it. */
  error: string | null;
  createdAt: string;
  updatedAt: string;
  /** An archived thread takes no message until it is restored. */
  closedAt: string | null;
}

export interface AgentThreadInput {
  agentId: string;
  origin: AgentThreadOrigin;
  title: string;
  titleSource: Exclude<AgentThreadTitleSource, "user">;
}

const SELECT_THREAD = "SELECT *, COALESCE(legacy_task_id, thread_id) AS task_id FROM projection_agent_threads";

/**
 * Owns `projection_agent_threads`. It never imports the database facade's callers.
 *
 * A thread creates a row in `projection_threads`, so it goes through `dispatch`, as a messaging link
 * does. Its event payload holds ids only: the event log is append-only and must not keep the title.
 */
export class AgentThreadStore {
  readonly #database: OpenBotDatabase;

  constructor(database: OpenBotDatabase) {
    this.#database = database;
  }

  /** The thread by its task id: the legacy task id, or the thread id of a newer thread. */
  task(taskId: string): AgentThreadRecord | null {
    const row = databaseRow(
      this.#database.connection
        .prepare(`${SELECT_THREAD} WHERE legacy_task_id = ? OR (legacy_task_id IS NULL AND thread_id = ?)`)
        .get(taskId, taskId),
    );
    return row ? decodeThread(row) : null;
  }

  taskForThread(threadId: string): AgentThreadRecord | null {
    const row = databaseRow(this.#database.connection.prepare(`${SELECT_THREAD} WHERE thread_id = ?`).get(threadId));
    return row ? decodeThread(row) : null;
  }

  /** The open threads of this agent first, then the newest archived ones, up to `INPUT_LIMITS.agentTasks`. */
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

  /** The agent id and thread id of every side thread, for boot recovery. */
  executionThreads(): Array<{ id: string; threadId: string }> {
    return databaseRows(
      this.#database.connection.prepare("SELECT agent_id, thread_id FROM projection_agent_threads").all(),
    ).map((row) => ({ id: requiredStringColumn(row, "agent_id"), threadId: requiredStringColumn(row, "thread_id") }));
  }

  /** The agent id and thread id of every open side thread, the newest first. */
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

  /** The task ids of the open threads of this agent, oldest first, so a thread that waits longer starts first. */
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

  /** Creates the side thread and its conversation in one transaction. */
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
              updated_at, archived_at, last_event_sequence)
           VALUES (?, ?, NULL, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?)`,
        ).run(threadId, input.agentId, input.origin, input.title, input.titleSource, now, now, sequence);
        return null;
      },
    );
    const created = this.taskForThread(threadId);
    if (!created) throw new Error("The thread was not stored.");
    return created;
  }

  /** A rename by a person. The title no longer follows the first message. */
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

  /** Records the end of the thread's last turn. */
  setOutcome(taskId: string, outcome: AgentTaskOutcome): void {
    this.#database.connection
      .prepare(`UPDATE projection_agent_threads SET outcome = ?, updated_at = ? WHERE ${BY_TASK_ID}`)
      .run(outcome, new Date().toISOString(), taskId, taskId);
  }

  /** Keeps the error of the thread's last turn, or clears it when a turn starts. */
  setError(taskId: string, error: string | null): void {
    this.#database.connection
      .prepare(`UPDATE projection_agent_threads SET error = ? WHERE ${BY_TASK_ID}`)
      .run(error, taskId, taskId);
  }

  /** Marks new activity, so the thread lists first among its peers. */
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

  /**
   * Removes one side thread with its conversation, attachments and history. The caller stops its turns,
   * cancels its queued messages and releases its provider sessions first.
   */
  delete(taskId: string): void {
    const thread = this.task(taskId);
    if (!thread) return;
    this.#database.dispatch(
      `agent-thread-deleted:${thread.threadId}:${randomUUID()}`,
      // Recorded on the agent: the thread's own history goes below.
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

  /**
   * Removes every side thread of an agent, with the conversations and their history. The caller releases
   * the provider sessions of `threadIdsForAgent` first.
   */
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

const BY_TASK_ID = "(legacy_task_id = ? OR (legacy_task_id IS NULL AND thread_id = ?))";

type Connection = OpenBotDatabase["connection"];

/** The history of a migrated thread is also under its old task aggregate. The thread row takes the side-thread row. */
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
  };
}
