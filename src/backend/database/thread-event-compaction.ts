import type { DatabaseSync } from "node:sqlite";
import type { ConversationMessage, ConversationSnapshot } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import type { DatabaseCore } from "./database-core";
import { databaseRow, objectValue, requiredNumberColumn, requiredStringColumn } from "./database-rows";
import { withTransaction } from "./sqlite-transaction";
import {
  mergeReplayedLiveMessage,
  type ThreadEventMessages,
  ThreadMessageFold,
  threadEventMessages,
} from "./thread-message-fold";

export interface ThreadEventCompactionOptions {
  core: DatabaseCore;
}

export interface ThreadEventCompactionBatch {
  done: boolean;
  events: number;
  rewritten: number;
  bytesBefore: number;
  bytesAfter: number;
  completedThread: boolean;
  failedThread: string | null;
}

const BATCH_EVENTS = 256;
const BATCH_BYTES = 4 * 1024 * 1024;
const MAX_RESTARTS = 3;

interface ThreadProgress {
  threadId: string;
  cutoff: number;
  fold: ThreadMessageFold;
  through: number;
  count: number;
  sequenceSum: number;
  lastSequence: number;
  deletedMessages: number;
  restarts: number;
}

export class ThreadEventCompaction {
  readonly #core: DatabaseCore;
  #current: ThreadProgress | null = null;
  #afterThreadId = "";

  constructor(options: ThreadEventCompactionOptions) {
    this.#core = options.core;
  }

  compactNext(): ThreadEventCompactionBatch {
    const db = this.#core.connection;
    const empty: ThreadEventCompactionBatch = {
      done: false,
      events: 0,
      rewritten: 0,
      bytesBefore: 0,
      bytesAfter: 0,
      completedThread: false,
      failedThread: null,
    };
    const current = this.#current ?? this.#startNextThread(db);
    if (!current) {
      this.#afterThreadId = "";
      return { ...empty, done: true };
    }
    this.#current = current;
    try {
      return withTransaction(db, () => this.#compactBatch(db, current));
    } catch (error) {
      this.#current = null;
      return { ...empty, failedThread: error instanceof Error ? error.name : typeof error };
    }
  }

  #startNextThread(db: DatabaseSync): ThreadProgress | null {
    const row = databaseRow(
      db
        .prepare(
          `SELECT t.thread_id, t.agent_id FROM projection_threads t
           WHERE t.thread_id > ?
             AND NOT EXISTS (SELECT 1 FROM thread_event_compaction c WHERE c.thread_id = t.thread_id)
           ORDER BY t.thread_id LIMIT 1`,
        )
        .get(this.#afterThreadId),
    );
    if (!row) return null;
    const threadId = requiredStringColumn(row, "thread_id");
    this.#afterThreadId = threadId;
    const lastSequence = threadLastSequence(db, threadId);
    return {
      threadId,
      cutoff: lastSequence,
      fold: new ThreadMessageFold(requiredStringColumn(row, "agent_id"), threadId),
      through: 0,
      count: 0,
      sequenceSum: 0,
      lastSequence,
      deletedMessages: deletedMessageCount(db, threadId),
      restarts: 0,
    };
  }

  #compactBatch(db: DatabaseSync, progress: ThreadProgress): ThreadEventCompactionBatch {
    const batch: ThreadEventCompactionBatch = {
      done: false,
      events: 0,
      rewritten: 0,
      bytesBefore: 0,
      bytesAfter: 0,
      completedThread: false,
      failedThread: null,
    };
    const thread = databaseRow(
      db.prepare("SELECT agent_id FROM projection_threads WHERE thread_id = ?").get(progress.threadId),
    );
    if (!thread) {
      this.#current = null;
      return batch;
    }
    if (!this.#earlierEventsUnchanged(db, progress)) {
      if (progress.restarts >= MAX_RESTARTS) {
        this.#current = null;
        return { ...batch, failedThread: "RestartLimit" };
      }
      const lastSequence = threadLastSequence(db, progress.threadId);
      Object.assign(progress, {
        cutoff: lastSequence,
        fold: new ThreadMessageFold(requiredStringColumn(thread, "agent_id"), progress.threadId),
        through: 0,
        count: 0,
        sequenceSum: 0,
        lastSequence,
        deletedMessages: deletedMessageCount(db, progress.threadId),
        restarts: progress.restarts + 1,
      });
    }

    const select = db.prepare(
      `SELECT sequence, event_id, command_id, aggregate_type, aggregate_id, event_type, occurred_at, payload_json
       FROM orchestration_events
       WHERE aggregate_type = 'thread' AND aggregate_id = ? AND sequence > ? AND sequence <= ?
       ORDER BY sequence`,
    );
    const rewrites: Array<{ row: DynamicRecord; payload: string }> = [];
    let bytes = 0;
    let reachedEnd = true;
    for (const value of select.iterate(progress.threadId, progress.through, progress.cutoff)) {
      if (batch.events >= BATCH_EVENTS || bytes >= BATCH_BYTES) {
        reachedEnd = false;
        break;
      }
      const row = databaseRow(value);
      if (!row) continue;
      const sequence = requiredNumberColumn(row, "sequence");
      const payloadJson = requiredStringColumn(row, "payload_json");
      bytes += payloadJson.length;
      batch.events += 1;
      const record = objectValue(JSON.parse(payloadJson));
      const messages = threadEventMessages(record);
      if (record && progress.fold.branchOf(messages) === "changes") {
        const kept = keptChangedMessages(progress.fold.latest, record, messages);
        if (kept) {
          const compacted = JSON.stringify({ ...record, changedMessages: kept });
          rewrites.push({ row, payload: compacted });
          batch.bytesBefore += Buffer.byteLength(payloadJson);
          batch.bytesAfter += Buffer.byteLength(compacted);
        }
      }
      progress.fold.apply(sequence, messages);
      progress.through = sequence;
      progress.count += 1;
      progress.sequenceSum += sequence;
    }

    const remove = db.prepare("DELETE FROM orchestration_events WHERE sequence = ?");
    const insert = db.prepare(
      `INSERT INTO orchestration_events
         (sequence, event_id, command_id, aggregate_type, aggregate_id, event_type, occurred_at, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const { row, payload } of rewrites) {
      remove.run(requiredNumberColumn(row, "sequence"));
      insert.run(
        requiredNumberColumn(row, "sequence"),
        requiredStringColumn(row, "event_id"),
        requiredStringColumn(row, "command_id"),
        requiredStringColumn(row, "aggregate_type"),
        requiredStringColumn(row, "aggregate_id"),
        requiredStringColumn(row, "event_type"),
        requiredStringColumn(row, "occurred_at"),
        payload,
      );
    }
    batch.rewritten = rewrites.length;

    progress.lastSequence = threadLastSequence(db, progress.threadId);
    progress.deletedMessages = deletedMessageCount(db, progress.threadId);
    if (reachedEnd) {
      db.prepare(
        `INSERT INTO thread_event_compaction (thread_id, through_sequence, compacted_at) VALUES (?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           through_sequence = excluded.through_sequence, compacted_at = excluded.compacted_at`,
      ).run(progress.threadId, progress.cutoff, new Date().toISOString());
      this.#current = null;
      batch.completedThread = true;
    }
    return batch;
  }

  #earlierEventsUnchanged(db: DatabaseSync, progress: ThreadProgress): boolean {
    if (deletedMessageCount(db, progress.threadId) !== progress.deletedMessages) return false;
    if (threadLastSequence(db, progress.threadId) === progress.lastSequence) return true;
    const row = databaseRow(
      db
        .prepare(
          `SELECT count(*) AS events, total(sequence) AS sequences FROM orchestration_events
           WHERE aggregate_type = 'thread' AND aggregate_id = ? AND sequence <= ?`,
        )
        .get(progress.threadId, progress.through),
    );
    return (
      row !== null &&
      requiredNumberColumn(row, "events") === progress.count &&
      requiredNumberColumn(row, "sequences") === progress.sequenceSum
    );
  }
}

function keptChangedMessages(
  latest: ConversationSnapshot | null,
  record: DynamicRecord,
  messages: ThreadEventMessages,
): unknown[] | null {
  const raw = record.changedMessages;
  if (!Array.isArray(raw) || messages.changedMessages.length === 0 || !latest) return null;
  const shown = new Map<string, ConversationMessage>();
  const repeated = new Set<string>();
  for (const message of latest.messages) {
    if (shown.has(message.id)) repeated.add(message.id);
    shown.set(message.id, message);
  }
  const lastById = new Map(messages.changedMessages.map((message) => [message.id, message]));
  const removed = new Set(messages.removedMessageIds);
  const unneeded = new Set<string>();
  for (const [id, changed] of lastById) {
    const existing = shown.get(id);
    if (!existing || removed.has(id) || repeated.has(id)) continue;
    if (sameValue(mergeReplayedLiveMessage(existing, changed), existing)) unneeded.add(id);
  }
  if (unneeded.size === 0) return null;
  const needed = messages.changedEntries.map((message) => !message || !unneeded.has(message.id));
  const keepsMessage = messages.changedEntries.some((message, index) => message !== null && needed[index]);
  if (!keepsMessage && messages.removedMessageIds.length === 0 && !messages.hasActiveTurnChange) {
    needed[messages.changedEntries.findIndex((message) => message !== null)] = true;
  }
  return needed.every(Boolean) ? null : raw.filter((_, index) => needed[index]);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => sameValue(value, right[index]));
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => key === rightKeys[index] && sameValue(left[key], right[key]));
}

function isPlainObject(value: unknown): value is DynamicRecord {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function threadLastSequence(db: DatabaseSync, threadId: string): number {
  const row = databaseRow(
    db
      .prepare(
        "SELECT coalesce(max(sequence), 0) AS last FROM orchestration_events WHERE aggregate_type = 'thread' AND aggregate_id = ?",
      )
      .get(threadId),
  );
  return row ? requiredNumberColumn(row, "last") : 0;
}

function deletedMessageCount(db: DatabaseSync, threadId: string): number {
  const row = databaseRow(
    db.prepare("SELECT count(*) AS deleted FROM projection_deleted_thread_messages WHERE thread_id = ?").get(threadId),
  );
  return row ? requiredNumberColumn(row, "deleted") : 0;
}
