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
  isChannelFolderPaths,
  isChannelMessage,
  isChannelTask,
  MCP_SIGN_IN_ITEM_TYPE_PREFIX,
  SETTING_LINK_ITEM_TYPE_PREFIX,
  SIGNED_OUT_CHANNEL_MEMBER_ID,
  withBrowserMember,
} from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
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
import { currentConversationMessage } from "./database/legacy-conversation-message";
import { withTransaction } from "./database/sqlite-transaction";
import { cachedStatement } from "./database/statement-cache";
import type { OpenBotDatabase } from "./openbot-database";
import { revokeRoutineWebhooks } from "./webhook-route-store";

const SHOWN_MESSAGE_SQL =
  "(instr(message_json, '\"deleted\"') = 0 OR json_extract(message_json, '$.deleted') IS NOT 1)";

const CHANNEL_SUMMARY_ROWS_SQL = `SELECT c.channel_json AS channel_json,
  (SELECT m.message_json FROM projection_channel_messages AS m
    WHERE m.channel_id = c.channel_id
      AND ${SHOWN_MESSAGE_SQL.replaceAll("message_json", "m.message_json")}
      AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'plan'
      AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'subagents'
      AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'commentary'
    ORDER BY m.sequence DESC, m.message_id DESC LIMIT 1) AS latest_json
  FROM projection_channels AS c ORDER BY c.rowid`;

const TASK_COUNTS_SQL = `SELECT
    COALESCE(SUM(json_extract(task_json, '$.state') = 'running'), 0) AS running,
    COALESCE(SUM(json_extract(task_json, '$.state') IN ('queued', 'waiting', 'running')), 0) AS open
  FROM projection_channel_tasks WHERE channel_id = ?`;

interface TaskCounts {
  running: number;
  open: number;
}

const CHANNEL_THREADS_SQL =
  "SELECT channel_id, agent_id, thread_id FROM projection_channel_contexts ORDER BY channel_id, agent_id";

const UNREAD_COUNT_SQL = `SELECT COUNT(*) AS unread FROM projection_channel_messages AS m
  WHERE m.channel_id = ?
    AND m.sequence > COALESCE(
      (SELECT r.through_sequence FROM projection_channel_reads AS r
        WHERE r.channel_id = ? AND r.member_id = ?), 0)
    AND ${SHOWN_MESSAGE_SQL.replaceAll("message_json", "m.message_json")}
    AND json_extract(m.message_json, '$.author.id') IS NOT ?
    AND json_extract(m.message_json, '$.author.id') IS NOT ?
    AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'plan'
    AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'subagents'
    AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'channel-change'
    AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'context-reset'
    AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'commentary'
    AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') NOT LIKE ?
    AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') NOT LIKE ?
    AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') NOT LIKE ?`;

const MESSAGES_AFTER_READ_SQL = `SELECT COUNT(*) AS messages FROM (
  SELECT 1 FROM projection_channel_messages
  WHERE channel_id = ?
    AND sequence > COALESCE(
      (SELECT through_sequence FROM projection_channel_reads WHERE channel_id = ? AND member_id = ?), 0)
    AND ${SHOWN_MESSAGE_SQL}
  LIMIT ?)`;

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
  requestMessageId: string | null;
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

interface MemberFolderSource {
  key: string;
  folders: readonly string[];
  agentIds: readonly string[];
}

const MEMBER_FOLDER_COLUMNS =
  "json_extract(channel_json, '$.folders') AS folders, json_extract(channel_json, '$.members') AS members, json_extract(channel_json, '$.archived') AS archived";

function memberFolderSource(
  folders: readonly string[] | undefined,
  agentIds: readonly string[],
  archived: boolean,
): MemberFolderSource | null {
  if (archived || !folders?.length) return null;
  return { key: JSON.stringify([folders, agentIds]), folders, agentIds };
}

function parsedJsonColumn<T>(value: DynamicRecord[string], parse: (decoded: unknown) => T, fallback: T): T {
  if (!isString(value)) return fallback;
  try {
    return parse(JSON.parse(value));
  } catch {
    return fallback;
  }
}

function repairedChannelMessage(decoded: unknown): ChannelMessage | undefined {
  if (isChannelMessage(decoded)) return decoded;
  if (!isDynamicRecord(decoded)) return undefined;
  const message = currentConversationMessage(decoded.message);
  const repaired = message ? { ...decoded, message } : decoded;
  return isChannelMessage(repaired) ? repaired : undefined;
}

function listedChannelMessage(value: DynamicRecord[string]): ChannelMessage | undefined {
  return parsedJsonColumn(value, repairedChannelMessage, undefined);
}

function storedFolders(value: DynamicRecord[string]): readonly string[] | undefined {
  return parsedJsonColumn(value, (decoded) => (isChannelFolderPaths(decoded) ? decoded : undefined), undefined);
}

function storedMemberAgentIds(value: DynamicRecord[string]): readonly string[] {
  return parsedJsonColumn(
    value,
    (decoded) =>
      Array.isArray(decoded)
        ? decoded.flatMap((member) => (isDynamicRecord(member) && isString(member.agentId) ? [member.agentId] : []))
        : [],
    [],
  );
}

function storedMemberFolderSource(row: DynamicRecord): MemberFolderSource | null {
  return memberFolderSource(
    storedFolders(row.folders),
    storedMemberAgentIds(row.members),
    row.archived === true || row.archived === 1,
  );
}

interface ChannelChange {
  channel: Channel;
  messages: ChannelMessage[];
  tasks: ChannelTask[];
  assignments: ChannelAssignment[];
}

export class ChannelStore {
  readonly #completedMessageChanges = new Map<string, number>();
  readonly #unreadCounts = new Map<string, Map<string, number>>();
  readonly #taskCounts = new Map<string, TaskCounts>();
  #countsConnection: DatabaseSync | null = null;
  #countsDataVersion: unknown = null;

  #memberFolders: { connection: DatabaseSync; folders: ReadonlyMap<string, readonly string[]> } | null = null;

  constructor(
    readonly database: OpenBotDatabase,
    private readonly memberFoldersChanged: (agentIds: readonly string[]) => void = () => {},
  ) {}

  memberFolders(agentId: string): readonly string[] {
    const connection = this.database.connection;
    if (connection.isTransaction) return this.#readMemberFolders(connection).get(agentId) ?? [];
    if (this.#memberFolders?.connection !== connection)
      this.#memberFolders = { connection, folders: this.#readMemberFolders(connection) };
    return this.#memberFolders.folders.get(agentId) ?? [];
  }

  #readMemberFolders(connection: DatabaseSync): ReadonlyMap<string, readonly string[]> {
    const folders = new Map<string, string[]>();
    const rows = databaseRows(
      connection
        .prepare(
          `SELECT ${MEMBER_FOLDER_COLUMNS} FROM projection_channels WHERE json_array_length(channel_json, '$.folders') > 0 ORDER BY rowid`,
        )
        .all(),
    );
    for (const row of rows) {
      const source = storedMemberFolderSource(row);
      if (!source) continue;
      for (const agentId of source.agentIds) {
        const known = folders.get(agentId) ?? [];
        folders.set(agentId, [...known, ...source.folders.filter((path) => !known.includes(path))]);
      }
    }
    return folders;
  }

  #replaceMemberFolders(db: DatabaseSync, channelId: string, next: MemberFolderSource | null): void {
    const row = databaseRow(
      db.prepare(`SELECT ${MEMBER_FOLDER_COLUMNS} FROM projection_channels WHERE channel_id = ?`).get(channelId),
    );
    const previous = row ? storedMemberFolderSource(row) : null;
    if (previous?.key === next?.key) return;
    this.#memberFolders = null;
    this.memberFoldersChanged([...new Set([...(previous?.agentIds ?? []), ...(next?.agentIds ?? [])])]);
  }

  #forgetCounts(channelId: string): void {
    this.#unreadCounts.delete(channelId);
    this.#taskCounts.delete(channelId);
  }

  #keepsCounts(): boolean {
    const db = this.database.connection;
    if (db.isTransaction) return false;
    const dataVersion = databaseRow(cachedStatement(db, "PRAGMA data_version").get())?.data_version;
    if (db !== this.#countsConnection || dataVersion !== this.#countsDataVersion) {
      this.#unreadCounts.clear();
      this.#taskCounts.clear();
      this.#countsConnection = db;
      this.#countsDataVersion = dataVersion;
    }
    return true;
  }

  messagesAfterRead(channelId: string, memberId: string, limit: number): number {
    const row = databaseRow(
      cachedStatement(this.database.connection, MESSAGES_AFTER_READ_SQL).get(channelId, channelId, memberId, limit),
    );
    return Number(row?.messages ?? 0);
  }

  #unreadCount(channelId: string, memberId: string, excludedId: string, keep: boolean): number {
    const key = `${memberId}\n${excludedId}`;
    const kept = keep ? this.#unreadCounts.get(channelId)?.get(key) : undefined;
    if (kept !== undefined) return kept;
    const row = databaseRow(
      cachedStatement(this.database.connection, UNREAD_COUNT_SQL).get(
        channelId,
        channelId,
        memberId,
        memberId,
        excludedId,
        `${CHANNEL_ROUTING_EVENT_ITEM_TYPE_PREFIX}%`,
        `${MCP_SIGN_IN_ITEM_TYPE_PREFIX}%`,
        `${SETTING_LINK_ITEM_TYPE_PREFIX}%`,
      ),
    );
    const count = Number(row?.unread ?? 0);
    if (keep) {
      const counts = this.#unreadCounts.get(channelId) ?? new Map<string, number>();
      counts.set(key, count);
      this.#unreadCounts.set(channelId, counts);
    }
    return count;
  }

  #taskCountsOf(channelId: string, keep: boolean): TaskCounts {
    const kept = keep ? this.#taskCounts.get(channelId) : undefined;
    if (kept) return kept;
    const row = databaseRow(cachedStatement(this.database.connection, TASK_COUNTS_SQL).get(channelId));
    const counts = { running: Number(row?.running ?? 0), open: Number(row?.open ?? 0) };
    if (keep) this.#taskCounts.set(channelId, counts);
    return counts;
  }

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

  ids(): string[] {
    return databaseRows(
      this.database.connection.prepare("SELECT channel_id FROM projection_channels ORDER BY rowid").all(),
    ).map((row) => requiredStringColumn(row, "channel_id"));
  }

  archivedIds(): ReadonlySet<string> {
    return new Set(
      databaseRows(
        this.database.connection
          .prepare("SELECT channel_id FROM projection_channels WHERE json_extract(channel_json, '$.archived') = 1")
          .all(),
      ).map((row) => requiredStringColumn(row, "channel_id")),
    );
  }

  list(memberId: string, signedOutMessagesAreTheirs = false): ChannelSummary[] {
    const excludedId = signedOutMessagesAreTheirs ? SIGNED_OUT_CHANNEL_MEMBER_ID : memberId;
    const rows = databaseRows(cachedStatement(this.database.connection, CHANNEL_SUMMARY_ROWS_SQL).all());
    const keepsCounts = this.#keepsCounts();
    const threads = new Map<string, ChannelThread[]>();
    for (const row of databaseRows(cachedStatement(this.database.connection, CHANNEL_THREADS_SQL).all())) {
      const channelId = requiredStringColumn(row, "channel_id");
      const thread = {
        agentId: requiredStringColumn(row, "agent_id"),
        threadId: requiredStringColumn(row, "thread_id"),
      };
      threads.set(channelId, [...(threads.get(channelId) ?? []), thread]);
    }
    return rows.map((row) => {
      const channel = decodeChannel(JSON.parse(requiredStringColumn(row, "channel_json")));
      const latest = listedChannelMessage(row.latest_json);
      const tasks = this.#taskCountsOf(channel.id, keepsCounts);
      return {
        ...channel,
        unreadCount: this.#unreadCount(channel.id, memberId, excludedId, keepsCounts),
        activeTasks: tasks.running,
        openTasks: tasks.open,
        lastMessage: latest
          ? {
              authorName: latest.author.name,
              author: { kind: latest.author.kind, id: latest.author.id },
              status: latest.message.status,
              text: previewText(latest),
              at: latest.message.createdAt,
            }
          : null,
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
      cachedStatement(
        this.database.connection,
        `SELECT message_json FROM projection_channel_messages WHERE channel_id = ? AND sequence < ? AND ${SHOWN_MESSAGE_SQL} ORDER BY sequence DESC, message_id DESC LIMIT ?`,
      ).all(channelId, before, limit ?? -1),
    );
    return rows.reverse().map((row) => {
      const value = JSON.parse(requiredStringColumn(row, "message_json"));
      if (!isChannelMessage(value)) throw new Error("Invalid stored channel message.");
      return value;
    });
  }

  message(channelId: string, messageId: string): ChannelMessage | null {
    const row = databaseRow(
      cachedStatement(
        this.database.connection,
        `SELECT message_json FROM projection_channel_messages WHERE channel_id = ? AND message_id = ? AND ${SHOWN_MESSAGE_SQL}`,
      ).get(channelId, messageId),
    );
    if (!row) return null;
    const value = JSON.parse(requiredStringColumn(row, "message_json"));
    if (!isChannelMessage(value)) throw new Error("Invalid stored channel message.");
    return value;
  }

  messagesById(channelId: string, messageIds: readonly string[]): ChannelMessage[] {
    if (!messageIds.length) return [];
    return databaseRows(
      cachedStatement(
        this.database.connection,
        `SELECT message_json FROM projection_channel_messages
          WHERE channel_id = ? AND message_id IN (SELECT value FROM json_each(?)) AND ${SHOWN_MESSAGE_SQL}`,
      ).all(channelId, JSON.stringify(messageIds)),
    ).map((row) => {
      const value = JSON.parse(requiredStringColumn(row, "message_json"));
      if (!isChannelMessage(value)) throw new Error("Invalid stored channel message.");
      return value;
    });
  }

  task(channelId: string, taskId: string): ChannelTask | null {
    const row = databaseRow(
      cachedStatement(
        this.database.connection,
        "SELECT task_json FROM projection_channel_tasks WHERE channel_id = ? AND task_id = ?",
      ).get(channelId, taskId),
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

  tasksInStates(channelId: string, states: readonly ChannelTask["state"][]): ChannelTask[] {
    if (!states.length) return [];
    return databaseRows(
      cachedStatement(
        this.database.connection,
        `SELECT task_json FROM projection_channel_tasks
          WHERE channel_id = ? AND json_extract(task_json, '$.state') IN (${states.map(() => "?").join(", ")})
          ORDER BY rowid`,
      ).all(channelId, ...states),
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

  agentAssignments(channelId: string, agentId: string): ChannelAssignment[] {
    return databaseRows(
      cachedStatement(
        this.database.connection,
        `SELECT assignment_json FROM projection_channel_assignments
          WHERE channel_id = ? AND json_extract(assignment_json, '$.agentId') = ? ORDER BY rowid`,
      ).all(channelId, agentId),
    ).map((row) => decodeAssignment(JSON.parse(requiredStringColumn(row, "assignment_json"))));
  }

  assignment(channelId: string, assignmentId: string): ChannelAssignment | null {
    const row = databaseRow(
      cachedStatement(
        this.database.connection,
        "SELECT assignment_json FROM projection_channel_assignments WHERE channel_id = ? AND assignment_id = ?",
      ).get(channelId, assignmentId),
    );
    return row ? decodeAssignment(JSON.parse(requiredStringColumn(row, "assignment_json"))) : null;
  }

  assignmentsInStates(channelId: string, states: readonly ChannelAssignment["state"][]): ChannelAssignment[] {
    if (!states.length) return [];
    return databaseRows(
      cachedStatement(
        this.database.connection,
        `SELECT assignment_json FROM projection_channel_assignments
          WHERE channel_id = ? AND json_extract(assignment_json, '$.state') IN (${states.map(() => "?").join(", ")})
          ORDER BY rowid`,
      ).all(channelId, ...states),
    ).map((row) => decodeAssignment(JSON.parse(requiredStringColumn(row, "assignment_json"))));
  }

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

  agentWork(
    agentId: string,
    states: readonly ChannelAssignment["state"][],
  ): Array<{ assignment: ChannelAssignment; channel: Channel }> {
    if (!states.length) return [];
    const placeholders = states.map(() => "?").join(", ");
    const ranking = states.map((_, index) => `WHEN ? THEN ${index}`).join(" ");
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT assignments.assignment_json AS assignment_json, channels.channel_json AS channel_json
             FROM projection_channel_assignments AS assignments
             JOIN projection_channels AS channels ON channels.channel_id = assignments.channel_id
            WHERE json_extract(assignments.assignment_json, '$.agentId') = ?
              AND json_extract(assignments.assignment_json, '$.state') IN (${placeholders})
              AND COALESCE(json_extract(channels.channel_json, '$.archived'), 0) = 0
            ORDER BY CASE json_extract(assignments.assignment_json, '$.state') ${ranking} END,
                     assignments.rowid`,
        )
        .all(agentId, ...states, ...states),
    ).map((row) => ({
      assignment: decodeAssignment(JSON.parse(requiredStringColumn(row, "assignment_json"))),
      channel: decodeChannel(JSON.parse(requiredStringColumn(row, "channel_json"))),
    }));
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
    const page = this.pageWithoutExtent(channelId, before, limit);
    return page.olderCursor === null ? page : { ...page, ...this.olderExtent(channelId, page.olderCursor) };
  }

  pageWithoutExtent(channelId: string, before?: number, limit = 100): ChannelPage {
    const messages = this.messages(channelId, before, limit + 1);
    const hasOlder = messages.length > limit;
    if (hasOlder) messages.shift();
    return {
      channel: this.get(channelId),
      tasks: this.tasks(channelId),
      messages,
      olderCursor: hasOlder ? (messages[0]?.sequence ?? null) : null,
      throughSequence: this.latestSequence(channelId),
    };
  }

  private latestSequence(channelId: string): number {
    return this.messages(channelId, undefined, 1)[0]?.sequence ?? 0;
  }

  private storedSequence(channelId: string): number {
    const row = databaseRow(
      this.database.connection
        .prepare("SELECT MAX(sequence) AS sequence FROM projection_channel_messages WHERE channel_id = ?")
        .get(channelId),
    );
    return row && typeof row.sequence === "number" ? row.sequence : 0;
  }

  withSeenDependencies(channelId: string, tasks: ChannelTask[]): ChannelTask[] {
    if (!tasks.some((task) => task.state === "waiting")) return tasks;
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
      const seenDependencies = task.dependencies.filter((id) => {
        const at = readAt.get(task.id)?.get(id);
        return at !== undefined && (started.get(id) ?? -1) < at;
      });
      return seenDependencies.length ? { ...task, seenDependencies } : task;
    });
  }

  olderExtent(channelId: string, before: number): { olderCount: number; oldestAt?: string } {
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
    const channel = { ...withBrowserMember(change.channel), revision: change.channel.revision + 1 };
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

  captureMessage(channel: Channel, message: ChannelMessage): Channel {
    const operationPrefix = `capture:${channel.id}:${JSON.stringify(message.id)}:`;
    const commandPrefix = `channels:${operationPrefix}`;
    return this.commit(
      `${operationPrefix}${randomUUID()}`,
      { channel, messages: [message], tasks: [], assignments: [] },
      (db, sequence) => {
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

  deleteHistory(channel: Channel): boolean {
    const throughSequence = this.storedSequence(channel.id);
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
    this.#forgetCounts(change.channel.id);
    this.#replaceMemberFolders(
      db,
      change.channel.id,
      memberFolderSource(
        change.channel.folders,
        change.channel.members.map((member) => member.agentId),
        change.channel.archived === true,
      ),
    );
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
      if (existing && (!isChannelMessage(before) || changesModelContent(before, message))) {
        if (existing.status !== "streaming")
          this.#completedMessageChanges.set(change.channel.id, this.completedMessageChanges(change.channel.id) + 1);
        db.prepare(
          "UPDATE projection_channel_summaries SET version = version + 1, through_sequence = 0, text = '' WHERE channel_id = ? AND through_sequence >= ?",
        ).run(change.channel.id, assigned);
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

  contextResetSequence(channelId: string): number {
    const row = databaseRow(
      this.database.connection
        .prepare(
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

  contextThreadsForAgent(agentId: string): string[] {
    return databaseRows(
      this.database.connection
        .prepare("SELECT thread_id FROM projection_channel_contexts WHERE agent_id = ? ORDER BY channel_id")
        .all(agentId),
    ).map((row) => requiredStringColumn(row, "thread_id"));
  }

  clearAgentContexts(agentId: string): void {
    const threadIds = this.contextThreadsForAgent(agentId);
    if (threadIds.length === 0) return;
    this.database.dispatch(
      `channel-agent-contexts-cleared:${agentId}:${randomUUID()}`,
      [
        {
          aggregateType: "channel-agent",
          aggregateId: agentId,
          eventType: "channel.agent-contexts-cleared",
          payload: { threadIds },
        },
      ],
      (db, sequences) => {
        const now = new Date().toISOString();
        for (const threadId of threadIds) {
          const context = databaseRow(
            db.prepare("SELECT channel_id FROM projection_channel_contexts WHERE thread_id = ?").get(threadId),
          );
          const thread = databaseRow(
            db.prepare("SELECT title, created_at FROM projection_threads WHERE thread_id = ?").get(threadId),
          );
          if (!context || !thread) continue;
          deleteAggregateHistory(db, "thread", [threadId]);
          deleteThreadAttachments(db, threadId);
          db.prepare("DELETE FROM projection_channel_contexts WHERE thread_id = ?").run(threadId);
          db.prepare("DELETE FROM projection_threads WHERE thread_id = ?").run(threadId);
          db.prepare("INSERT INTO projection_threads VALUES (?, ?, ?, NULL, ?, ?, ?)").run(
            threadId,
            agentId,
            requiredStringColumn(thread, "title"),
            requiredStringColumn(thread, "created_at"),
            now,
            sequences[0] ?? 0,
          );
          db.prepare("INSERT INTO projection_channel_contexts(channel_id, agent_id, thread_id) VALUES (?, ?, ?)").run(
            requiredStringColumn(context, "channel_id"),
            agentId,
            threadId,
          );
        }
        return null;
      },
    );
  }

  allContextThreads(): string[] {
    return databaseRows(
      this.database.connection.prepare("SELECT thread_id FROM projection_channel_contexts").all(),
    ).map((row) => requiredStringColumn(row, "thread_id"));
  }

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
        this.#forgetCounts(channelId);
        this.#replaceMemberFolders(db, channelId, null);
        const memoryIds = databaseRows(
          db.prepare("SELECT memory_id FROM projection_channel_memories WHERE channel_id = ?").all(channelId),
        ).map((row) => requiredStringColumn(row, "memory_id"));
        const routineIds = channelRoutineIds(db, channelId);
        revokeRoutineWebhooks(db, "channel", routineIds, { forget: true });
        deleteAggregateHistory(db, "channel", [channelId]);
        deleteAggregateHistory(db, "channel-memory", memoryIds);
        deleteAggregateHistory(db, "channel-routine", routineIds);
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
      cachedStatement(
        this.database.connection,
        "SELECT channel_id FROM projection_channel_contexts WHERE thread_id = ?",
      ).get(threadId),
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
      this.markRead(channelId, targetMemberId, throughSequence, `adopt:${sourceMemberId}:${channelId}`);
    }
  }

  markRead(channelId: string, memberId: string, requestedSequence: number, operationId: string): Channel {
    const throughSequence = Math.min(requestedSequence, this.storedSequence(channelId));
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
        this.#unreadCounts.delete(channelId);
        db.prepare(
          "INSERT INTO projection_channel_reads VALUES (?, ?, ?) ON CONFLICT(channel_id, member_id) DO UPDATE SET through_sequence = MAX(through_sequence, excluded.through_sequence)",
        ).run(channelId, memberId, throughSequence);
        return this.get(channelId);
      },
    );
  }

  rebuild(channelId: string): void {
    const db = this.database.connection;
    this.#forgetCounts(channelId);
    withTransaction(db, () => {
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
    });
  }

  #hasReadCursor(channelId: string, memberId: string): boolean {
    return (
      this.database.connection
        .prepare("SELECT 1 FROM projection_channel_reads WHERE channel_id = ? AND member_id = ?")
        .get(channelId, memberId) !== undefined
    );
  }
}

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

function previewText(entry: ChannelMessage): string {
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
