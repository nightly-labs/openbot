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

/** One batch of `ThreadEventCompaction.compactNext`. */
export interface ThreadEventCompactionBatch {
  /** No thread is left to compact in this run. */
  done: boolean;
  /** The events that the batch read. */
  events: number;
  /** The events whose payload the batch wrote again, smaller. */
  rewritten: number;
  /** The payload bytes of the rewritten events, before and after. */
  bytesBefore: number;
  bytesAfter: number;
  /** The batch finished a thread. */
  completedThread: boolean;
  /**
   * The batch could not compact a thread and rolled back. The run goes on with the next thread, and
   * the next run tries this one again. The name of the error only: its message can hold a payload.
   */
  failedThread: string | null;
}

const BATCH_EVENTS = 256;
const BATCH_BYTES = 4 * 1024 * 1024;
/** A thread whose earlier events change this many times during one run waits for the next run. */
const MAX_RESTARTS = 3;

interface ThreadProgress {
  threadId: string;
  /** The last event of the thread when its compaction started. Later events have the new shape. */
  cutoff: number;
  fold: ThreadMessageFold;
  /** The last event that the fold read. */
  through: number;
  /** The number and the sum of the sequences of the events that the fold read. */
  count: number;
  sequenceSum: number;
  /** The last event and the deleted-message count when the previous batch ended. */
  lastSequence: number;
  deletedMessages: number;
  restarts: number;
}

/**
 * Removes the `changedMessages` items of old thread events that do not change a replay.
 *
 * Before #8166 and #8794, each conversation update wrote every message of the thread again, so
 * `orchestration_events` holds one full copy of the chat for each update (11.9 GB on one server).
 * After start, this class reads each thread's events in sequence order with the replay's own fold
 * (`ThreadMessageFold`) and drops an item when the replay already has that message with the same
 * value: the message is in the fold before the event, the event does not remove it, and
 * `mergeReplayedLiveMessage` of the message and the item gives the same message, with the same keys
 * in the same order. Each event row stays, with its sequence, type, detail, removed ids and active
 * turn, so the activities, the revision and the receipts of a replay stay the same. An event that
 * would then take another branch of the replay keeps one item.
 *
 * It works in small transactions and keeps the fold of the current thread in memory between them.
 * Before each batch, it checks that no earlier event of the thread was deleted or scrubbed since
 * the previous batch, and starts the thread again when one was. A thread is done when its row is in
 * `thread_event_compaction`. A kill loses only the work of the current thread since its start: a
 * second pass over compacted events finds nothing to drop. The class never imports the facade.
 */
export class ThreadEventCompaction {
  readonly #core: DatabaseCore;
  #current: ThreadProgress | null = null;
  #afterThreadId = "";

  constructor(options: ThreadEventCompactionOptions) {
    this.#core = options.core;
  }

  /** Compacts one bounded batch of events of the current or the next thread, in its own transaction. */
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
      // The next run starts again from the first thread. It skips the threads that are done and
      // tries again the ones that failed in this run.
      this.#afterThreadId = "";
      return { ...empty, done: true };
    }
    this.#current = current;
    try {
      return withTransaction(db, () => this.#compactBatch(db, current));
    } catch (error) {
      // The fold already read events that the rollback undid. This thread waits for the next run.
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
      // The thread was deleted between two batches. Its events went with it.
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

    // Delete and insert again with the same sequence: an UPDATE that makes a row smaller leaves its
    // pages almost empty (see `compactRows` in provider-history-store.ts).
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

  /**
   * Whether the events that the fold read are still the same. A write between two batches can delete
   * an earlier event (a superseded update or flush, a pruned snapshot) or scrub a deleted message
   * from it, and the fold would then not be the replay's. Each of these writes also appends an event
   * or records a deleted message, so the full count runs only when one of those two values moved.
   */
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

/**
 * The `changedMessages` items of a "changes" event that a replay needs, or null when it needs all
 * of them. `latest` is the fold before the event.
 */
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
  // The replay applies the last item of an id (a Map), so the decision is made on that item.
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
    // Without a message, the event would not take the "changes" branch, and the replay would not
    // move its revision to it. The first message stays; it changes nothing.
    needed[messages.changedEntries.findIndex((message) => message !== null)] = true;
  }
  return needed.every(Boolean) ? null : raw.filter((_, index) => needed[index]);
}

/**
 * Deep equality that also compares the order of keys and keys with an undefined value. A message
 * becomes `message_json` with `JSON.stringify`, and a later merge keeps the position of each key.
 */
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
