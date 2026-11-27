import type { DatabaseSync } from "node:sqlite";
import type { ConversationMessage, ConversationSnapshot } from "@openbot/contracts/ipc";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { CONVERSATION_UPDATED, GENERATED_UPDATE_COMMAND } from "./conversation-writer";
import { type DatabaseCore, deleteReceiptsOf } from "./database-core";
import { databaseRow, objectValue, requiredNumberColumn, requiredStringColumn } from "./database-rows";
import { withTransaction } from "./sqlite-transaction";
import {
  mergeReplayedLiveMessage,
  type ThreadEventBranch,
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
  deleted: number;
  bytesBefore: number;
  bytesAfter: number;
  completedThread: boolean;
  failedThread: string | null;
}

interface MessageUpdate {
  sequence: number;
  keys: string[];
}

interface SupersededUpdates {
  lastUpdate: Map<string, MessageUpdate>;
  openItems: Map<number, number>;
}

const BATCH_EVENTS = 256;
const REFOLD_MIN_NEW_EVENTS = 1000;
const BATCH_BYTES = 4 * 1024 * 1024;
const BATCH_MILLISECONDS = 25;
const MAX_RESTARTS = 3;
export const RECOMPACTION_INTERVAL_MILLISECONDS = 6 * 60 * 60 * 1000;

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
  updates: SupersededUpdates;
}

function supersededUpdates(): SupersededUpdates {
  return { lastUpdate: new Map(), openItems: new Map() };
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
      deleted: 0,
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
    const now = Date.now();
    const row = databaseRow(
      db
        .prepare(
          `SELECT t.thread_id, t.agent_id FROM projection_threads t
           WHERE t.thread_id > ?
             AND NOT EXISTS (
               SELECT 1 FROM thread_event_compaction c
               WHERE c.thread_id = t.thread_id AND (
                 c.compacted_at BETWEEN ? AND ? OR (
                   SELECT count(*) FROM orchestration_events e
                   WHERE e.aggregate_type = 'thread' AND e.aggregate_id = t.thread_id AND e.sequence > c.through_sequence
                 ) < max(?, (SELECT count(*) FROM projection_thread_messages m WHERE m.thread_id = t.thread_id))
               )
             )
           ORDER BY t.thread_id LIMIT 1`,
        )
        .get(
          this.#afterThreadId,
          new Date(now - RECOMPACTION_INTERVAL_MILLISECONDS).toISOString(),
          new Date(now).toISOString(),
          REFOLD_MIN_NEW_EVENTS,
        ),
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
      updates: supersededUpdates(),
    };
  }

  #compactBatch(db: DatabaseSync, progress: ThreadProgress): ThreadEventCompactionBatch {
    const batch: ThreadEventCompactionBatch = {
      done: false,
      events: 0,
      rewritten: 0,
      deleted: 0,
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
        updates: supersededUpdates(),
      });
    }

    const select = db.prepare(
      `SELECT sequence, event_id, command_id, aggregate_type, aggregate_id, event_type, occurred_at, payload_json
       FROM orchestration_events
       WHERE aggregate_type = 'thread' AND aggregate_id = ? AND sequence > ? AND sequence <= ?
       ORDER BY sequence`,
    );
    const rewrites: Array<{ row: DynamicRecord; payload: string }> = [];
    const superseded: number[] = [];
    let bytes = 0;
    let reachedEnd = true;
    const started = performance.now();
    for (const value of select.iterate(progress.threadId, progress.through, progress.cutoff)) {
      if (
        batch.events >= BATCH_EVENTS ||
        bytes >= BATCH_BYTES ||
        (batch.events > 0 && performance.now() - started >= BATCH_MILLISECONDS)
      ) {
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
      const branch = progress.fold.branchOf(messages);
      const deletable =
        requiredStringColumn(row, "event_type") === CONVERSATION_UPDATED &&
        GENERATED_UPDATE_COMMAND.test(requiredStringColumn(row, "command_id"));
      let storedMessages = messages;
      if (record && branch === "changes") {
        const kept = keptChangedMessages(progress.fold.latest, record, messages);
        if (kept) {
          const compactedRecord = { ...record, changedMessages: kept };
          const compacted = JSON.stringify(compactedRecord);
          rewrites.push({ row, payload: compacted });
          batch.bytesBefore += Buffer.byteLength(payloadJson);
          batch.bytesAfter += Buffer.byteLength(compacted);
          storedMessages = threadEventMessages(compactedRecord);
        }
      }
      superseded.push(
        ...trackSupersededUpdates(progress.updates, progress.fold.latest, sequence, branch, storedMessages, deletable),
      );
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
    batch.deleted = deleteSupersededUpdates(db, progress, superseded);

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

function trackSupersededUpdates(
  updates: SupersededUpdates,
  latest: ConversationSnapshot | null,
  sequence: number,
  branch: ThreadEventBranch,
  messages: ThreadEventMessages,
  deletable: boolean,
): number[] {
  if (branch === "snapshot") {
    updates.lastUpdate.clear();
    return [];
  }
  if (branch !== "changes") {
    const touched = messages.streamedMessage ?? messages.appendedMessage ?? messages.importedMessage;
    if (touched) updates.lastUpdate.delete(touched.id);
    return [];
  }
  const removed = new Set(messages.removedMessageIds);
  for (const id of removed) updates.lastUpdate.delete(id);
  const shownTimes = countIds(latest?.messages ?? []);
  const changedTimes = countIds(messages.changedMessages);
  const singleUpdate = (id: string) => changedTimes.get(id) === 1 && shownTimes.get(id) === 1 && !removed.has(id);
  const setsActiveTurn = isString(messages.activeTurnId) || messages.activeTurnId === null;
  const tracked =
    deletable &&
    removed.size === 0 &&
    messages.changedMessages.length > 0 &&
    messages.changedEntries.every((entry) => entry !== null) &&
    messages.changedMessages.every((message) => singleUpdate(message.id));
  const done: number[] = [];
  for (const message of messages.changedMessages) {
    const previous = updates.lastUpdate.get(message.id);
    updates.lastUpdate.delete(message.id);
    if (!singleUpdate(message.id)) continue;
    const keys = definedKeys(message);
    if (previous && setsActiveTurn && previous.keys.every((key) => keys.includes(key))) {
      const open = (updates.openItems.get(previous.sequence) ?? 0) - 1;
      if (open > 0) updates.openItems.set(previous.sequence, open);
      else if (updates.openItems.delete(previous.sequence)) done.push(previous.sequence);
    }
    if (tracked) updates.lastUpdate.set(message.id, { sequence, keys });
  }
  if (tracked) updates.openItems.set(sequence, messages.changedMessages.length);
  return done;
}

function deleteSupersededUpdates(db: DatabaseSync, progress: ThreadProgress, sequences: readonly number[]): number {
  const remove = db.prepare(
    `DELETE FROM orchestration_events
     WHERE sequence = ? AND aggregate_type = 'thread' AND aggregate_id = ? AND event_type = ?
     RETURNING command_id`,
  );
  const removeActivities = db.prepare(
    "DELETE FROM projection_thread_activities WHERE thread_id = ? AND last_event_sequence = ?",
  );
  const commandIds: string[] = [];
  for (const sequence of sequences) {
    const row = databaseRow(remove.get(sequence, progress.threadId, CONVERSATION_UPDATED));
    if (!row) continue;
    commandIds.push(requiredStringColumn(row, "command_id"));
    removeActivities.run(progress.threadId, sequence);
    progress.count -= 1;
    progress.sequenceSum -= sequence;
  }
  deleteReceiptsOf(db, commandIds);
  return commandIds.length;
}

function countIds(messages: readonly ConversationMessage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const message of messages) counts.set(message.id, (counts.get(message.id) ?? 0) + 1);
  return counts;
}

function definedKeys(message: ConversationMessage): string[] {
  return Object.entries(message).flatMap(([key, value]) => (value === undefined ? [] : [key]));
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
