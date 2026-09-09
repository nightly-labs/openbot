import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { expandChatTagReferences } from "@openbot/contracts/chat-tag-references";
import {
  CHANNEL_PREVIEW_LIMIT,
  type Channel,
  type ChannelDraft,
  type ChannelMessage,
  type ChannelPage,
  type ChannelSummary,
  type ChannelTask,
  decodeChannel,
  isChannelMessage,
  isChannelTask,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { databaseRow, databaseRows, requiredNumberColumn, requiredStringColumn } from "./database/database-rows";
import type { OpenBotDatabase } from "./openbot-database";

export interface ChannelAssignment {
  id: string;
  channelId: string;
  taskId: string;
  agentId: string;
  taskRevision: number;
  /**
   * The resources this assignment holds, copied from the task when the assignment starts. A task
   * record can change owner and resources while its previous owner still runs, so the task is not
   * a safe place to read a live reservation from.
   */
  resources: string[];
  deliveryId: string | null;
  turnId: string | null;
  state: "queued" | "starting" | "running" | "completed" | "failed" | "interrupted";
  throughSequence: number;
  summaryVersion: number;
  awaitedTaskIds: string[];
  pendingRevision: number | null;
  pendingOutcome: string | null;
}

export interface ChannelContext {
  threadId: string;
  sessionId: string | null;
  throughSequence: number;
  summaryVersion: number;
}

export interface ChannelHistorySummary {
  version: number;
  throughSequence: number;
  text: string;
}

interface ChannelChange {
  channel: Channel;
  messages: ChannelMessage[];
  tasks: ChannelTask[];
  assignments: ChannelAssignment[];
}

/** Owns durable channel records. Every change and its retry receipt commit together. */
export class ChannelStore {
  constructor(readonly database: OpenBotDatabase) {}

  get(channelId: string): Channel {
    const row = databaseRow(
      this.database.connection
        .prepare("SELECT channel_json FROM projection_channels WHERE channel_id = ?")
        .get(channelId),
    );
    if (!row) throw new Error("Channel not found.");
    return decodeChannel(JSON.parse(requiredStringColumn(row, "channel_json")));
  }

  /**
   * Only the ids, in one query. Placing channels in the sidebar layout needs the set of ids that
   * exist - archived ones included, so an archived channel keeps its section - and `list` would
   * read every message of every channel to answer that.
   */
  ids(): string[] {
    return databaseRows(this.database.connection.prepare("SELECT channel_id FROM projection_channels").all()).map(
      (row) => requiredStringColumn(row, "channel_id"),
    );
  }

  /**
   * The archived ids, in one query. An archived channel must not fire a routine and must not wake
   * the shared timer, and `list` would read every message of every channel to answer that.
   */
  archivedIds(): ReadonlySet<string> {
    return new Set(
      databaseRows(
        this.database.connection
          .prepare("SELECT channel_id FROM projection_channels WHERE json_extract(channel_json, '$.archived') = 1")
          .all(),
      ).map((row) => requiredStringColumn(row, "channel_id")),
    );
  }

  list(memberId: string): ChannelSummary[] {
    return databaseRows(
      this.database.connection.prepare("SELECT channel_json FROM projection_channels ORDER BY rowid").all(),
    ).map((row) => {
      const channel = decodeChannel(JSON.parse(requiredStringColumn(row, "channel_json")));
      const through = this.readSequence(channel.id, memberId);
      // `messages` returns ascending order, so the newest entry is last. Read it from the array the
      // unread count already needs rather than running a second query per channel.
      const messages = this.messages(channel.id);
      const latest = messages.at(-1);
      return {
        ...channel,
        unreadCount: messages.filter((message) => message.sequence > through && message.author.id !== memberId).length,
        activeTasks: this.tasks(channel.id).filter((task) => task.state === "running").length,
        lastMessage: latest
          ? { authorName: latest.author.name, text: previewText(latest), at: latest.message.createdAt }
          : null,
      };
    });
  }

  create(channelId: string, draft: ChannelDraft): Channel {
    return { ...draft, id: channelId, archived: false, revision: 0, createdAt: new Date().toISOString() };
  }

  exists(channelId: string): boolean {
    return (
      this.database.connection.prepare("SELECT 1 FROM projection_channels WHERE channel_id = ?").get(channelId) !==
      undefined
    );
  }

  messages(channelId: string, before = Number.MAX_SAFE_INTEGER, limit?: number): ChannelMessage[] {
    const rows = databaseRows(
      this.database.connection
        .prepare(
          "SELECT message_json FROM projection_channel_messages WHERE channel_id = ? AND sequence < ? ORDER BY sequence DESC, message_id DESC LIMIT ?",
        )
        .all(channelId, before, limit ?? -1),
    );
    return rows.reverse().map((row) => {
      const value = JSON.parse(requiredStringColumn(row, "message_json"));
      if (!isChannelMessage(value)) throw new Error("Invalid stored channel message.");
      return value;
    });
  }

  tasks(channelId: string): ChannelTask[] {
    return databaseRows(
      this.database.connection
        .prepare("SELECT task_json FROM projection_channel_tasks WHERE channel_id = ? ORDER BY rowid")
        .all(channelId),
    ).map((row) => {
      const value = JSON.parse(requiredStringColumn(row, "task_json"));
      if (!isChannelTask(value)) throw new Error("Invalid stored channel task.");
      return value;
    });
  }

  assignments(channelId: string): ChannelAssignment[] {
    return databaseRows(
      this.database.connection
        .prepare("SELECT assignment_json FROM projection_channel_assignments WHERE channel_id = ? ORDER BY rowid")
        .all(channelId),
    ).map((row) => decodeAssignment(JSON.parse(requiredStringColumn(row, "assignment_json"))));
  }

  /**
   * Does any channel hold an assignment in one of these states?
   *
   * `mayDrain` asks this on every normal queue check, and it only needs a yes or a no. Walking the
   * channel list to reach it parses every stored message of every channel to build summaries that
   * nothing there reads, so the question is answered by one query over the assignment rows.
   */
  hasAssignmentInState(states: readonly ChannelAssignment["state"][]): boolean {
    if (!states.length) return false;
    const placeholders = states.map(() => "?").join(", ");
    return (
      this.database.connection
        .prepare(
          `SELECT 1 FROM projection_channel_assignments WHERE json_extract(assignment_json, '$.state') IN (${placeholders}) LIMIT 1`,
        )
        .get(...states) !== undefined
    );
  }

  assignmentForDelivery(deliveryId: string): ChannelAssignment | null {
    const row = databaseRow(
      this.database.connection
        .prepare("SELECT assignment_json FROM projection_channel_assignments WHERE delivery_id = ?")
        .get(deliveryId),
    );
    return row ? decodeAssignment(JSON.parse(requiredStringColumn(row, "assignment_json"))) : null;
  }

  page(channelId: string, before?: number): ChannelPage {
    const messages = this.messages(channelId, before, 101);
    const hasOlder = messages.length > 100;
    if (hasOlder) messages.shift();
    return {
      channel: this.get(channelId),
      tasks: this.tasks(channelId),
      messages,
      olderCursor: hasOlder ? (messages[0]?.sequence ?? null) : null,
      throughSequence: this.messages(channelId, undefined, 1)[0]?.sequence ?? 0,
    };
  }

  commit(operationId: string, change: ChannelChange): Channel {
    const commandId = `channels:${operationId}`;
    const previous = this.database.commandResult(commandId);
    if (previous !== undefined) return decodeChannel(previous);
    if (!change.tasks.every(isChannelTask)) throw new Error("Invalid channel task.");
    const channel = { ...change.channel, revision: change.channel.revision + 1 };
    const payload = { ...change, channel };
    return this.database.dispatch(
      commandId,
      [{ aggregateType: "channel", aggregateId: channel.id, eventType: "channel.changed", payload }],
      (db) => {
        this.project(db, payload);
        return channel;
      },
    );
  }

  private project(db: DatabaseSync, change: ChannelChange): void {
    db.prepare(
      "INSERT INTO projection_channels VALUES (?, ?) ON CONFLICT(channel_id) DO UPDATE SET channel_json = excluded.channel_json",
    ).run(change.channel.id, JSON.stringify(change.channel));
    for (const message of change.messages) {
      const existing = databaseRow(
        db
          .prepare("SELECT sequence FROM projection_channel_messages WHERE channel_id = ? AND message_id = ?")
          .get(change.channel.id, message.id),
      );
      const last = databaseRow(
        db
          .prepare(
            "SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM projection_channel_messages WHERE channel_id = ?",
          )
          .get(change.channel.id),
      );
      const assigned = existing
        ? requiredNumberColumn(existing, "sequence")
        : last
          ? requiredNumberColumn(last, "next")
          : 1;
      db.prepare(
        "INSERT INTO projection_channel_messages VALUES (?, ?, ?, ?) ON CONFLICT(channel_id, message_id) DO UPDATE SET message_json = excluded.message_json",
      ).run(change.channel.id, message.id, assigned, JSON.stringify({ ...message, sequence: assigned }));
      if (existing)
        db.prepare(
          "UPDATE projection_channel_summaries SET version = version + 1, through_sequence = 0, text = '' WHERE channel_id = ? AND through_sequence >= ?",
        ).run(change.channel.id, assigned);
    }
    for (const task of change.tasks)
      db.prepare(
        "INSERT INTO projection_channel_tasks VALUES (?, ?, ?) ON CONFLICT(task_id) DO UPDATE SET task_json = excluded.task_json",
      ).run(task.id, change.channel.id, JSON.stringify(task));
    for (const assignment of change.assignments)
      db.prepare(
        "INSERT INTO projection_channel_assignments VALUES (?, ?, ?, ?, ?) ON CONFLICT(assignment_id) DO UPDATE SET delivery_id = excluded.delivery_id, assignment_json = excluded.assignment_json",
      ).run(assignment.id, change.channel.id, assignment.taskId, assignment.deliveryId, JSON.stringify(assignment));
  }

  update(
    channel: Channel,
    changes: Partial<Omit<ChannelChange, "channel">> = {},
    operationId: string = randomUUID(),
  ): Channel {
    return this.commit(operationId, { channel, messages: [], tasks: [], assignments: [], ...changes });
  }

  context(channelId: string, agentId: string): ChannelContext {
    const row = databaseRow(
      this.database.connection
        .prepare("SELECT * FROM projection_channel_contexts WHERE channel_id = ? AND agent_id = ?")
        .get(channelId, agentId),
    );
    if (row)
      return {
        threadId: requiredStringColumn(row, "thread_id"),
        sessionId: isString(row.session_id) ? row.session_id : null,
        throughSequence: requiredNumberColumn(row, "through_sequence"),
        summaryVersion: requiredNumberColumn(row, "summary_version"),
      };
    const threadId = `openbot-thread-${randomUUID()}`;
    return this.database.dispatch(
      `channel-context:${channelId}:${agentId}`,
      [
        {
          aggregateType: "channel",
          aggregateId: channelId,
          eventType: "channel.context-created",
          payload: { agentId, threadId },
        },
      ],
      (db, sequences) => {
        const now = new Date().toISOString();
        db.prepare("INSERT INTO projection_threads VALUES (?, ?, ?, NULL, ?, ?, ?)").run(
          threadId,
          agentId,
          this.get(channelId).name,
          now,
          now,
          sequences[0] ?? 0,
        );
        db.prepare("INSERT INTO projection_channel_contexts(channel_id, agent_id, thread_id) VALUES (?, ?, ?)").run(
          channelId,
          agentId,
          threadId,
        );
        return { threadId, sessionId: null, throughSequence: 0, summaryVersion: 0 };
      },
    );
  }

  executionThreads(): Array<{ id: string; threadId: string }> {
    return databaseRows(
      this.database.connection.prepare("SELECT agent_id, thread_id FROM projection_channel_contexts").all(),
    ).map((row) => ({ id: requiredStringColumn(row, "agent_id"), threadId: requiredStringColumn(row, "thread_id") }));
  }

  contextThreads(channelId: string): string[] {
    return databaseRows(
      this.database.connection
        .prepare("SELECT thread_id FROM projection_channel_contexts WHERE channel_id = ? ORDER BY agent_id")
        .all(channelId),
    ).map((row) => requiredStringColumn(row, "thread_id"));
  }

  /** Permanently removes a channel and its execution threads from every local projection. */
  delete(channelId: string, operationId: string = randomUUID()): void {
    if (!this.exists(channelId)) throw new Error("Channel not found.");
    const threadIds = this.contextThreads(channelId);
    this.database.dispatch(
      `channel-delete:${operationId}`,
      [
        {
          aggregateType: "channel",
          aggregateId: channelId,
          eventType: "channel.deleted",
          payload: { threadIds },
        },
      ],
      (db) => {
        const memoryIds = databaseRows(
          db.prepare("SELECT memory_id FROM projection_channel_memories WHERE channel_id = ?").all(channelId),
        ).map((row) => requiredStringColumn(row, "memory_id"));
        const routineIds = channelRoutineIds(db, channelId);
        deleteAggregateHistory(db, "channel", [channelId]);
        deleteAggregateHistory(db, "channel-memory", memoryIds);
        deleteAggregateHistory(db, "channel-routine", routineIds);
        // Routine run events use the routine id as their aggregate id; one routine can own many runs.
        deleteAggregateHistory(db, "channel-routine-run", routineIds);
        if (routineIds.length) {
          const placeholders = routineIds.map(() => "?").join(", ");
          db.prepare(`DELETE FROM projection_channel_routine_triggers WHERE routine_id IN (${placeholders})`).run(
            ...routineIds,
          );
        }

        for (const table of [
          "projection_channel_contexts",
          "projection_channel_summaries",
          "projection_channel_reads",
          "projection_channel_assignments",
          "projection_channel_tasks",
          "projection_channel_messages",
          "projection_channel_routine_runs",
          "projection_channel_routines",
          "projection_channel_memories",
        ]) {
          db.prepare(`DELETE FROM ${table} WHERE channel_id = ?`).run(channelId);
        }
        db.prepare("DELETE FROM projection_channels WHERE channel_id = ?").run(channelId);

        for (const threadId of threadIds) {
          deleteAggregateHistory(db, "thread", [threadId]);
          db.prepare("DELETE FROM projection_attachments WHERE owner_kind = 'thread-message' AND owner_id LIKE ?").run(
            `${threadId}:%`,
          );
          db.prepare("DELETE FROM projection_threads WHERE thread_id = ?").run(threadId);
        }
        return null;
      },
    );
  }

  channelForThread(threadId: string): string | null {
    const row = databaseRow(
      this.database.connection
        .prepare("SELECT channel_id FROM projection_channel_contexts WHERE thread_id = ?")
        .get(threadId),
    );
    return row ? requiredStringColumn(row, "channel_id") : null;
  }

  acceptContext(
    channelId: string,
    agentId: string,
    sessionId: string,
    throughSequence: number,
    summaryVersion: number,
  ): void {
    this.database.dispatch(
      `channel-context-accepted:${channelId}:${agentId}:${sessionId}:${throughSequence}:${summaryVersion}`,
      [
        {
          aggregateType: "channel",
          aggregateId: channelId,
          eventType: "channel.context-accepted",
          payload: { agentId, sessionId, throughSequence, summaryVersion },
        },
      ],
      (db) => {
        db.prepare(
          "UPDATE projection_channel_contexts SET session_id = ?, through_sequence = ?, summary_version = ? WHERE channel_id = ? AND agent_id = ?",
        ).run(sessionId, throughSequence, summaryVersion, channelId, agentId);
      },
    );
  }

  summary(channelId: string): ChannelHistorySummary {
    const row = databaseRow(
      this.database.connection
        .prepare("SELECT * FROM projection_channel_summaries WHERE channel_id = ?")
        .get(channelId),
    );
    return row
      ? {
          version: requiredNumberColumn(row, "version"),
          throughSequence: requiredNumberColumn(row, "through_sequence"),
          text: requiredStringColumn(row, "text"),
        }
      : { version: 0, throughSequence: 0, text: "" };
  }

  saveSummary(channelId: string, summary: ChannelHistorySummary): void {
    this.database.dispatch(
      `channel-summary:${channelId}:${summary.version}`,
      [{ aggregateType: "channel", aggregateId: channelId, eventType: "channel.summarized", payload: summary }],
      (db) => {
        db.prepare(
          "INSERT INTO projection_channel_summaries VALUES (?, ?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET version = excluded.version, through_sequence = excluded.through_sequence, text = excluded.text",
        ).run(channelId, summary.version, summary.throughSequence, summary.text);
      },
    );
  }

  markRead(channelId: string, memberId: string, throughSequence: number, operationId: string): Channel {
    const maximum = this.page(channelId).throughSequence;
    if (throughSequence > maximum) throw new Error("The read position exceeds the channel history.");
    return this.database.dispatch(
      `channel-read:${memberId}:${operationId}`,
      [
        {
          aggregateType: "channel",
          aggregateId: channelId,
          eventType: "channel.read",
          payload: { memberId, throughSequence },
        },
      ],
      (db) => {
        db.prepare(
          "INSERT INTO projection_channel_reads VALUES (?, ?, ?) ON CONFLICT(channel_id, member_id) DO UPDATE SET through_sequence = MAX(through_sequence, excluded.through_sequence)",
        ).run(channelId, memberId, throughSequence);
        return this.get(channelId);
      },
    );
  }

  /** Rebuilds channel projections from committed events without changing agent threads. */
  rebuild(channelId: string): void {
    const db = this.database.connection;
    db.exec("BEGIN IMMEDIATE");
    try {
      const events = databaseRows(
        db
          .prepare(
            "SELECT event_type, payload_json, occurred_at, sequence FROM orchestration_events WHERE aggregate_type = 'channel' AND aggregate_id = ? ORDER BY sequence",
          )
          .all(channelId),
      );
      for (const table of ["assignments", "tasks", "messages", "summaries", "reads", "contexts", "memories"])
        db.prepare(`DELETE FROM projection_channel_${table} WHERE channel_id = ?`).run(channelId);
      db.prepare("DELETE FROM projection_channels WHERE channel_id = ?").run(channelId);
      for (const event of events) {
        const value = JSON.parse(requiredStringColumn(event, "payload_json"));
        if (!isDynamicRecord(value)) throw new Error("Invalid channel event.");
        switch (event.event_type) {
          case "channel.changed": {
            if (
              !Array.isArray(value.messages) ||
              !value.messages.every(isChannelMessage) ||
              !Array.isArray(value.tasks) ||
              !value.tasks.every(isChannelTask) ||
              !Array.isArray(value.assignments)
            )
              throw new Error("Invalid channel change event.");
            this.project(db, {
              channel: decodeChannel(value.channel),
              messages: value.messages,
              tasks: value.tasks,
              assignments: value.assignments.map(decodeAssignment),
            });
            break;
          }
          case "channel.context-created": {
            if (!isString(value.agentId) || !isString(value.threadId))
              throw new Error("Invalid channel context event.");
            const now = requiredStringColumn(event, "occurred_at");
            db.prepare("INSERT OR IGNORE INTO projection_threads VALUES (?, ?, ?, NULL, ?, ?, ?)").run(
              value.threadId,
              value.agentId,
              this.get(channelId).name,
              now,
              now,
              requiredNumberColumn(event, "sequence"),
            );
            db.prepare("INSERT INTO projection_channel_contexts(channel_id, agent_id, thread_id) VALUES (?, ?, ?)").run(
              channelId,
              value.agentId,
              value.threadId,
            );
            break;
          }
          case "channel.context-accepted": {
            if (
              !isString(value.agentId) ||
              !isString(value.sessionId) ||
              typeof value.throughSequence !== "number" ||
              typeof value.summaryVersion !== "number"
            )
              throw new Error("Invalid context acceptance event.");
            db.prepare(
              "UPDATE projection_channel_contexts SET session_id = ?, through_sequence = ?, summary_version = ? WHERE channel_id = ? AND agent_id = ?",
            ).run(value.sessionId, value.throughSequence, value.summaryVersion, channelId, value.agentId);
            break;
          }
          case "channel.summarized": {
            if (!isString(value.text) || typeof value.version !== "number" || typeof value.throughSequence !== "number")
              throw new Error("Invalid channel summary event.");
            db.prepare("INSERT OR REPLACE INTO projection_channel_summaries VALUES (?, ?, ?, ?)").run(
              channelId,
              value.version,
              value.throughSequence,
              value.text,
            );
            break;
          }
          case "channel.read": {
            if (!isString(value.memberId) || typeof value.throughSequence !== "number")
              throw new Error("Invalid channel read event.");
            db.prepare(
              "INSERT INTO projection_channel_reads VALUES (?, ?, ?) ON CONFLICT(channel_id, member_id) DO UPDATE SET through_sequence = MAX(through_sequence, excluded.through_sequence)",
            ).run(channelId, value.memberId, value.throughSequence);
            break;
          }
          default:
            throw new Error("Unknown channel event.");
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  private readSequence(channelId: string, memberId: string): number {
    const row = databaseRow(
      this.database.connection
        .prepare("SELECT through_sequence FROM projection_channel_reads WHERE channel_id = ? AND member_id = ?")
        .get(channelId, memberId),
    );
    return row ? requiredNumberColumn(row, "through_sequence") : 0;
  }
}

/**
 * Every routine this channel ever owned, not only the ones it owns now.
 *
 * `RoutineStore.delete()` drops the projection row and keeps the event log, so a routine the user
 * deleted before the channel is invisible to `projection_channel_routines`. Its instruction text
 * lives on in the `channel-routine.created` payload, and permanent deletion promises that no such
 * text stays behind. The event log names its owner, and the run rows carry the channel, so the two
 * together cover a routine whichever of them outlived it.
 */
function channelRoutineIds(db: DatabaseSync, channelId: string): string[] {
  const ids = new Set<string>();
  for (const row of databaseRows(
    db
      .prepare(
        `SELECT DISTINCT aggregate_id FROM orchestration_events
         WHERE aggregate_type = 'channel-routine' AND json_extract(payload_json, '$.ownerId') = ?`,
      )
      .all(channelId),
  )) {
    ids.add(requiredStringColumn(row, "aggregate_id"));
  }
  for (const table of ["projection_channel_routines", "projection_channel_routine_runs"]) {
    for (const row of databaseRows(
      db.prepare(`SELECT DISTINCT routine_id FROM ${table} WHERE channel_id = ?`).all(channelId),
    )) {
      ids.add(requiredStringColumn(row, "routine_id"));
    }
  }
  return [...ids];
}

function deleteAggregateHistory(db: DatabaseSync, aggregateType: string, aggregateIds: readonly string[]): void {
  if (!aggregateIds.length) return;
  const placeholders = aggregateIds.map(() => "?").join(", ");
  db.prepare(
    `DELETE FROM orchestration_command_receipts WHERE command_id IN (
       SELECT DISTINCT command_id FROM orchestration_events
       WHERE aggregate_type = ? AND aggregate_id IN (${placeholders})
     )`,
  ).run(aggregateType, ...aggregateIds);
  db.prepare(`DELETE FROM orchestration_events WHERE aggregate_type = ? AND aggregate_id IN (${placeholders})`).run(
    aggregateType,
    ...aggregateIds,
  );
}

/**
 * One line for a sidebar row. A message can carry no text at all (an attachment, or a question
 * the agent asked), so fall back to a description of what arrived instead of showing an empty row.
 */
function previewText(entry: ChannelMessage): string {
  // A stored mention is markup (`@[Chief](agent:chief)`), so render it the way a reader sees it.
  const text = expandChatTagReferences(entry.message.text).trim();
  if (text.length > 0) return text.slice(0, CHANNEL_PREVIEW_LIMIT);
  if (entry.message.questionPrompt) return "Asked a question";
  if (entry.message.attachments?.length) return "Sent an attachment";
  return "Sent a message";
}

function decodeAssignment(value: unknown): ChannelAssignment {
  if (
    !isDynamicRecord(value) ||
    !isString(value.id) ||
    !isString(value.channelId) ||
    !isString(value.taskId) ||
    !isString(value.agentId) ||
    !(value.pendingRevision === null || typeof value.pendingRevision === "number") ||
    !(value.pendingOutcome === null || isString(value.pendingOutcome)) ||
    !Array.isArray(value.awaitedTaskIds) ||
    !value.awaitedTaskIds.every(isString) ||
    typeof value.taskRevision !== "number" ||
    typeof value.throughSequence !== "number" ||
    typeof value.summaryVersion !== "number" ||
    !(value.deliveryId === null || isString(value.deliveryId)) ||
    !(value.turnId === null || isString(value.turnId)) ||
    !(
      value.state === "queued" ||
      value.state === "starting" ||
      value.state === "running" ||
      value.state === "completed" ||
      value.state === "failed" ||
      value.state === "interrupted"
    )
  )
    throw new Error("Invalid stored channel assignment.");
  return {
    id: value.id,
    channelId: value.channelId,
    taskId: value.taskId,
    agentId: value.agentId,
    taskRevision: value.taskRevision,
    // An assignment written before resources were stored reads as a host reservation, which
    // conflicts with every other task. That holds the channel until the assignment ends, rather
    // than letting a second agent take a resource this one may still use.
    resources: Array.isArray(value.resources) && value.resources.every(isString) ? value.resources : ["host"],
    awaitedTaskIds: value.awaitedTaskIds,
    pendingRevision: value.pendingRevision,
    pendingOutcome: value.pendingOutcome,
    throughSequence: value.throughSequence,
    summaryVersion: value.summaryVersion,
    deliveryId: value.deliveryId,
    turnId: value.turnId,
    state: value.state,
  };
}
