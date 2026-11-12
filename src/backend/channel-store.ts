import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  CHANNEL_PREVIEW_LIMIT,
  CHANNEL_ROUTING_EVENT_ITEM_TYPE_PREFIX,
  type Channel,
  type ChannelDraft,
  type ChannelMessage,
  type ChannelPage,
  type ChannelSummary,
  type ChannelTask,
  type ChannelThread,
  CONTEXT_RESET_ITEM_TYPE,
  decodeChannel,
  isChannelMessage,
  isChannelTask,
  SIGNED_OUT_CHANNEL_MEMBER_ID,
  withBrowserMember,
} from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { changesModelContent } from "./channel-history";
import { deleteAggregateHistory, deleteReceiptsOf, deleteThreadAttachments } from "./database/database-core";
import {
  databaseRow,
  databaseRows,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "./database/database-rows";
import type { OpenBotDatabase } from "./openbot-database";
import { revokeRoutineWebhooks } from "./webhook-route-store";

/**
 * A message that a person deleted keeps its row, with its id, sequence and author but no content,
 * so that read, summary and context cursors stay correct. Every read skips it.
 */
const SHOWN_MESSAGE_SQL = "json_extract(message_json, '$.deleted') IS NOT 1";

/** The row that replaces a deleted channel message. `deleted` is internal and never sent. */
function deletedChannelMessage(entry: ChannelMessage): ChannelMessage & { deleted: true } {
  return {
    id: entry.id,
    channelId: entry.channelId,
    sequence: entry.sequence,
    author: entry.author,
    taskId: entry.taskId,
    superseded: entry.superseded,
    deleted: true,
    message: {
      id: entry.message.id,
      author: entry.message.author,
      text: "",
      createdAt: entry.message.createdAt,
      status: "completed",
    },
  };
}

function isDeletedChannelMessage(entry: ChannelMessage): boolean {
  return isDynamicRecord(entry) && entry.deleted === true;
}

export interface ChannelAssignment {
  id: string;
  channelId: string;
  taskId: string;
  agentId: string;
  taskRevision: number;
  /**
   * The request the task served when this assignment started. A task can be reused for a newer
   * request, so its id alone does not tie an assignment to the request it worked on. Null for an
   * assignment written before this was stored.
   */
  requestMessageId: string | null;
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

/**
 * Owns durable channel records. Every change and its retry receipt commit together.
 */
export class ChannelStore {
  /** By channel: how many times a message changed in place after it was complete, in this process. */
  readonly #completedMessageChanges = new Map<string, number>();

  constructor(readonly database: OpenBotDatabase) {}

  /** A packet built before this count changed can show a message as it was before. */
  completedMessageChanges(channelId: string): number {
    return this.#completedMessageChanges.get(channelId) ?? 0;
  }

  get(channelId: string): Channel {
    const row = databaseRow(
      this.database.connection
        .prepare("SELECT channel_json FROM projection_channels WHERE channel_id = ?")
        .get(channelId),
    );
    if (!row) throw new Error(sourceText("error.backend.channelNotFound"));
    return decodeChannel(JSON.parse(requiredStringColumn(row, "channel_json")));
  }

  /**
   * Only the ids, in one query. Placing channels in the sidebar layout needs the set of ids that
   * exist - archived ones included, so an archived channel keeps its section - and the scheduler
   * works by id as well. `list` would read every message of every channel to answer either. The order
   * is the order of `list`: the layout places the channels it has no order for in it, as the sidebar does.
   */
  ids(): string[] {
    return databaseRows(
      this.database.connection.prepare("SELECT channel_id FROM projection_channels ORDER BY rowid").all(),
    ).map((row) => requiredStringColumn(row, "channel_id"));
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

  /**
   * @param signedOutMessagesAreTheirs true only when `memberId` is the host user of this computer.
   * Their messages from before they signed in carry `SIGNED_OUT_CHANNEL_MEMBER_ID`, so those
   * messages are their own and are never unread for them. A remote member is a different person:
   * the host's signed-out messages are unread for them until they read them.
   */
  list(memberId: string, signedOutMessagesAreTheirs = false): ChannelSummary[] {
    // The sidebar is rebuilt on every `channels-changed`, and a streaming reply emits those while
    // it arrives. One query returns every summary: the previous per-channel latest-message, unread,
    // and task queries made this O(channels x queries) per stream frame. A member's thinking is not
    // unread, as in an agent chat: it folds into the steps of the member's answer.
    const excludedId = signedOutMessagesAreTheirs ? SIGNED_OUT_CHANNEL_MEMBER_ID : memberId;
    const rows = databaseRows(
      this.database.connection
        .prepare(
          `SELECT c.channel_json AS channel_json,
            (SELECT m.message_json FROM projection_channel_messages AS m
              WHERE m.channel_id = c.channel_id
                AND ${SHOWN_MESSAGE_SQL.replaceAll("message_json", "m.message_json")}
                AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'plan'
                AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'subagents'
              ORDER BY m.sequence DESC, m.message_id DESC LIMIT 1) AS latest_json,
            (SELECT COUNT(*) FROM projection_channel_messages AS m
              WHERE m.channel_id = c.channel_id
                AND m.sequence > COALESCE(
                  (SELECT r.through_sequence FROM projection_channel_reads AS r
                    WHERE r.channel_id = c.channel_id AND r.member_id = ?), 0)
                AND ${SHOWN_MESSAGE_SQL.replaceAll("message_json", "m.message_json")}
                AND json_extract(m.message_json, '$.author.id') IS NOT ?
                AND json_extract(m.message_json, '$.author.id') IS NOT ?
                AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'plan'
                AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'subagents'
                AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'channel-change'
                AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'context-reset'
                AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'commentary'
                AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') NOT LIKE ?) AS unread,
            (SELECT COUNT(*) FROM projection_channel_tasks AS t
              WHERE t.channel_id = c.channel_id
                AND json_extract(t.task_json, '$.state') = 'running') AS running,
            (SELECT COUNT(*) FROM projection_channel_tasks AS t
              WHERE t.channel_id = c.channel_id
                AND json_extract(t.task_json, '$.state') IN ('queued', 'waiting', 'running')) AS open
            FROM projection_channels AS c ORDER BY c.rowid`,
        )
        .all(memberId, memberId, excludedId, `${CHANNEL_ROUTING_EVENT_ITEM_TYPE_PREFIX}%`),
    );
    const threads = new Map<string, ChannelThread[]>();
    for (const row of databaseRows(
      this.database.connection
        .prepare(
          "SELECT channel_id, agent_id, thread_id FROM projection_channel_contexts ORDER BY channel_id, agent_id",
        )
        .all(),
    )) {
      const channelId = requiredStringColumn(row, "channel_id");
      const thread = {
        agentId: requiredStringColumn(row, "agent_id"),
        threadId: requiredStringColumn(row, "thread_id"),
      };
      threads.set(channelId, [...(threads.get(channelId) ?? []), thread]);
    }
    return rows.map((row) => {
      const channel = decodeChannel(JSON.parse(requiredStringColumn(row, "channel_json")));
      const latestJson = row.latest_json;
      const latest =
        typeof latestJson === "string" && latestJson.length > 0
          ? (() => {
              const value = JSON.parse(latestJson);
              if (!isChannelMessage(value)) throw new Error("Invalid stored channel message.");
              return value;
            })()
          : undefined;
      return {
        ...channel,
        unreadCount: Number(row.unread ?? 0),
        activeTasks: Number(row.running ?? 0),
        openTasks: Number(row.open ?? 0),
        lastMessage: latest
          ? {
              authorName: latest.author.name,
              author: { kind: latest.author.kind, id: latest.author.id },
              status: latest.message.status,
              text: previewText(latest),
              at: latest.message.createdAt,
            }
          : null,
        // A former member keeps its thread, but its prompts are no longer the channel's. The members
        // are at most 100, which is the bound of channel-attention-v1.
        threads: (threads.get(channel.id) ?? []).filter((thread) =>
          channel.members.some((item) => item.agentId === thread.agentId),
        ),
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
          `SELECT message_json FROM projection_channel_messages WHERE channel_id = ? AND sequence < ? AND ${SHOWN_MESSAGE_SQL} ORDER BY sequence DESC, message_id DESC LIMIT ?`,
        )
        .all(channelId, before, limit ?? -1),
    );
    return rows.reverse().map((row) => {
      const value = JSON.parse(requiredStringColumn(row, "message_json"));
      if (!isChannelMessage(value)) throw new Error("Invalid stored channel message.");
      return value;
    });
  }

  /** One message by id, read through the primary key rather than the whole history. A deleted message is null. */
  message(channelId: string, messageId: string): ChannelMessage | null {
    const row = databaseRow(
      this.database.connection
        .prepare(
          `SELECT message_json FROM projection_channel_messages WHERE channel_id = ? AND message_id = ? AND ${SHOWN_MESSAGE_SQL}`,
        )
        .get(channelId, messageId),
    );
    if (!row) return null;
    const value = JSON.parse(requiredStringColumn(row, "message_json"));
    if (!isChannelMessage(value)) throw new Error("Invalid stored channel message.");
    return value;
  }

  /** One task by id, read through the primary key rather than every task of the channel. */
  task(channelId: string, taskId: string): ChannelTask | null {
    const row = databaseRow(
      this.database.connection
        .prepare("SELECT task_json FROM projection_channel_tasks WHERE channel_id = ? AND task_id = ?")
        .get(channelId, taskId),
    );
    if (!row) return null;
    const value = JSON.parse(requiredStringColumn(row, "task_json"));
    if (!isChannelTask(value)) throw new Error("Invalid stored channel task.");
    return value;
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
   * Walking the channel list to answer this parses every stored message of every channel to build
   * summaries that nothing here reads, so the question is answered by one query over the
   * assignment rows.
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

  /** `hasAssignmentInState` for the assignments of one agent. `mayDrain` asks this on every queue check. */
  hasAgentAssignmentInState(agentId: string, states: readonly ChannelAssignment["state"][]): boolean {
    if (!states.length) return false;
    const placeholders = states.map(() => "?").join(", ");
    return (
      this.database.connection
        .prepare(
          `SELECT 1 FROM projection_channel_assignments
            WHERE json_extract(assignment_json, '$.agentId') = ?
              AND json_extract(assignment_json, '$.state') IN (${placeholders}) LIMIT 1`,
        )
        .get(agentId, ...states) !== undefined
    );
  }

  /**
   * The assignment of this agent that holds its queue right now, with the channel it belongs to.
   *
   * `hasAgentAssignmentInState` answers the drain question with a yes or a no; the queue the user
   * reads has to name the cause as well. The same reason keeps this to one query: reaching a
   * channel through `list` parses every stored message of every channel. States are tried in the
   * order given, so a running assignment is reported before one that is only queued.
   */
  agentAssignment(
    agentId: string,
    states: readonly ChannelAssignment["state"][],
  ): { assignment: ChannelAssignment; channel: Channel } | null {
    if (!states.length) return null;
    const placeholders = states.map(() => "?").join(", ");
    const ranking = states.map((_, index) => `WHEN ? THEN ${index}`).join(" ");
    const row = databaseRow(
      this.database.connection
        .prepare(
          `SELECT assignments.assignment_json AS assignment_json, channels.channel_json AS channel_json
             FROM projection_channel_assignments AS assignments
             JOIN projection_channels AS channels ON channels.channel_id = assignments.channel_id
            WHERE json_extract(assignments.assignment_json, '$.agentId') = ?
              AND json_extract(assignments.assignment_json, '$.state') IN (${placeholders})
            ORDER BY CASE json_extract(assignments.assignment_json, '$.state') ${ranking} END,
                     assignments.rowid
            LIMIT 1`,
        )
        .get(agentId, ...states, ...states),
    );
    if (!row) return null;
    return {
      assignment: decodeAssignment(JSON.parse(requiredStringColumn(row, "assignment_json"))),
      channel: decodeChannel(JSON.parse(requiredStringColumn(row, "channel_json"))),
    };
  }

  assignmentForDelivery(deliveryId: string): ChannelAssignment | null {
    const row = databaseRow(
      this.database.connection
        .prepare("SELECT assignment_json FROM projection_channel_assignments WHERE delivery_id = ?")
        .get(deliveryId),
    );
    return row ? decodeAssignment(JSON.parse(requiredStringColumn(row, "assignment_json"))) : null;
  }

  page(channelId: string, before?: number, limit = 100): ChannelPage {
    const messages = this.messages(channelId, before, limit + 1);
    const hasOlder = messages.length > limit;
    if (hasOlder) messages.shift();
    const olderCursor = hasOlder ? (messages[0]?.sequence ?? null) : null;
    return {
      channel: this.get(channelId),
      tasks: this.tasks(channelId),
      messages,
      olderCursor,
      throughSequence: this.messages(channelId, undefined, 1)[0]?.sequence ?? 0,
      ...(olderCursor === null ? {} : this.olderExtent(channelId, olderCursor)),
    };
  }

  /**
   * `tasks` with the dependencies that each waiting task already read: the `awaitedTaskIds` of its
   * turns, whose results the turn had when it started. A lead that assigns work in rounds keeps every
   * sub-task in `dependencies`, so the page shows only the round it waits for (#7505). Only the views
   * of a person read it; the agent's channel history does not.
   */
  withSeenDependencies(channelId: string, tasks: ChannelTask[]): ChannelTask[] {
    if (!tasks.some((task) => task.state === "waiting")) return tasks;
    // The rows are in the order the assignments started, because an update keeps its row.
    const started = new Map<string, number>();
    const readAt = new Map<string, Map<string, number>>();
    this.assignments(channelId).forEach((assignment, order) => {
      started.set(assignment.taskId, order);
      const read = readAt.get(assignment.taskId) ?? new Map<string, number>();
      for (const id of assignment.awaitedTaskIds) read.set(id, order);
      readAt.set(assignment.taskId, read);
    });
    return tasks.map((task) => {
      if (task.state !== "waiting") return task;
      // A dependency that ran again after the turn that read it, as after Reassign, has a new result.
      const seenDependencies = task.dependencies.filter((id) => {
        const at = readAt.get(task.id)?.get(id);
        return at !== undefined && (started.get(id) ?? -1) < at;
      });
      return seenDependencies.length ? { ...task, seenDependencies } : task;
    });
  }

  /**
   * How many messages are older than a page, and when the first one was written: the day rail draws
   * the unloaded part from it. The time is only in the message JSON, so only the oldest row is read.
   */
  private olderExtent(channelId: string, before: number): { olderCount: number; oldestAt?: string } {
    const row = databaseRow(
      this.database.connection
        .prepare(
          `SELECT COUNT(*) AS older_count,
             (SELECT json_extract(message_json, '$.message.createdAt') FROM projection_channel_messages
              WHERE channel_id = ? AND ${SHOWN_MESSAGE_SQL} ORDER BY sequence LIMIT 1) AS oldest_at
           FROM projection_channel_messages WHERE channel_id = ? AND sequence < ? AND ${SHOWN_MESSAGE_SQL}`,
        )
        .get(channelId, channelId, before),
    );
    const oldestAt = row ? optionalStringColumn(row, "oldest_at") : null;
    return { olderCount: row ? requiredNumberColumn(row, "older_count") : 0, ...(oldestAt ? { oldestAt } : {}) };
  }

  commit(operationId: string, change: ChannelChange, written?: (db: DatabaseSync, sequence: number) => void): Channel {
    const commandId = `channels:${operationId}`;
    const previous = this.database.commandResult(commandId);
    if (previous !== undefined) return decodeChannel(previous);
    if (!change.tasks.every(isChannelTask)) throw new Error("Invalid channel task.");
    // A browser member that leaves the channel takes the browser with it: no member gets it in its
    // place, as the setting limits access.
    const channel = { ...withBrowserMember(change.channel), revision: change.channel.revision + 1 };
    // A late write of a deleted message must not keep its text in the event history either.
    const deleted = this.database.connection.prepare(
      "SELECT 1 FROM projection_channel_messages WHERE channel_id = ? AND message_id = ? AND json_extract(message_json, '$.deleted') = 1",
    );
    const messages = change.messages.filter(
      (message) => isDeletedChannelMessage(message) || deleted.get(channel.id, message.id) === undefined,
    );
    const payload = { ...change, channel, messages };
    return this.database.dispatch(
      commandId,
      [{ aggregateType: "channel", aggregateId: channel.id, eventType: "channel.changed", payload }],
      (db, sequences) => {
        this.project(db, payload);
        const sequence = sequences[0];
        if (written && sequence !== undefined) written(db, sequence);
        return channel;
      },
    );
  }

  /**
   * Writes one message that a member's turn changed. A streaming turn writes it on each delta, and
   * each event holds the whole message, so the log grew with the square of its length (#5392). The
   * first event of the message stays: a rebuild gives the message its place from it. The events
   * between that one and the newest go, with their receipts.
   */
  captureMessage(channel: Channel, message: ChannelMessage): Channel {
    // The id is JSON so that one message id is never the start of another: ids can hold ":".
    const operationPrefix = `capture:${channel.id}:${JSON.stringify(message.id)}:`;
    const commandPrefix = `channels:${operationPrefix}`;
    return this.commit(
      `${operationPrefix}${randomUUID()}`,
      { channel, messages: [message], tasks: [], assignments: [] },
      (db, sequence) => {
        // The range reads the command index, not the payloads: they hold the long text.
        const match = "command_id > ? AND command_id < ?";
        const range = [commandPrefix, `${commandPrefix}\uffff`] as const;
        const superseded = databaseRows(
          db
            .prepare(
              `DELETE FROM orchestration_events WHERE ${match} AND sequence < ?
                 AND sequence > (SELECT MIN(sequence) FROM orchestration_events WHERE ${match})
               RETURNING command_id`,
            )
            .all(...range, sequence, ...range),
        ).map((row) => requiredStringColumn(row, "command_id"));
        deleteReceiptsOf(db, superseded);
      },
    );
  }

  /**
   * Replaces one message with its deleted row. The earlier `channel.changed` events of the channel get
   * the same row, so the text leaves those events too, and a rebuild gives the same projection. A
   * summary that an agent wrote before the delete keeps what it says.
   */
  deleteMessage(channel: Channel, entry: ChannelMessage): Channel {
    const deleted = deletedChannelMessage(entry);
    const updated = { ...channel, revision: channel.revision + 1 };
    const payload: ChannelChange = { channel: updated, messages: [deleted], tasks: [], assignments: [] };
    return this.database.dispatch(
      `channels:message-deleted:${channel.id}:${entry.id}:${randomUUID()}`,
      [{ aggregateType: "channel", aggregateId: channel.id, eventType: "channel.changed", payload }],
      (db) => {
        this.project(db, payload);
        const events = databaseRows(
          db
            .prepare(
              "SELECT sequence, payload_json FROM orchestration_events WHERE aggregate_type = 'channel' AND aggregate_id = ? AND event_type = 'channel.changed' AND instr(payload_json, ?) > 0",
            )
            .all(channel.id, JSON.stringify(entry.id)),
        );
        const update = db.prepare("UPDATE orchestration_events SET payload_json = ? WHERE sequence = ?");
        for (const event of events) {
          const value = JSON.parse(requiredStringColumn(event, "payload_json"));
          if (!isDynamicRecord(value) || !Array.isArray(value.messages)) continue;
          let changed = false;
          const messages = value.messages.map((item: unknown) => {
            if (!isChannelMessage(item) || item.id !== entry.id || isDeletedChannelMessage(item)) return item;
            changed = true;
            return { ...deleted, sequence: item.sequence };
          });
          if (changed) update.run(JSON.stringify({ ...value, messages }), requiredNumberColumn(event, "sequence"));
        }
        return updated;
      },
    );
  }

  /**
   * "Delete history": as `deleteMessage` for every shown message of the channel, in one commit. Each
   * row and each earlier `channel.changed` event keeps the deleted row, so sequences and read cursors
   * stay. The summary and the text of each earlier summary event go too, and a new empty summary
   * covers the whole history, so no model reads a deleted message. Tasks, members, instructions,
   * memories and routines stay. Returns false when the channel has no message.
   */
  deleteHistory(channel: Channel): boolean {
    const db = this.database.connection;
    const last = databaseRow(
      db
        .prepare("SELECT MAX(sequence) AS sequence FROM projection_channel_messages WHERE channel_id = ?")
        .get(channel.id),
    );
    const throughSequence = last && typeof last.sequence === "number" ? last.sequence : 0;
    if (throughSequence === 0) return false;
    const updated = { ...channel, revision: channel.revision + 1 };
    const change: ChannelChange = { channel: updated, messages: [], tasks: [], assignments: [] };
    const summary = { version: this.summary(channel.id).version + 1, throughSequence, text: "" };
    this.database.dispatch(
      `channels:history-deleted:${channel.id}:${randomUUID()}`,
      [
        { aggregateType: "channel", aggregateId: channel.id, eventType: "channel.changed", payload: change },
        { aggregateType: "channel", aggregateId: channel.id, eventType: "channel.summarized", payload: summary },
      ],
      (tx, sequences) => {
        this.project(tx, change);
        // One row and one event at a time: a long channel holds too much text to read at once.
        const ids = databaseRows(
          tx
            .prepare(`SELECT message_id FROM projection_channel_messages WHERE channel_id = ? AND ${SHOWN_MESSAGE_SQL}`)
            .all(channel.id),
        ).map((row) => requiredStringColumn(row, "message_id"));
        const readMessage = tx.prepare(
          "SELECT message_json FROM projection_channel_messages WHERE channel_id = ? AND message_id = ?",
        );
        const writeMessage = tx.prepare(
          "UPDATE projection_channel_messages SET message_json = ? WHERE channel_id = ? AND message_id = ?",
        );
        for (const id of ids) {
          const row = databaseRow(readMessage.get(channel.id, id));
          const entry = row ? JSON.parse(requiredStringColumn(row, "message_json")) : null;
          if (isChannelMessage(entry)) writeMessage.run(JSON.stringify(deletedChannelMessage(entry)), channel.id, id);
        }
        tx.prepare(
          "INSERT INTO projection_channel_summaries VALUES (?, ?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET version = excluded.version, through_sequence = excluded.through_sequence, text = excluded.text",
        ).run(channel.id, summary.version, summary.throughSequence, summary.text);
        const own = new Set(sequences);
        const events = databaseRows(
          tx
            .prepare(
              "SELECT sequence FROM orchestration_events WHERE aggregate_type = 'channel' AND aggregate_id = ? AND event_type IN ('channel.changed', 'channel.summarized')",
            )
            .all(channel.id),
        )
          .map((row) => requiredNumberColumn(row, "sequence"))
          .filter((sequence) => !own.has(sequence));
        const readEvent = tx.prepare("SELECT event_type, payload_json FROM orchestration_events WHERE sequence = ?");
        const writeEvent = tx.prepare("UPDATE orchestration_events SET payload_json = ? WHERE sequence = ?");
        for (const sequence of events) {
          const row = databaseRow(readEvent.get(sequence));
          const value = row ? JSON.parse(requiredStringColumn(row, "payload_json")) : null;
          if (!row || !isDynamicRecord(value)) continue;
          if (row.event_type === "channel.summarized") {
            if (isString(value.text) && value.text) writeEvent.run(JSON.stringify({ ...value, text: "" }), sequence);
            continue;
          }
          if (!Array.isArray(value.messages)) continue;
          let changed = false;
          const messages = value.messages.map((item: unknown) => {
            if (!isChannelMessage(item) || isDeletedChannelMessage(item)) return item;
            changed = true;
            return deletedChannelMessage(item);
          });
          if (changed) writeEvent.run(JSON.stringify({ ...value, messages }), sequence);
        }
        return updated;
      },
    );
    return true;
  }

  private project(db: DatabaseSync, change: ChannelChange): void {
    db.prepare(
      "INSERT INTO projection_channels VALUES (?, ?) ON CONFLICT(channel_id) DO UPDATE SET channel_json = excluded.channel_json",
    ).run(change.channel.id, JSON.stringify(change.channel));
    for (const message of change.messages) {
      const existing = databaseRow(
        db
          .prepare(
            "SELECT sequence, message_json, json_extract(message_json, '$.message.status') AS status, json_extract(message_json, '$.deleted') AS deleted FROM projection_channel_messages WHERE channel_id = ? AND message_id = ?",
          )
          .get(change.channel.id, message.id),
      );
      // A person deleted this message. A late capture, a repeated result or a replay of an older
      // event must not bring its content back.
      if (existing?.deleted === 1 && !isDeletedChannelMessage(message)) continue;
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
      const before = existing ? JSON.parse(requiredStringColumn(existing, "message_json")) : null;
      // Only a change to what a model reads makes a summary or a cursor that covers the message
      // wrong. A continued task marks its earlier turn superseded, and in a long channel that reset
      // the summary to the first message on almost every turn of the lead (#3761).
      if (existing && (!isChannelMessage(before) || changesModelContent(before, message))) {
        // A streaming message changes on each part of its text; a packet already leaves it unread.
        if (existing.status !== "streaming")
          this.#completedMessageChanges.set(change.channel.id, this.completedMessageChanges(change.channel.id) + 1);
        db.prepare(
          "UPDATE projection_channel_summaries SET version = version + 1, through_sequence = 0, text = '' WHERE channel_id = ? AND through_sequence >= ?",
        ).run(change.channel.id, assigned);
        // A member read this message before it changed, as when a correction supersedes a result. A
        // packet with only later messages would not show the change, so the next one is complete.
        db.prepare(
          "UPDATE projection_channel_contexts SET through_sequence = 0, summary_version = 0 WHERE channel_id = ? AND through_sequence >= ?",
        ).run(change.channel.id, assigned);
      }
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

  executionThreads(): Array<{ id: string; threadId: string; channelId: string }> {
    return databaseRows(
      this.database.connection.prepare("SELECT channel_id, agent_id, thread_id FROM projection_channel_contexts").all(),
    ).map((row) => ({
      id: requiredStringColumn(row, "agent_id"),
      threadId: requiredStringColumn(row, "thread_id"),
      channelId: requiredStringColumn(row, "channel_id"),
    }));
  }

  contextThreads(channelId: string): string[] {
    return databaseRows(
      this.database.connection
        .prepare("SELECT thread_id FROM projection_channel_contexts WHERE channel_id = ? ORDER BY agent_id")
        .all(channelId),
    ).map((row) => requiredStringColumn(row, "thread_id"));
  }

  /** The agent and execution thread of each member context of one channel. */
  contexts(channelId: string): Array<{ agentId: string; threadId: string }> {
    return databaseRows(
      this.database.connection
        .prepare("SELECT agent_id, thread_id FROM projection_channel_contexts WHERE channel_id = ? ORDER BY agent_id")
        .all(channelId),
    ).map((row) => ({
      agentId: requiredStringColumn(row, "agent_id"),
      threadId: requiredStringColumn(row, "thread_id"),
    }));
  }

  /**
   * The sequence of the newest "New conversation" marker of a channel, or 0. A model reads no
   * message at or before it. The marker is an ordinary message row, so a deleted marker ends the
   * boundary and no event type or migration is needed.
   */
  contextResetSequence(channelId: string): number {
    const row = databaseRow(
      this.database.connection
        .prepare(
          // The id range reads the marker rows through the primary key, not every message of the channel.
          `SELECT MAX(sequence) AS sequence FROM projection_channel_messages
             WHERE channel_id = ? AND message_id >= 'context-reset-' AND message_id < 'context-reset.' AND ${SHOWN_MESSAGE_SQL}
             AND json_extract(message_json, '$.message.itemType') = ?
             AND json_extract(message_json, '$.message.author') = 'system'
             AND json_extract(message_json, '$.message.source') = 'system'`,
        )
        .get(channelId, CONTEXT_RESET_ITEM_TYPE),
    );
    return row && typeof row.sequence === "number" ? row.sequence : 0;
  }

  /** The execution threads of one agent, one for each channel it works in. */
  contextThreadsForAgent(agentId: string): string[] {
    return databaseRows(
      this.database.connection
        .prepare("SELECT thread_id FROM projection_channel_contexts WHERE agent_id = ? ORDER BY channel_id")
        .all(agentId),
    ).map((row) => requiredStringColumn(row, "thread_id"));
  }

  /**
   * The execution threads of every channel, in one query. Deleting an agent asks for this: a file
   * the agent generated in a channel thread belongs to the shared transcript, so it stays with the
   * channel rather than leaving with the agent.
   */
  allContextThreads(): string[] {
    return databaseRows(
      this.database.connection.prepare("SELECT thread_id FROM projection_channel_contexts").all(),
    ).map((row) => requiredStringColumn(row, "thread_id"));
  }

  /** Permanently removes a channel and its execution threads from every local projection. */
  delete(channelId: string, operationId: string = randomUUID()): void {
    if (!this.exists(channelId)) throw new Error(sourceText("error.backend.channelNotFound"));
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
        revokeRoutineWebhooks(db, "channel", routineIds, { forget: true });
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
          deleteThreadAttachments(db, threadId);
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
    const current = databaseRow(
      this.database.connection
        .prepare(
          "SELECT session_id, through_sequence, summary_version FROM projection_channel_contexts WHERE channel_id = ? AND agent_id = ?",
        )
        .get(channelId, agentId),
    );
    if (
      current &&
      current.session_id === sessionId &&
      current.through_sequence === throughSequence &&
      current.summary_version === summaryVersion
    )
      return;
    // Each change has its own operation: after a compaction reset, the cursor can come back to a value
    // that an earlier operation set, and a key made from the values would skip it as a repeat.
    this.database.dispatch(
      `channel-context-accepted:${randomUUID()}`,
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

  /**
   * The provider compacted this session, so its summary can leave out channel messages that it
   * read. A cursor at zero makes the next packet complete. It is the acceptance event, not a new
   * event type, so an earlier version still rebuilds the channel.
   */
  resetContextsForSession(sessionId: string): void {
    const rows = databaseRows(
      this.database.connection
        .prepare(
          "SELECT channel_id, agent_id FROM projection_channel_contexts WHERE session_id = ? AND through_sequence > 0",
        )
        .all(sessionId),
    );
    for (const row of rows)
      this.acceptContext(
        requiredStringColumn(row, "channel_id"),
        requiredStringColumn(row, "agent_id"),
        sessionId,
        0,
        0,
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

  /**
   * Channel read cursors follow the reader when an account signs in.
   *
   * `HostService.channelActor` answers `local` while no account is signed in and the team member
   * id after it, so without this every channel the reader already read turns unread on sign-in.
   * Direct threads already adopt their cursors this way. A target that read a channel under its
   * own id keeps that position, and the shared operation id makes a repeated adoption a no-op.
   */
  adoptReads(sourceMemberId: string, targetMemberId: string): void {
    if (sourceMemberId === targetMemberId) return;
    const rows = databaseRows(
      this.database.connection
        .prepare("SELECT channel_id, through_sequence FROM projection_channel_reads WHERE member_id = ?")
        .all(sourceMemberId),
    );
    for (const row of rows) {
      const channelId = requiredStringColumn(row, "channel_id");
      if (this.#hasReadCursor(channelId, targetMemberId)) continue;
      const throughSequence = requiredNumberColumn(row, "through_sequence");
      // The command key holds the target member and this operation id, not the channel. Without the
      // channel here, every channel after the first would answer with the first channel's receipt.
      this.markRead(channelId, targetMemberId, throughSequence, `adopt:${sourceMemberId}:${channelId}`);
    }
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

  /** A stored cursor of zero is a reader that read nothing, not a reader with no cursor at all. */
  #hasReadCursor(channelId: string, memberId: string): boolean {
    return (
      this.database.connection
        .prepare("SELECT 1 FROM projection_channel_reads WHERE channel_id = ? AND member_id = ?")
        .get(channelId, memberId) !== undefined
    );
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

const CHANNEL_PREVIEW_SOURCE_LIMIT = CHANNEL_PREVIEW_LIMIT * 16;

/**
 * One line for a sidebar row. A message can carry no text at all (an attachment, or a question
 * the agent asked), so fall back to a description of what arrived instead of showing an empty row.
 */
function previewText(entry: ChannelMessage): string {
  // The text is Markdown with mention markup (`@[Chief](agent:chief)`): show what a reader sees.
  // Only the start is parsed, so a very long message does not slow down every channel list.
  const text = markdownPreviewText(entry.message.text.slice(0, CHANNEL_PREVIEW_SOURCE_LIMIT));
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
    requestMessageId: isString(value.requestMessageId) ? value.requestMessageId : null,
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
