import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  decodeGroup,
  type Group,
  type GroupDraft,
  type GroupMessage,
  type GroupPage,
  type GroupSummary,
  type GroupTask,
  isGroupMessage,
  isGroupTask,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { databaseRow, databaseRows, requiredNumberColumn, requiredStringColumn } from "./database/database-rows";
import type { OpenBotDatabase } from "./openbot-database";

export interface GroupAssignment {
  id: string;
  groupId: string;
  taskId: string;
  agentId: string;
  taskRevision: number;
  deliveryId: string | null;
  turnId: string | null;
  state: "queued" | "starting" | "running" | "completed" | "failed" | "interrupted";
  throughSequence: number;
  summaryVersion: number;
  awaitedTaskIds: string[];
  pendingRevision: number | null;
  pendingOutcome: string | null;
}

export interface GroupContext {
  threadId: string;
  sessionId: string | null;
  throughSequence: number;
  summaryVersion: number;
}

export interface GroupHistorySummary {
  version: number;
  throughSequence: number;
  text: string;
}

interface GroupChange {
  group: Group;
  messages: GroupMessage[];
  tasks: GroupTask[];
  assignments: GroupAssignment[];
}

/** Owns durable group records. Every change and its retry receipt commit together. */
export class GroupStore {
  constructor(readonly database: OpenBotDatabase) {}

  get(groupId: string): Group {
    const row = databaseRow(
      this.database.connection.prepare("SELECT group_json FROM projection_groups WHERE group_id = ?").get(groupId),
    );
    if (!row) throw new Error("Group not found.");
    return decodeGroup(JSON.parse(requiredStringColumn(row, "group_json")));
  }

  list(memberId: string): GroupSummary[] {
    return databaseRows(
      this.database.connection.prepare("SELECT group_json FROM projection_groups ORDER BY rowid").all(),
    ).map((row) => {
      const group = decodeGroup(JSON.parse(requiredStringColumn(row, "group_json")));
      const through = this.readSequence(group.id, memberId);
      return {
        ...group,
        unreadCount: this.messages(group.id).filter(
          (message) => message.sequence > through && message.author.id !== memberId,
        ).length,
        activeTasks: this.tasks(group.id).filter((task) => task.state === "running").length,
      };
    });
  }

  create(groupId: string, draft: GroupDraft): Group {
    return { ...draft, id: groupId, archived: false, revision: 0, createdAt: new Date().toISOString() };
  }

  exists(groupId: string): boolean {
    return (
      this.database.connection.prepare("SELECT 1 FROM projection_groups WHERE group_id = ?").get(groupId) !== undefined
    );
  }

  messages(groupId: string, before = Number.MAX_SAFE_INTEGER, limit?: number): GroupMessage[] {
    const rows = databaseRows(
      this.database.connection
        .prepare(
          "SELECT message_json FROM projection_group_messages WHERE group_id = ? AND sequence < ? ORDER BY sequence DESC, message_id DESC LIMIT ?",
        )
        .all(groupId, before, limit ?? -1),
    );
    return rows.reverse().map((row) => {
      const value = JSON.parse(requiredStringColumn(row, "message_json"));
      if (!isGroupMessage(value)) throw new Error("Invalid stored group message.");
      return value;
    });
  }

  tasks(groupId: string): GroupTask[] {
    return databaseRows(
      this.database.connection
        .prepare("SELECT task_json FROM projection_group_tasks WHERE group_id = ? ORDER BY rowid")
        .all(groupId),
    ).map((row) => {
      const value = JSON.parse(requiredStringColumn(row, "task_json"));
      if (!isGroupTask(value)) throw new Error("Invalid stored group task.");
      return value;
    });
  }

  assignments(groupId: string): GroupAssignment[] {
    return databaseRows(
      this.database.connection
        .prepare("SELECT assignment_json FROM projection_group_assignments WHERE group_id = ? ORDER BY rowid")
        .all(groupId),
    ).map((row) => decodeAssignment(JSON.parse(requiredStringColumn(row, "assignment_json"))));
  }

  assignmentForDelivery(deliveryId: string): GroupAssignment | null {
    const row = databaseRow(
      this.database.connection
        .prepare("SELECT assignment_json FROM projection_group_assignments WHERE delivery_id = ?")
        .get(deliveryId),
    );
    return row ? decodeAssignment(JSON.parse(requiredStringColumn(row, "assignment_json"))) : null;
  }

  page(groupId: string, before?: number): GroupPage {
    const messages = this.messages(groupId, before, 101);
    const hasOlder = messages.length > 100;
    if (hasOlder) messages.shift();
    return {
      group: this.get(groupId),
      tasks: this.tasks(groupId),
      messages,
      olderCursor: hasOlder ? (messages[0]?.sequence ?? null) : null,
      throughSequence: this.messages(groupId, undefined, 1)[0]?.sequence ?? 0,
    };
  }

  commit(operationId: string, change: GroupChange): Group {
    const commandId = `groups:${operationId}`;
    const previous = this.database.commandResult(commandId);
    if (previous !== undefined) return decodeGroup(previous);
    if (!change.tasks.every(isGroupTask)) throw new Error("Invalid group task.");
    const group = { ...change.group, revision: change.group.revision + 1 };
    const payload = { ...change, group };
    return this.database.dispatch(
      commandId,
      [{ aggregateType: "group", aggregateId: group.id, eventType: "group.changed", payload }],
      (db) => {
        this.project(db, payload);
        return group;
      },
    );
  }

  private project(db: DatabaseSync, change: GroupChange): void {
    db.prepare(
      "INSERT INTO projection_groups VALUES (?, ?) ON CONFLICT(group_id) DO UPDATE SET group_json = excluded.group_json",
    ).run(change.group.id, JSON.stringify(change.group));
    for (const message of change.messages) {
      const existing = databaseRow(
        db
          .prepare("SELECT sequence FROM projection_group_messages WHERE group_id = ? AND message_id = ?")
          .get(change.group.id, message.id),
      );
      const last = databaseRow(
        db
          .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM projection_group_messages WHERE group_id = ?")
          .get(change.group.id),
      );
      const assigned = existing
        ? requiredNumberColumn(existing, "sequence")
        : last
          ? requiredNumberColumn(last, "next")
          : 1;
      db.prepare(
        "INSERT INTO projection_group_messages VALUES (?, ?, ?, ?) ON CONFLICT(group_id, message_id) DO UPDATE SET message_json = excluded.message_json",
      ).run(change.group.id, message.id, assigned, JSON.stringify({ ...message, sequence: assigned }));
      if (existing)
        db.prepare(
          "UPDATE projection_group_summaries SET version = version + 1, through_sequence = 0, text = '' WHERE group_id = ? AND through_sequence >= ?",
        ).run(change.group.id, assigned);
    }
    for (const task of change.tasks)
      db.prepare(
        "INSERT INTO projection_group_tasks VALUES (?, ?, ?) ON CONFLICT(task_id) DO UPDATE SET task_json = excluded.task_json",
      ).run(task.id, change.group.id, JSON.stringify(task));
    for (const assignment of change.assignments)
      db.prepare(
        "INSERT INTO projection_group_assignments VALUES (?, ?, ?, ?, ?) ON CONFLICT(assignment_id) DO UPDATE SET delivery_id = excluded.delivery_id, assignment_json = excluded.assignment_json",
      ).run(assignment.id, change.group.id, assignment.taskId, assignment.deliveryId, JSON.stringify(assignment));
  }

  update(group: Group, changes: Partial<Omit<GroupChange, "group">> = {}, operationId: string = randomUUID()): Group {
    return this.commit(operationId, { group, messages: [], tasks: [], assignments: [], ...changes });
  }

  context(groupId: string, agentId: string): GroupContext {
    const row = databaseRow(
      this.database.connection
        .prepare("SELECT * FROM projection_group_contexts WHERE group_id = ? AND agent_id = ?")
        .get(groupId, agentId),
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
      `group-context:${groupId}:${agentId}`,
      [
        {
          aggregateType: "group",
          aggregateId: groupId,
          eventType: "group.context-created",
          payload: { agentId, threadId },
        },
      ],
      (db, sequences) => {
        const now = new Date().toISOString();
        db.prepare("INSERT INTO projection_threads VALUES (?, ?, ?, NULL, ?, ?, ?)").run(
          threadId,
          agentId,
          this.get(groupId).name,
          now,
          now,
          sequences[0] ?? 0,
        );
        db.prepare("INSERT INTO projection_group_contexts(group_id, agent_id, thread_id) VALUES (?, ?, ?)").run(
          groupId,
          agentId,
          threadId,
        );
        return { threadId, sessionId: null, throughSequence: 0, summaryVersion: 0 };
      },
    );
  }

  executionThreads(): Array<{ id: string; threadId: string }> {
    return databaseRows(
      this.database.connection.prepare("SELECT agent_id, thread_id FROM projection_group_contexts").all(),
    ).map((row) => ({ id: requiredStringColumn(row, "agent_id"), threadId: requiredStringColumn(row, "thread_id") }));
  }

  groupForThread(threadId: string): string | null {
    const row = databaseRow(
      this.database.connection
        .prepare("SELECT group_id FROM projection_group_contexts WHERE thread_id = ?")
        .get(threadId),
    );
    return row ? requiredStringColumn(row, "group_id") : null;
  }

  acceptContext(
    groupId: string,
    agentId: string,
    sessionId: string,
    throughSequence: number,
    summaryVersion: number,
  ): void {
    this.database.dispatch(
      `group-context-accepted:${groupId}:${agentId}:${sessionId}:${throughSequence}:${summaryVersion}`,
      [
        {
          aggregateType: "group",
          aggregateId: groupId,
          eventType: "group.context-accepted",
          payload: { agentId, sessionId, throughSequence, summaryVersion },
        },
      ],
      (db) => {
        db.prepare(
          "UPDATE projection_group_contexts SET session_id = ?, through_sequence = ?, summary_version = ? WHERE group_id = ? AND agent_id = ?",
        ).run(sessionId, throughSequence, summaryVersion, groupId, agentId);
      },
    );
  }

  summary(groupId: string): GroupHistorySummary {
    const row = databaseRow(
      this.database.connection.prepare("SELECT * FROM projection_group_summaries WHERE group_id = ?").get(groupId),
    );
    return row
      ? {
          version: requiredNumberColumn(row, "version"),
          throughSequence: requiredNumberColumn(row, "through_sequence"),
          text: requiredStringColumn(row, "text"),
        }
      : { version: 0, throughSequence: 0, text: "" };
  }

  saveSummary(groupId: string, summary: GroupHistorySummary): void {
    this.database.dispatch(
      `group-summary:${groupId}:${summary.version}`,
      [{ aggregateType: "group", aggregateId: groupId, eventType: "group.summarized", payload: summary }],
      (db) => {
        db.prepare(
          "INSERT INTO projection_group_summaries VALUES (?, ?, ?, ?) ON CONFLICT(group_id) DO UPDATE SET version = excluded.version, through_sequence = excluded.through_sequence, text = excluded.text",
        ).run(groupId, summary.version, summary.throughSequence, summary.text);
      },
    );
  }

  markRead(groupId: string, memberId: string, throughSequence: number, operationId: string): Group {
    const maximum = this.page(groupId).throughSequence;
    if (throughSequence > maximum) throw new Error("The read position exceeds the group history.");
    return this.database.dispatch(
      `group-read:${memberId}:${operationId}`,
      [
        {
          aggregateType: "group",
          aggregateId: groupId,
          eventType: "group.read",
          payload: { memberId, throughSequence },
        },
      ],
      (db) => {
        db.prepare(
          "INSERT INTO projection_group_reads VALUES (?, ?, ?) ON CONFLICT(group_id, member_id) DO UPDATE SET through_sequence = MAX(through_sequence, excluded.through_sequence)",
        ).run(groupId, memberId, throughSequence);
        return this.get(groupId);
      },
    );
  }

  /** Rebuilds group projections from committed events without changing agent threads. */
  rebuild(groupId: string): void {
    const db = this.database.connection;
    db.exec("BEGIN IMMEDIATE");
    try {
      const events = databaseRows(
        db
          .prepare(
            "SELECT event_type, payload_json, occurred_at, sequence FROM orchestration_events WHERE aggregate_type = 'group' AND aggregate_id = ? ORDER BY sequence",
          )
          .all(groupId),
      );
      for (const table of ["assignments", "tasks", "messages", "summaries", "reads", "contexts"])
        db.prepare(`DELETE FROM projection_group_${table} WHERE group_id = ?`).run(groupId);
      db.prepare("DELETE FROM projection_groups WHERE group_id = ?").run(groupId);
      for (const event of events) {
        const value = JSON.parse(requiredStringColumn(event, "payload_json"));
        if (!isDynamicRecord(value)) throw new Error("Invalid group event.");
        switch (event.event_type) {
          case "group.changed": {
            if (
              !Array.isArray(value.messages) ||
              !value.messages.every(isGroupMessage) ||
              !Array.isArray(value.tasks) ||
              !value.tasks.every(isGroupTask) ||
              !Array.isArray(value.assignments)
            )
              throw new Error("Invalid group change event.");
            this.project(db, {
              group: decodeGroup(value.group),
              messages: value.messages,
              tasks: value.tasks,
              assignments: value.assignments.map(decodeAssignment),
            });
            break;
          }
          case "group.context-created": {
            if (!isString(value.agentId) || !isString(value.threadId)) throw new Error("Invalid group context event.");
            const now = requiredStringColumn(event, "occurred_at");
            db.prepare("INSERT OR IGNORE INTO projection_threads VALUES (?, ?, ?, NULL, ?, ?, ?)").run(
              value.threadId,
              value.agentId,
              this.get(groupId).name,
              now,
              now,
              requiredNumberColumn(event, "sequence"),
            );
            db.prepare("INSERT INTO projection_group_contexts(group_id, agent_id, thread_id) VALUES (?, ?, ?)").run(
              groupId,
              value.agentId,
              value.threadId,
            );
            break;
          }
          case "group.context-accepted": {
            if (
              !isString(value.agentId) ||
              !isString(value.sessionId) ||
              typeof value.throughSequence !== "number" ||
              typeof value.summaryVersion !== "number"
            )
              throw new Error("Invalid context acceptance event.");
            db.prepare(
              "UPDATE projection_group_contexts SET session_id = ?, through_sequence = ?, summary_version = ? WHERE group_id = ? AND agent_id = ?",
            ).run(value.sessionId, value.throughSequence, value.summaryVersion, groupId, value.agentId);
            break;
          }
          case "group.summarized": {
            if (!isString(value.text) || typeof value.version !== "number" || typeof value.throughSequence !== "number")
              throw new Error("Invalid group summary event.");
            db.prepare("INSERT OR REPLACE INTO projection_group_summaries VALUES (?, ?, ?, ?)").run(
              groupId,
              value.version,
              value.throughSequence,
              value.text,
            );
            break;
          }
          case "group.read": {
            if (!isString(value.memberId) || typeof value.throughSequence !== "number")
              throw new Error("Invalid group read event.");
            db.prepare(
              "INSERT INTO projection_group_reads VALUES (?, ?, ?) ON CONFLICT(group_id, member_id) DO UPDATE SET through_sequence = MAX(through_sequence, excluded.through_sequence)",
            ).run(groupId, value.memberId, value.throughSequence);
            break;
          }
          default:
            throw new Error("Unknown group event.");
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  private readSequence(groupId: string, memberId: string): number {
    const row = databaseRow(
      this.database.connection
        .prepare("SELECT through_sequence FROM projection_group_reads WHERE group_id = ? AND member_id = ?")
        .get(groupId, memberId),
    );
    return row ? requiredNumberColumn(row, "through_sequence") : 0;
  }
}

function decodeAssignment(value: unknown): GroupAssignment {
  if (
    !isDynamicRecord(value) ||
    !isString(value.id) ||
    !isString(value.groupId) ||
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
    throw new Error("Invalid stored group assignment.");
  return {
    id: value.id,
    groupId: value.groupId,
    taskId: value.taskId,
    agentId: value.agentId,
    taskRevision: value.taskRevision,
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
