import { createHash } from "node:crypto";
import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import {
  type AgentEvent,
  type AgentSummary,
  CONVERSATION_SNAPSHOT_MESSAGE_LIMIT,
  type ConversationMessage,
  type ConversationSnapshot,
  type QueueDeliveryStatus,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import type { AgentClient } from "../agent-client";
import type { AgentStore } from "../agent-store";
import { isTurnEndEvent, withoutQueuePositions } from "../database/conversation-writer";
import { withTransaction } from "../database/sqlite-transaction";
import { MAILBOX_CONVERSATION_MESSAGE_LIMIT } from "../mailbox-store";
import type { OpenBotDatabase } from "../openbot-database";
import { conversationContentSignature } from "./delivery-content";

interface TransactionScope {
  readonly rollback: (() => void)[];
  readonly commit: (() => void)[];
}

/**
 * The chats that main keeps in memory only because something read them. A chat of 2,000 messages
 * takes about 1 MB, and marking a chat read loads it, so the cache grew with each chat that the user
 * opened. A chat that goes is read again from the database when it is next needed, the same as a
 * chat that was not opened since the app started.
 */
/** The maximum serialized size retained for one completed conversation. */
export const CONVERSATION_CACHE_BYTES_LIMIT = 8 * 1024 * 1024;

/** The maximum serialized size retained by all completed conversation caches. */
export const CONVERSATION_CACHE_TOTAL_BYTES_LIMIT = 64 * 1024 * 1024;

/**
 * A chat whose cache does not match what devices last got is sent whole again with no stored change.
 * When that happens on each queue change, it made a hosted server too slow to answer Signal. One such
 * send is normal, for example after a provider read, so the warning waits for a repeat and shows it
 * at most once a minute for each chat.
 */
const UNSTORED_SENDS_WARNING_COUNT = 10;
const UNSTORED_SENDS_WARNING_INTERVAL_MS = 60_000;

const logger = createOpenBotLogger("conversation-runtime");

/** Only the caller that opened the transaction holds a scope, so a nested call finds the owner's. */
const openTransactions = new WeakMap<OpenBotDatabase, TransactionScope>();

/**
 * Runs `work` in `withTransaction`. Nesting is load-bearing: `deleteRoutine` drives a routine
 * mutation whose `beforeMutate` hook appends a run transition in the same transaction, and an
 * approval response can append a hosted-site event inside an outer one.
 *
 * A nested call queues `onCommit` and `onRollback` on the owner, so in-memory state shows only
 * committed rows. When a level fails, its savepoint is rolled back, so the effects queued inside it
 * are removed: its rollbacks run at once, newest first, and its commits never run.
 */
export function withDatabaseTransaction<T>(
  database: OpenBotDatabase,
  work: () => T,
  onRollback?: () => void,
  onCommit?: () => void,
): T {
  const connection = database.connection;
  // `isTransaction`, not the map, decides who owns one: a transaction opened elsewhere has no
  // scope in the map, and this call must still join it.
  const nested = connection.isTransaction;
  const owner = nested ? openTransactions.get(database) : undefined;
  const scope: TransactionScope = owner ?? { rollback: [], commit: [] };
  const rollbackMark = scope.rollback.length;
  const commitMark = scope.commit.length;
  let ran = false;
  let result: T;
  try {
    result = withTransaction(connection, () => {
      ran = true;
      if (!nested) openTransactions.set(database, scope);
      return work();
    });
  } catch (error) {
    if (!nested) openTransactions.delete(database);
    // A failed `BEGIN` or `SAVEPOINT` ran no work.
    if (!ran) throw error;
    scope.commit.splice(commitMark);
    for (const restore of scope.rollback.splice(rollbackMark).reverse()) restore();
    onRollback?.();
    throw error;
  }
  if (owner) {
    if (onRollback) owner.rollback.push(onRollback);
    if (onCommit) owner.commit.push(onCommit);
    return result;
  }
  // A transaction opened elsewhere has no queue, so the effect runs now.
  if (nested) {
    onCommit?.();
    return result;
  }
  // Past COMMIT the rows are durable, so a throwing effect must not reach the restorers. The scope
  // is cleared first: an effect can re-enter this function and must open its own transaction.
  openTransactions.delete(database);
  // Every effect runs, so a throw from one does not skip the rest.
  const failures: unknown[] = [];
  for (const effect of [...scope.commit, onCommit]) {
    try {
      effect?.();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, sourceText("error.agent.commitEffectsFailed"));
  return result;
}

/**
 * How long an agent's snapshot stays in memory after its last use. The sweep runs at the same
 * interval, so an idle snapshot leaves memory between one and two periods after its last use.
 */
const CONVERSATION_SNAPSHOT_IDLE_MS = 10 * 60_000;

interface EvictedSnapshot {
  threadId: string;
  snapshot: WeakRef<ConversationSnapshot>;
}

interface CachedSnapshot {
  snapshot: ConversationSnapshot;
  bytes: number;
  usedAt: number;
  signature: string;
  /** The text size of the messages that `signature` hashed (see `textSize`). */
  textSize: number;
  activeTurnId: string | null;
  messageSignatures: Map<string, string>;
  omittedMessageIds: Set<string>;
}

export interface ConversationTransaction {
  threadId: string;
  snapshot: ConversationSnapshot;
}

export interface ConversationTransactionResult<T> {
  result: T;
  snapshot: ConversationSnapshot;
}

/**
 * Owns the live conversation projection and the provider-thread routing index.
 *
 * The four maps are one bidirectional index, which is why they are one class: `threadToAgent` and
 * `loadedThreads` are keyed by the *external* provider thread id, `snapshots` and
 * `conversationSignatures` by agent id, and every conversion between those keyspaces runs through
 * `publicThreadId` or `ensureSnapshot`.
 */
export class ConversationRuntime {
  readonly #store: AgentStore;
  readonly #emit: (event: AgentEvent) => void;
  readonly #activeTurnChanged: ((agentId: string) => void) | undefined;
  /**
   * Deliberately not `store.list()`: the service filters out agents that are mid-duplication, and
   * `requireKnownAgent` must keep throwing for those so a transaction on one rolls back.
   */
  readonly #listAgents: () => AgentSummary[];
  readonly #snapshots = new Map<string, ConversationSnapshot>();
  /** Completed snapshots are bounded views. SQLite remains the source of truth for the rest. */
  readonly #cachedSnapshots = new Map<string, CachedSnapshot>();
  #cachedSnapshotBytes = 0;
  readonly #snapshotUsedAt = new Map<string, number>();
  /**
   * An idle snapshot leaves `snapshots` but stays here while a caller still holds it, for example
   * across an `await`. The next read then gets that same object, not a second copy: a stale copy
   * that `persistConversation` writes later deletes the messages the other copy added. When no
   * caller holds it, the next read rebuilds it from SQLite, which held the same content at eviction.
   */
  readonly #evictedSnapshots = new Map<string, EvictedSnapshot>();
  #evictionTimer: NodeJS.Timeout | null = null;
  readonly #conversationSignatures = new Map<string, string>();
  /** Counts the publishes, so an emit knows when a listener published a chat while it ran. */
  #publishes = 0;
  /**
   * The messages that a person deleted, by thread, read from SQLite at the first publish of the
   * thread. A provider read or a sync can bring such a message back into a snapshot; it never shows.
   */
  readonly #deletedMessageIds = new Map<string, Set<string>>();
  readonly #unstoredSends = new Map<string, { since: number; sends: number }>();
  readonly #threadToAgent = new Map<string, string>();
  readonly #loadedThreads = new Map<string, AgentClient>();
  /**
   * The sessions `unloadAgentThreads` unloaded, with their client. The client keeps such a session
   * running until the next turn opens it again or its idle timer closes it. An agent delete must
   * close it first: on Windows its process keeps the workspace in use.
   */
  readonly #unloadedThreads = new Map<string, AgentClient>();
  readonly #executionSnapshots = new Map<string, ConversationSnapshot>();
  readonly #cachedExecutionSnapshots = new Map<string, CachedSnapshot>();
  readonly #publicThreads = new Map<string, string>();
  readonly #forgottenExecutionThreads = new Set<string>();
  /** The execution threads that are tasks: they run beside the agent's own chat, not after it. */
  readonly #taskThreads = new Set<string>();
  /**
   * The execution threads of channels, with their channel. A channel turn runs beside the agent's
   * own chat and its tasks, as a task does, unless the provider runs one turn at a time.
   */
  readonly #channelThreads = new Map<string, string>();
  /**
   * The open provider sessions of routine runs, with their agent. A routine run has its own session,
   * which closes when the run ends, so the agent's long chat session does not grow with it.
   */
  readonly #routineSessions = new Map<string, string>();

  constructor(
    store: AgentStore,
    emit: (event: AgentEvent) => void,
    listAgents: () => AgentSummary[],
    activeTurnChanged?: (agentId: string) => void,
  ) {
    this.#store = store;
    this.#emit = emit;
    this.#listAgents = listAgents;
    this.#activeTurnChanged = activeTurnChanged;
  }

  /** Changes live activity before a turn can yield to mailbox or attachment work. */
  setActiveTurn(snapshot: ConversationSnapshot, turnId: string | null): void {
    if (snapshot.activeTurnId === turnId) return;
    snapshot.activeTurnId = turnId;
    this.#activeTurnChanged?.(snapshot.agentId);
  }

  /**
   * The agent's working snapshot, or its bounded recent-history view.
   *
   * A completed chat can contain more messages than the working cache. This method returns only the
   * bounded working projection; the database remains the source for older messages.
   */
  snapshot(agentId: string): ConversationSnapshot | undefined {
    const live = this.#snapshots.get(agentId);
    if (live) {
      const now = Date.now();
      this.#snapshotUsedAt.set(agentId, now);
      const cached = this.#cachedSnapshots.get(agentId);
      if (cached) cached.usedAt = now;
      return live;
    }
    const evicted = this.#evictedSnapshots.get(agentId);
    if (!evicted) return undefined;
    const retained = evicted.snapshot.deref();
    const snapshot =
      retained ??
      pageSnapshot(this.#store.database.readConversationPage(agentId, evicted.threadId, { type: "latest" }, 100));
    if (retained) this.#restoreEvictedSnapshot(agentId, snapshot);
    else this.#keepSnapshot(agentId, snapshot);
    return this.#snapshots.get(agentId) ?? snapshot;
  }

  /**
   * The snapshot in memory now, with no SQLite read and no change to its idle time. It is for a
   * reader of every agent that falls back to SQLite itself: `snapshot` would load all of them again.
   */
  loadedSnapshot(agentId: string): ConversationSnapshot | undefined {
    return this.#snapshots.get(agentId);
  }

  /**
   * The chat that a change must publish: the cached one, an idle one that `snapshot` brings back, or
   * one that the limit dropped, read again from the database. A chat that main never loaded stays
   * unloaded.
   */
  snapshotToUpdate(agentId: string): ConversationSnapshot | undefined {
    // Queue and mailbox notifications must not load every agent's recent page at startup. A
    // mutating provider path calls `ensureSnapshot` explicitly; this helper only updates a cache
    // that is already loaded or that was deliberately idle-evicted and can be restored safely.
    return this.snapshot(agentId);
  }

  setSnapshot(agentId: string, snapshot: ConversationSnapshot): void {
    this.#setSnapshot(agentId, snapshot, messageDigests());
  }

  #setSnapshot(agentId: string, snapshot: ConversationSnapshot, digests: MessageDigests): void {
    if (snapshot.threadId && this.#forgottenExecutionThreads.has(snapshot.threadId)) return;
    const current = this.#snapshots.get(agentId);
    if (current?.activeTurnId && current.activeTurnId === snapshot.activeTurnId) {
      const bounded = boundedConversationSnapshot(snapshot, digests).snapshot;
      copySnapshotContents(current, bounded);
      this.#keepSnapshot(agentId, current, digests);
      this.#rememberRead(agentId);
      return;
    }
    if (snapshot.threadId && snapshot.threadId !== this.#store.get(agentId)?.threadId)
      this.#setExecutionSnapshot(snapshot.threadId, snapshot, digests);
    else {
      this.#keepSnapshot(agentId, snapshot, digests);
      this.#rememberRead(agentId);
    }
  }

  /**
   * `digests` and `signature` come from a caller that already made them for this snapshot: an emit
   * makes the JSON of each message once and uses it for every check.
   */
  #keepSnapshot(agentId: string, snapshot: ConversationSnapshot, digests = messageDigests(), signature?: string): void {
    this.#evictedSnapshots.delete(agentId);
    this.#dropCachedSnapshot(agentId);
    const cached = boundedConversationSnapshot(snapshot, digests, signature);
    const current = this.#snapshots.get(agentId);
    const previousTurnId = current?.activeTurnId ?? null;
    const retained = current === snapshot ? copySnapshotContents(snapshot, cached.snapshot) : cached.snapshot;
    this.#snapshots.set(agentId, retained);
    this.#cachedSnapshots.set(agentId, retained === cached.snapshot ? cached : { ...cached, snapshot: retained });
    this.#cachedSnapshotBytes += cached.bytes;
    if (previousTurnId !== retained.activeTurnId) this.#activeTurnChanged?.(agentId);
    this.#evictCachedSnapshots();
    this.#snapshotUsedAt.set(agentId, Date.now());
    this.#evictionTimer ??= setInterval(() => {
      try {
        this.evictIdleSnapshots();
      } catch {
        // A failed sweep changes nothing, and after `stop` the database is closed. The next
        // snapshot that is kept starts the timer again.
        this.dispose();
      }
    }, CONVERSATION_SNAPSHOT_IDLE_MS);
    this.#evictionTimer.unref?.();
  }

  #setExecutionSnapshot(
    threadId: string,
    snapshot: ConversationSnapshot,
    digests = messageDigests(),
    signature?: string,
  ): void {
    this.#dropCachedExecutionSnapshot(threadId);
    const cached = boundedConversationSnapshot(snapshot, digests, signature);
    const current = this.#executionSnapshots.get(threadId);
    const previousTurnId = current?.activeTurnId ?? null;
    const retained = current === snapshot ? copySnapshotContents(snapshot, cached.snapshot) : cached.snapshot;
    this.#executionSnapshots.set(threadId, retained);
    this.#cachedExecutionSnapshots.set(
      threadId,
      retained === cached.snapshot ? cached : { ...cached, snapshot: retained },
    );
    this.#cachedSnapshotBytes += cached.bytes;
    if (previousTurnId !== retained.activeTurnId) this.#activeTurnChanged?.(retained.agentId);
    this.#evictCachedSnapshots();
  }

  #restoreEvictedSnapshot(agentId: string, snapshot: ConversationSnapshot): void {
    this.#evictedSnapshots.delete(agentId);
    this.#keepSnapshot(agentId, snapshot);
  }

  #dropCachedSnapshot(agentId: string): void {
    const cached = this.#cachedSnapshots.get(agentId);
    if (!cached) return;
    this.#cachedSnapshotBytes -= cached.bytes;
    this.#cachedSnapshots.delete(agentId);
  }

  #dropCachedExecutionSnapshot(threadId: string): void {
    const cached = this.#cachedExecutionSnapshots.get(threadId);
    if (!cached) return;
    this.#cachedSnapshotBytes -= cached.bytes;
    this.#cachedExecutionSnapshots.delete(threadId);
  }

  #evictCachedSnapshots(): void {
    // Only a trim changes cache content while this runs, so each full signature is computed once
    // per call, not once per removal.
    const committed = new Map<CachedSnapshot, boolean>();
    const isCommitted = (cached: CachedSnapshot): boolean => {
      let result = committed.get(cached);
      if (result === undefined) {
        result = this.#cacheIsCommitted(cached);
        committed.set(cached, result);
      }
      return result;
    };
    // A chat with a turn that runs and nothing left to trim, for example only messages that mailbox
    // sync adds back, is passed over so that the budget can still evict other chats.
    const untrimmable = new Set<CachedSnapshot>();
    const trim = (cached: CachedSnapshot): void => {
      if (!this.#trimCompletedCache(cached)) {
        untrimmable.add(cached);
        return;
      }
      // The trim edits the array in place, so a cache that holds the same array is checked again.
      for (const other of committed.keys()) {
        if (other !== cached && other.snapshot.messages === cached.snapshot.messages) committed.delete(other);
      }
    };
    // The least recently used first. The sort is stable, so of two chats used at the same time, an
    // agent chat goes before a thread, and each in map order, as before.
    let byAge: Array<{ kind: "agent" | "execution"; id: string; cached: CachedSnapshot }> | undefined;
    while (this.#cachedSnapshotBytes > CONVERSATION_CACHE_TOTAL_BYTES_LIMIT) {
      byAge ??= [
        ...[...this.#cachedSnapshots].map(([id, cached]) => ({ kind: "agent" as const, id, cached })),
        ...[...this.#cachedExecutionSnapshots].map(([id, cached]) => ({ kind: "execution" as const, id, cached })),
      ].sort((left, right) => left.cached.usedAt - right.cached.usedAt);
      // A full signature is computed only for a chat that is the oldest one left, not for each
      // cached chat. Each call on a full cache otherwise serialized the whole budget again (#7250).
      const oldest = byAge.find(({ kind, id, cached }) => {
        const current = kind === "agent" ? this.#cachedSnapshots.get(id) : this.#cachedExecutionSnapshots.get(id);
        if (current !== cached || untrimmable.has(cached)) return false;
        if (cached.snapshot.messages.every((message) => isActiveMessage(message, cached.snapshot.activeTurnId)))
          return false;
        // An agent chat with no turn that waits for a teammate stays, as below, so its signature is not made.
        if (kind === "agent" && !cached.snapshot.activeTurnId && cached.snapshot.messages.some(hasActiveDelivery))
          return false;
        return isCommitted(cached);
      });
      if (!oldest) return;
      if (oldest.kind === "agent") {
        const cached = this.#cachedSnapshots.get(oldest.id);
        if (cached?.snapshot.activeTurnId) trim(cached);
        // SQLite cannot rebuild a request that waits for a teammate, as the idle sweep says.
        else if (cached?.snapshot.messages.some(hasActiveDelivery)) untrimmable.add(cached);
        else {
          // Keep the same recovery path as idle eviction. A caller may still hold this snapshot
          // while the process budget evicts it; dropping the map entry without a marker would make
          // queue and mailbox updates skip this agent until a full conversation read.
          if (cached?.snapshot.threadId) {
            this.#evictedSnapshots.set(oldest.id, {
              threadId: cached.snapshot.threadId,
              snapshot: new WeakRef(cached.snapshot),
            });
          }
          this.#dropCachedSnapshot(oldest.id);
          this.#snapshots.delete(oldest.id);
          this.#snapshotUsedAt.delete(oldest.id);
        }
      } else {
        const cached = this.#cachedExecutionSnapshots.get(oldest.id);
        if (cached?.snapshot.activeTurnId) trim(cached);
        else {
          // Keep the execution-thread identity for routing, but release its message objects. The
          // next ensureSnapshot call sees the empty projection and rebuilds the recent page from
          // SQLite instead of retaining an evicted transcript through this strong map reference.
          const snapshot = this.#executionSnapshots.get(oldest.id);
          if (snapshot) snapshot.messages = [];
          this.#dropCachedExecutionSnapshot(oldest.id);
        }
      }
    }
  }

  #cacheIsCommitted(cached: CachedSnapshot): boolean {
    // Streamed text changes a chat in place. A different text size shows that with no JSON of the chat,
    // which a full cache otherwise made for each chat that streams, on each write.
    if (cached.textSize !== textSize(cached.snapshot)) return false;
    return cached.signature === conversationContentSignature(cached.snapshot);
  }

  /**
   * Removes the oldest completed messages, all in one pass, until the process budget holds or none
   * remain. The trimmed chat stays the oldest, so removing them one by one would pick it each time.
   */
  #trimCompletedCache(cached: CachedSnapshot): boolean {
    const activeTurnId = cached.snapshot.activeTurnId;
    const completed = cached.snapshot.messages.filter((message) => !isActiveMessage(message, activeTurnId));
    const active = cached.snapshot.messages.filter((message) => isActiveMessage(message, activeTurnId));
    const digests = messageDigests();
    const removed = oldestMessagesToRemove(
      completed,
      active,
      this.#cachedSnapshotBytes - CONVERSATION_CACHE_TOTAL_BYTES_LIMIT,
      digests,
    );
    if (removed.size === 0) return false;
    // In place, because a caller can hold this array.
    const messages = cached.snapshot.messages;
    let kept = 0;
    for (const message of messages) {
      if (removed.has(message)) {
        cached.omittedMessageIds.add(message.id);
        cached.messageSignatures.delete(message.id);
        continue;
      }
      messages[kept] = message;
      kept += 1;
    }
    messages.length = kept;
    const previousBytes = cached.bytes;
    cached.bytes = completedCacheBytes(cached.snapshot, digests);
    cached.signature = conversationContentSignature(cached.snapshot, digests.json);
    cached.textSize = textSize(cached.snapshot);
    cached.activeTurnId = cached.snapshot.activeTurnId;
    this.#cachedSnapshotBytes += cached.bytes - previousBytes;
    return true;
  }

  /**
   * Removes from memory each agent snapshot that is idle and that SQLite can rebuild with the same
   * content. A snapshot stays when it has no thread, has a turn that runs, waits for a delivery, or is different from
   * SQLite: streamed text before its flush, and mailbox messages that a read merged, are in memory
   * only. `revision` is not compared: a rebuilt snapshot takes the thread's last event sequence from
   * SQLite, as after a restart.
   */
  evictIdleSnapshots(now = Date.now()): void {
    // A read inside a transaction sees rows that a ROLLBACK can still discard.
    if (this.#store.database.connection.isTransaction) return;
    for (const [agentId, snapshot] of this.#snapshots) {
      if ((this.#snapshotUsedAt.get(agentId) ?? 0) > now - CONVERSATION_SNAPSHOT_IDLE_MS) continue;
      // A snapshot that must stay is read again only after one more idle period.
      this.#snapshotUsedAt.set(agentId, now);
      if (!snapshot.threadId || snapshot.activeTurnId) continue;
      // A rebuild reads only the latest messages. An older request that a teammate still works on is
      // in memory only, and when the teammate finishes, the chat must show that the request ended (#9885).
      if (snapshot.messages.some(hasActiveDelivery)) continue;
      const cached = this.#cachedSnapshots.get(agentId);
      if (cached && cached.signature !== conversationContentSignature(snapshot)) continue;
      this.#dropCachedSnapshot(agentId);
      this.#snapshots.delete(agentId);
      this.#snapshotUsedAt.delete(agentId);
      this.#evictedSnapshots.set(agentId, {
        threadId: snapshot.threadId,
        snapshot: new WeakRef(snapshot),
      });
    }
    if (this.#snapshots.size === 0) this.dispose();
  }

  dispose(): void {
    if (this.#evictionTimer) clearInterval(this.#evictionTimer);
    this.#evictionTimer = null;
  }

  /** Makes this chat the newest read chat, then drops the oldest read chats past the limit. */
  #rememberRead(agentId: string): void {
    const cached = this.#cachedSnapshots.get(agentId);
    if (cached) cached.usedAt = Date.now();
    this.#evictCachedSnapshots();
  }

  activeSnapshots(): IterableIterator<[string, ConversationSnapshot]> {
    return [
      ...this.#snapshots.entries(),
      ...[...this.#executionSnapshots.values()].map((snapshot): [string, ConversationSnapshot] => [
        snapshot.agentId,
        snapshot,
      ]),
    ].values();
  }

  /**
   * The running turn of the agent's own chat, or of a messaging thread it serves. A task and a
   * channel run beside these, so their turns are not here: see `anyWorkingSnapshot`,
   * `workingTaskSnapshots` and `workingChannelSnapshots`.
   */
  workingSnapshot(agentId: string): ConversationSnapshot | undefined {
    return [...this.activeSnapshots()].find(
      ([id, snapshot]) =>
        id === agentId &&
        snapshot.activeTurnId &&
        !this.isTaskThread(snapshot.threadId) &&
        this.channelForThread(snapshot.threadId) === null,
    )?.[1];
  }

  /** Any running turn of this agent, a task turn included. */
  anyWorkingSnapshot(agentId: string): ConversationSnapshot | undefined {
    return [...this.activeSnapshots()].find(([id, snapshot]) => id === agentId && snapshot.activeTurnId)?.[1];
  }

  /** The tasks of this agent that run a turn now. */
  workingTaskSnapshots(agentId: string): ConversationSnapshot[] {
    return [...this.#executionSnapshots.values()].filter(
      (snapshot) => snapshot.agentId === agentId && snapshot.activeTurnId && this.isTaskThread(snapshot.threadId),
    );
  }

  /** The snapshot whose running turn this is, in any thread of the agent. */
  snapshotWithTurn(agentId: string, turnId: string): ConversationSnapshot | undefined {
    return [...this.activeSnapshots()].find(
      ([id, snapshot]) => id === agentId && snapshot.activeTurnId === turnId,
    )?.[1];
  }

  /** The channel threads of this agent that run a turn now. */
  workingChannelSnapshots(agentId: string): ConversationSnapshot[] {
    return [...this.#executionSnapshots.values()].filter(
      (snapshot) =>
        snapshot.agentId === agentId && snapshot.activeTurnId && this.channelForThread(snapshot.threadId) !== null,
    );
  }

  /** Records the execution thread of one channel, so its turns run in the channel's own lane. */
  registerChannelThread(agentId: string, threadId: string, channelId: string): void {
    if (this.#forgottenExecutionThreads.has(threadId) || this.#store.ownsThread(threadId)) return;
    this.#channelThreads.set(threadId, channelId);
    this.registerExecutionThread(agentId, threadId);
  }

  /** The channel whose execution thread this is, or null. */
  channelForThread(threadId: string | null): string | null {
    return threadId === null ? null : (this.#channelThreads.get(threadId) ?? null);
  }

  /** Whether this thread runs beside the agent's own chat: a task or a channel thread. */
  isSideThread(threadId: string | null): boolean {
    return this.isTaskThread(threadId) || this.channelForThread(threadId) !== null;
  }

  registerTaskThread(agentId: string, threadId: string): void {
    if (this.#forgottenExecutionThreads.has(threadId) || this.#store.ownsThread(threadId)) return;
    this.#taskThreads.add(threadId);
    this.registerExecutionThread(agentId, threadId);
  }

  isTaskThread(threadId: string | null): boolean {
    return threadId !== null && this.#taskThreads.has(threadId);
  }

  registerExecutionThread(agentId: string, threadId: string): void {
    if (this.#forgottenExecutionThreads.has(threadId)) return;
    // An agent's own chat keeps its one snapshot, also when an earlier build made it the thread of a
    // Slack or Discord conversation too. With a second one, a write during a turn copied the turn
    // into the agent's snapshot, and the end of the turn cleared only the other: the agent's queue
    // then held every message until a restart.
    if (this.#store.ownsThread(threadId)) return;
    if (!this.#executionSnapshots.has(threadId)) {
      const page = this.#store.database.readConversationPage(agentId, threadId, { type: "latest" }, 100);
      this.#setExecutionSnapshot(threadId, {
        agentId,
        threadId: page.threadId,
        activeTurnId: page.activeTurnId,
        revision: page.revision,
        messages: page.messages,
      });
    }
  }

  /** The execution thread's snapshot in memory now, with no SQLite read. */
  loadedExecutionSnapshot(threadId: string): ConversationSnapshot | undefined {
    return this.#executionSnapshots.get(threadId);
  }

  isExecutionThread(threadId: string | null): boolean {
    return threadId !== null && this.#executionSnapshots.has(threadId);
  }

  ensureSnapshot(agentId: string, threadId: string | null): ConversationSnapshot {
    const publicId = threadId ? (this.#publicThreads.get(threadId) ?? threadId) : null;
    const execution = publicId ? this.#executionSnapshots.get(publicId) : undefined;
    if (execution && publicId) {
      if (execution.agentId !== agentId) throw new Error("Execution thread belongs to another agent.");
      if (!this.#cachedExecutionSnapshots.has(publicId) && execution.messages.length === 0) {
        const page = this.#store.database.readConversationPage(agentId, publicId, { type: "latest" }, 100);
        this.#setExecutionSnapshot(publicId, {
          agentId,
          threadId: page.threadId,
          activeTurnId: page.activeTurnId,
          revision: page.revision,
          messages: page.messages,
        });
        return this.#executionSnapshots.get(publicId) ?? execution;
      }
      return execution;
    }
    const cached = this.#snapshots.get(agentId);
    if (cached && (!threadId || cached.threadId === threadId)) return cached;
    const agent = this.#store.get(agentId);
    const publicThreadId = agent?.threadId ?? threadId;
    const page = this.#store.database.readConversationPage(agentId, publicThreadId, { type: "latest" }, 100);
    const snapshot: ConversationSnapshot = {
      agentId,
      threadId: page.threadId ?? publicThreadId,
      activeTurnId: page.activeTurnId,
      revision: page.revision,
      messages: page.messages,
    };
    if (publicId && this.#executionSnapshots.has(publicId)) {
      this.#setExecutionSnapshot(publicId, snapshot);
      return this.#executionSnapshots.get(publicId) ?? snapshot;
    }
    this.#keepSnapshot(agentId, snapshot);
    return this.#snapshots.get(agentId) ?? snapshot;
  }

  publicThreadId(agentId: string, fallback: string): string {
    return (
      this.#publicThreads.get(fallback) ??
      (this.#executionSnapshots.has(fallback) ? fallback : (this.#store.get(agentId)?.threadId ?? fallback))
    );
  }

  hasPublishedConversation(agentId: string): boolean {
    return this.#conversationSignatures.has(this.#store.get(agentId)?.threadId ?? agentId);
  }

  emitConversation(
    snapshot: ConversationSnapshot,
    eventType = "conversation.snapshot-updated",
    detail: unknown = {
      activeTurnId: snapshot.activeTurnId,
      messageCount: snapshot.messages.length,
    },
  ): void {
    this.#emitConversation(snapshot, eventType, detail);
  }

  /**
   * Publishes a change to one message that each later change replaces whole, such as a subagent
   * step. The event log keeps only the last event of this type for the message, as it does for
   * streamed text, so frequent updates do not each keep a full copy of the message. When other
   * messages also changed, the normal write records all of them.
   */
  emitReplacedMessage(snapshot: ConversationSnapshot, messageId: string, eventType: string): void {
    this.#emitConversation(snapshot, eventType, { messageId }, messageId);
  }

  #emitConversation(
    snapshot: ConversationSnapshot,
    eventType: string,
    detail: unknown,
    replacedMessageId?: string,
  ): void {
    if (snapshot.threadId && this.#forgottenExecutionThreads.has(snapshot.threadId)) return;
    this.#dropDeletedMessages(snapshot);
    sortConversationMessages(snapshot.messages);
    // The JSON of each message is made once here, for the signatures, the changed messages and the cache.
    const digests = messageDigests();
    const signature = conversationContentSignature(snapshot, digests.json);
    const unchanged = this.#conversationSignatures.get(snapshot.threadId ?? snapshot.agentId) === signature;
    // A turn end is stored also when an earlier write already saved this chat, such as the failure
    // note to an agent that asked: only the turn-end write closes the stored turn (#10698).
    const turnEnd = isTurnEndEvent(eventType);
    if (unchanged && !turnEnd) {
      this.#retainPublishedSnapshot(snapshot, digests, signature);
      return;
    }
    if (snapshot.threadId) {
      const cached = this.#cachedSnapshot(snapshot);
      const changedMessages = this.#changedMessages(snapshot, snapshot.threadId, digests);
      const removedMessageIds = this.#removedMessageIds(snapshot);
      if (
        cached &&
        replacedMessageId !== undefined &&
        changedMessages.length === 1 &&
        changedMessages[0]?.id === replacedMessageId &&
        cached.messageSignatures.has(replacedMessageId) &&
        removedMessageIds.length === 0 &&
        cached.activeTurnId === snapshot.activeTurnId
      ) {
        snapshot.revision = this.#store.database.persistStreamingMessage({
          snapshot,
          messageId: replacedMessageId,
          eventType,
          detail,
        });
      } else if (
        !cached ||
        changedMessages.length > 0 ||
        removedMessageIds.length > 0 ||
        cached.activeTurnId !== snapshot.activeTurnId ||
        turnEnd
      ) {
        snapshot.revision = this.#store.database.persistConversationChanges({
          agentId: snapshot.agentId,
          threadId: snapshot.threadId,
          activeTurnId: snapshot.activeTurnId,
          changedMessages,
          removedMessageIds,
          eventType,
          detail,
        });
      } else this.#countUnstoredSend(snapshot, snapshot.threadId);
    }
    const publishes = this.#publishes;
    const published = this.#publish(snapshot, signature);
    // A listener of the event can change this chat and publish it again. Its JSON is then made again.
    if (this.#publishes === publishes + 1) this.#retainPublishedSnapshot(snapshot, digests, published);
    else this.#retainPublishedSnapshot(snapshot);
  }

  #retainPublishedSnapshot(snapshot: ConversationSnapshot, digests?: MessageDigests, signature?: string): void {
    if (snapshot.threadId && this.#executionSnapshots.has(snapshot.threadId))
      this.#setExecutionSnapshot(snapshot.threadId, snapshot, digests, signature);
    else this.#keepSnapshot(snapshot.agentId, snapshot, digests, signature);
  }

  #cachedSnapshot(snapshot: ConversationSnapshot): CachedSnapshot | undefined {
    const cached = this.#cachedSnapshots.get(snapshot.agentId);
    if (cached?.snapshot === snapshot) return cached;
    if (snapshot.threadId) {
      const execution = this.#cachedExecutionSnapshots.get(snapshot.threadId);
      if (execution?.snapshot === snapshot) return execution;
    }
    return undefined;
  }

  #changedMessages(snapshot: ConversationSnapshot, threadId: string, digests: MessageDigests): ConversationMessage[] {
    const cached = this.#cachedSnapshot(snapshot);
    // A caller can keep a snapshot while a provider read, an eviction or another thread replaces the
    // cached one. Write only what stores differently: writing it whole put every unchanged message in
    // the event log again (#8166).
    if (!cached) return this.#store.database.changedConversationMessages(threadId, snapshot.messages);
    const changed = new Set<ConversationMessage>();
    const untracked: ConversationMessage[] = [];
    for (const message of snapshot.messages) {
      const signature = cached.messageSignatures.get(message.id);
      if (signature === undefined) untracked.push(message);
      else if (signature !== digests.signature(message)) changed.add(message);
    }
    if (untracked.length === 0) return [...changed];
    // A message the cache does not hold can be a stored row that a limit dropped and a sync added
    // back. Write it only when it stores differently, so the same row is never written again.
    for (const message of this.#store.database.changedConversationMessages(threadId, untracked)) changed.add(message);
    return snapshot.messages.filter((message) => changed.has(message));
  }

  #countUnstoredSend(snapshot: ConversationSnapshot, threadId: string): void {
    const now = Date.now();
    const window = this.#unstoredSends.get(threadId);
    if (!window || now - window.since >= UNSTORED_SENDS_WARNING_INTERVAL_MS) {
      this.#unstoredSends.set(threadId, { since: now, sends: 1 });
      return;
    }
    window.sends += 1;
    if (window.sends !== UNSTORED_SENDS_WARNING_COUNT) return;
    logger.warn("A chat was sent again with no stored change many times in one minute.", {
      agentId: snapshot.agentId,
      threadId,
      sends: window.sends,
      messages: snapshot.messages.length,
    });
  }

  #removedMessageIds(snapshot: ConversationSnapshot): string[] {
    const cached = this.#cachedSnapshot(snapshot);
    if (!cached) return [];
    const currentIds = new Set(snapshot.messages.map((message) => message.id));
    return [...cached.messageSignatures.keys()].filter(
      (messageId) => !currentIds.has(messageId) && !cached.omittedMessageIds.has(messageId),
    );
  }

  publishConversation(snapshot: ConversationSnapshot, signature?: string): void {
    this.#publish(snapshot, signature);
  }

  /** Returns the signature that it kept, or undefined when the thread is forgotten. */
  #publish(snapshot: ConversationSnapshot, signature?: string): string | undefined {
    if (snapshot.threadId && this.#forgottenExecutionThreads.has(snapshot.threadId)) return undefined;
    if (this.#dropDeletedMessages(snapshot) || signature === undefined)
      signature = conversationContentSignature(snapshot);
    this.#conversationSignatures.set(snapshot.threadId ?? snapshot.agentId, signature);
    this.#publishes += 1;
    this.#emit({ type: "conversation", snapshot: structuredClone(snapshot) });
    return signature;
  }

  rememberConversationSignature(snapshot: ConversationSnapshot): void {
    if (snapshot.threadId && this.#forgottenExecutionThreads.has(snapshot.threadId)) return;
    this.#conversationSignatures.set(snapshot.threadId ?? snapshot.agentId, conversationContentSignature(snapshot));
  }

  agentForThread(externalThreadId: string): string | undefined {
    return this.#threadToAgent.get(externalThreadId);
  }

  /**
   * Model retrieval must never fall back to the agent's personal conversation. The scope lasts as long
   * as the client runs the session: `unloadAgentThreads` only reloads the instructions before the next
   * turn, and the running turn must keep its history tools (#6584).
   */
  historyScope(externalThreadId: string, client: AgentClient) {
    const agentId = this.#threadToAgent.get(externalThreadId);
    const threadId = this.#publicThreads.get(externalThreadId);
    return agentId && threadId && this.openClientFor(externalThreadId) === client ? { agentId, threadId } : null;
  }

  bindThread(externalThreadId: string, agentId: string, publicThreadId?: string): void {
    if (publicThreadId) this.#publicThreads.set(externalThreadId, publicThreadId);
    this.#threadToAgent.set(externalThreadId, agentId);
  }

  unbindThread(externalThreadId: string): void {
    this.#threadToAgent.delete(externalThreadId);
    this.#publicThreads.delete(externalThreadId);
  }

  loadedClientFor(externalThreadId: string): AgentClient | undefined {
    return this.#loadedThreads.get(externalThreadId);
  }

  /** The client that can still run the session, also when `unloadAgentThreads` unloaded it. */
  openClientFor(externalThreadId: string): AgentClient | undefined {
    return this.#loadedThreads.get(externalThreadId) ?? this.#unloadedThreads.get(externalThreadId);
  }

  markThreadLoaded(externalThreadId: string, client: AgentClient): void {
    this.#loadedThreads.set(externalThreadId, client);
    this.#unloadedThreads.delete(externalThreadId);
  }

  unloadThread(externalThreadId: string): void {
    this.#loadedThreads.delete(externalThreadId);
    this.#unloadedThreads.delete(externalThreadId);
  }

  /** The provider threads that this client holds, loaded or not yet unloaded. */
  clientThreads(client: AgentClient): string[] {
    return [...this.#loadedThreads, ...this.#unloadedThreads]
      .filter(([, owner]) => owner === client)
      .map(([externalThreadId]) => externalThreadId);
  }

  /** Forgets the sessions one stopped process held, and leaves those of every other provider loaded. */
  unloadClientThreads(client: AgentClient): void {
    for (const threads of [this.#loadedThreads, this.#unloadedThreads]) {
      for (const [externalThreadId, owner] of threads) {
        if (owner === client) threads.delete(externalThreadId);
      }
    }
  }

  /**
   * Every provider session this agent holds: its own chat, and each channel thread it runs. The
   * developer instructions are written when a session loads, so a change of the profile or of the
   * memories has to unload all of them. One session alone would leave a channel turn on the values
   * the agent had before.
   */
  unloadAgentThreads(agentId: string): void {
    for (const [externalThreadId, owner] of this.#threadToAgent) {
      const client = owner === agentId ? this.#loadedThreads.get(externalThreadId) : undefined;
      if (!client) continue;
      this.#loadedThreads.delete(externalThreadId);
      this.#unloadedThreads.set(externalThreadId, client);
    }
  }

  /**
   * Every provider session of this agent that a client can still run, its channel threads included,
   * with its client. A session that `unloadAgentThreads` unloaded is included.
   */
  openAgentThreads(agentId: string): Array<[externalThreadId: string, client: AgentClient]> {
    const open: Array<[string, AgentClient]> = [];
    for (const [externalThreadId, owner] of this.#threadToAgent) {
      const client = owner === agentId ? this.openClientFor(externalThreadId) : undefined;
      if (client) open.push([externalThreadId, client]);
    }
    return open;
  }

  /**
   * Marks this provider session as the session of one routine run of the agent. Its items show in the
   * thread that it is bound to: the routine's own side thread, or the agent's own chat.
   */
  registerRoutineSession(agentId: string, externalThreadId: string): void {
    this.#routineSessions.set(externalThreadId, agentId);
  }

  forgetRoutineSession(externalThreadId: string): void {
    this.#routineSessions.delete(externalThreadId);
  }

  /**
   * The newest open routine session of this agent in one thread: the agent's own chat or a routine's
   * side thread. Each thread runs one turn at a time.
   */
  routineSession(agentId: string, publicThreadId: string): string | undefined {
    let newest: string | undefined;
    for (const [externalThreadId, owner] of this.#routineSessions)
      if (owner === agentId && this.#publicThreads.get(externalThreadId) === publicThreadId) newest = externalThreadId;
    return newest;
  }

  /** Whether any routine run of this agent has an open session, in any thread. */
  hasRoutineSession(agentId: string): boolean {
    for (const owner of this.#routineSessions.values()) if (owner === agentId) return true;
    return false;
  }

  isRoutineSession(externalThreadId: string): boolean {
    return this.#routineSessions.has(externalThreadId);
  }

  forgetExecutionThread(threadId: string): void {
    this.#forgottenExecutionThreads.add(threadId);
    this.#taskThreads.delete(threadId);
    this.#channelThreads.delete(threadId);
    const snapshot = this.#executionSnapshots.get(threadId);
    this.#executionSnapshots.delete(threadId);
    if (snapshot?.activeTurnId) this.#activeTurnChanged?.(snapshot.agentId);
    this.#dropCachedExecutionSnapshot(threadId);
    this.#conversationSignatures.delete(threadId);
    this.#unstoredSends.delete(threadId);
    this.#deletedMessageIds.delete(threadId);
  }

  /** Removes from the snapshot each message that a person deleted. True when one was there. */
  #dropDeletedMessages(snapshot: ConversationSnapshot): boolean {
    if (!snapshot.threadId) return false;
    let deleted = this.#deletedMessageIds.get(snapshot.threadId);
    if (!deleted) {
      deleted = this.#store.database.deletedConversationMessageIds(snapshot.threadId);
      this.#deletedMessageIds.set(snapshot.threadId, deleted);
    }
    if (deleted.size === 0) return false;
    const before = snapshot.messages.length;
    for (let index = before - 1; index >= 0; index--) {
      const message = snapshot.messages[index];
      if (message && deleted.has(message.id)) snapshot.messages.splice(index, 1);
    }
    return snapshot.messages.length !== before;
  }

  /**
   * Removes a message that a person deleted from each chat in memory that holds it, after the delete
   * is stored. The cache of each such chat is built again, so no later write sees the message as
   * removed again or as trimmed. Returns the chat to publish, with the stored revision, or undefined
   * when main holds no chat of the thread.
   */
  forgetDeletedMessage(
    agentId: string,
    threadId: string,
    messageId: string,
    revision: number,
  ): ConversationSnapshot | undefined {
    const remove = (snapshot: ConversationSnapshot): void => {
      const index = snapshot.messages.findIndex((message) => message.id === messageId);
      if (index !== -1) snapshot.messages.splice(index, 1);
      snapshot.revision = Math.max(snapshot.revision, revision);
    };
    const deleted = this.#deletedMessageIds.get(threadId);
    if (deleted) deleted.add(messageId);
    else this.#deletedMessageIds.set(threadId, this.#store.database.deletedConversationMessageIds(threadId));
    const execution = this.#executionSnapshots.get(threadId);
    if (execution) {
      remove(execution);
      this.#setExecutionSnapshot(threadId, execution);
      return this.#executionSnapshots.get(threadId);
    }
    // A caller can still hold an idle snapshot across an `await`, so it loses the message too.
    const evicted = this.#evictedSnapshots.get(agentId);
    const retained = evicted?.threadId === threadId ? evicted.snapshot.deref() : undefined;
    if (retained) remove(retained);
    const live = this.#snapshots.get(agentId);
    if (live?.threadId !== threadId) return undefined;
    remove(live);
    this.#keepSnapshot(agentId, live);
    return this.#snapshots.get(agentId);
  }

  /**
   * After "Delete history" of the agent's own chat: the next read of the deleted ids comes from the
   * database, which now holds every message of the thread. The caller replaces the snapshot.
   */
  forgetDeletedHistory(threadId: string): void {
    this.#deletedMessageIds.delete(threadId);
  }

  clearLoadedThreads(): void {
    this.#loadedThreads.clear();
    this.#unloadedThreads.clear();
  }

  forgetAgent(agentId: string): void {
    for (const [id, snapshot] of this.#executionSnapshots) {
      if (snapshot.agentId !== agentId) continue;
      this.#taskThreads.delete(id);
      this.#channelThreads.delete(id);
      this.#executionSnapshots.delete(id);
      this.#dropCachedExecutionSnapshot(id);
      this.#conversationSignatures.delete(id);
      this.#unstoredSends.delete(id);
      this.#deletedMessageIds.delete(id);
    }
    const threadId = (this.#snapshots.get(agentId) ?? this.#evictedSnapshots.get(agentId))?.threadId;
    if (threadId) {
      this.#conversationSignatures.delete(threadId);
      this.#unstoredSends.delete(threadId);
      this.#deletedMessageIds.delete(threadId);
    }
    this.#snapshots.delete(agentId);
    for (const [externalThreadId, owner] of this.#routineSessions)
      if (owner === agentId) this.#routineSessions.delete(externalThreadId);
    this.#dropCachedSnapshot(agentId);
    this.#snapshotUsedAt.delete(agentId);
    this.#evictedSnapshots.delete(agentId);
    this.#conversationSignatures.delete(agentId);
  }

  /**
   * The one conversation-mutating transaction. Callers supply the work and the snapshot they want
   * published; the wrapper owns all three rollback mechanisms, which only compose correctly
   * together: `ROLLBACK` undoes rows, restoring `snapshots` undoes the in-memory projection, and
   * `restoreThreadIdentity` undoes `ensureThreadIdNow`, whose effect on the store's in-memory agent
   * list happens outside the transaction. The `previousAgent.threadId === null` guard means it undoes
   * thread *creation*, never a thread change.
   *
   * The snapshot is published once the transaction that owns it commits, which is immediately when
   * this call opened it and later when it joined one, so no caller can see a conversation built on
   * rows a surrounding transaction still discards.
   */
  withConversationTransaction<T>(
    agentId: string,
    work: (transaction: ConversationTransaction) => ConversationTransactionResult<T>,
    onRollback?: () => void,
  ): T {
    // Throws before BEGIN IMMEDIATE: an error raised inside an open transaction would leave
    // isTransaction true for the next caller, on a database that has no backup.
    const previousAgent = this.requireKnownAgent(agentId);
    // `snapshot` brings an evicted snapshot back before BEGIN, so a rollback restores its content.
    const previousSnapshot = this.snapshot(agentId);
    const previousSnapshotState = previousSnapshot ? structuredClone(previousSnapshot) : undefined;
    const restorePreviousState = () => {
      onRollback?.();
      if (previousAgent.threadId === null) {
        this.#store.restoreThreadIdentity(agentId, previousAgent.threadId, previousAgent.updatedAt);
      }
      if (previousSnapshotState) this.#keepSnapshot(agentId, previousSnapshotState);
      else {
        this.#snapshots.delete(agentId);
        this.#snapshotUsedAt.delete(agentId);
      }
    };
    let published: ConversationSnapshot | undefined;
    return withDatabaseTransaction(
      this.#store.database,
      () => {
        const threadId = this.#store.ensureThreadIdNow(agentId);
        const next = structuredClone(this.ensureSnapshot(agentId, threadId));
        next.threadId = threadId;
        const outcome = work({ threadId, snapshot: next });
        published = outcome.snapshot;
        return outcome.result;
      },
      restorePreviousState,
      () => {
        if (!published) return;
        const digests = messageDigests();
        this.#keepSnapshot(agentId, published, digests);
        this.publishConversation(published, conversationContentSignature(published, digests.json));
      },
    );
  }

  /**
   * As `withConversationTransaction`, for one side thread of the agent. The cached snapshot changes,
   * and the conversation is published, only after the commit, so a rollback has nothing to restore.
   */
  withThreadTransaction<T>(
    agentId: string,
    threadId: string,
    work: (transaction: ConversationTransaction) => ConversationTransactionResult<T>,
  ): T {
    const current = this.ensureSnapshot(agentId, threadId);
    let published: ConversationSnapshot | undefined;
    return withDatabaseTransaction(
      this.#store.database,
      () => {
        const outcome = work({ threadId, snapshot: structuredClone(current) });
        published = outcome.snapshot;
        return outcome.result;
      },
      undefined,
      () => {
        if (!published) return;
        const digests = messageDigests();
        this.#setSnapshot(agentId, published, digests);
        this.publishConversation(published, conversationContentSignature(published, digests.json));
      },
    );
  }

  requireKnownAgent(agentId: string): AgentSummary {
    const agent = this.#listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(sourceText("error.agent.unknown", { id: agentId }));
    return agent;
  }
}

/** `signature` is the content signature of `snapshot` when the caller has it. */
function boundedConversationSnapshot(
  snapshot: ConversationSnapshot,
  digests = messageDigests(),
  signature?: string,
): CachedSnapshot {
  const activeMessages = snapshot.activeTurnId
    ? snapshot.messages.filter((message) => isActiveMessage(message, snapshot.activeTurnId))
    : [];
  const active = new Set(activeMessages);
  const allCompletedMessages = snapshot.messages.filter((message) => !active.has(message));
  let completedMessages = withMailboxMessages(
    allCompletedMessages,
    allCompletedMessages.slice(-CONVERSATION_SNAPSHOT_MESSAGE_LIMIT),
    activeMessages,
  );
  let completedBytes = digests.snapshotBytes(snapshot, completedMessages);
  if (completedBytes > CONVERSATION_CACHE_BYTES_LIMIT) {
    const removed = oldestMessagesToRemove(
      completedMessages,
      activeMessages,
      completedBytes - CONVERSATION_CACHE_BYTES_LIMIT,
      digests,
    );
    completedMessages = completedMessages.filter((message) => !removed.has(message));
    completedBytes = digests.snapshotBytes(snapshot, completedMessages);
  }
  const retainedAllMessages =
    completedMessages.length === allCompletedMessages.length &&
    completedMessages.length + activeMessages.length === snapshot.messages.length;
  const retained = new Set([...completedMessages, ...activeMessages]);
  const bounded: ConversationSnapshot = retainedAllMessages
    ? snapshot
    : {
        ...snapshot,
        messages: snapshot.messages.filter((message) => retained.has(message)),
      };
  const messages = bounded.messages;
  const retainedIds = new Set(messages.map((message) => message.id));
  return {
    snapshot: bounded,
    // Active-turn messages are working state. The process-wide budget covers completed history
    // only, so one large streamed response cannot evict every idle conversation.
    bytes: completedBytes,
    usedAt: Date.now(),
    signature:
      signature !== undefined && bounded === snapshot ? signature : conversationContentSignature(bounded, digests.json),
    textSize: textSize(bounded),
    activeTurnId: bounded.activeTurnId,
    messageSignatures: new Map(messages.map((message) => [message.id, digests.signature(message)])),
    omittedMessageIds: new Set(
      snapshot.messages.flatMap((message) => (retainedIds.has(message.id) ? [] : [message.id])),
    ),
  };
}

/**
 * Adds the older messages that mailbox sync puts back: each message with a queued or running
 * delivery, and the newest completed mailbox messages from the oldest kept message on, as many as
 * one mailbox read returns. Sync reads from the first
 * message's `createdAt`, but the display order groups a turn by its earliest message, so the last
 * 100 in that order do not end at one time. When the bound dropped these, each sync added them
 * again, and each change wrote the same rows and sent the whole chat again.
 */
function withMailboxMessages(
  completed: readonly ConversationMessage[],
  recent: ConversationMessage[],
  active: readonly ConversationMessage[],
): ConversationMessage[] {
  const older = completed.slice(0, completed.length - recent.length);
  if (older.length === 0) return recent;
  const queued = new Set(older.filter(hasActiveDelivery));
  // The same text comparison as `MailboxStore.conversationMessages`.
  let oldest: string | undefined;
  for (const message of [...recent, ...active, ...queued])
    if (oldest === undefined || message.createdAt < oldest) oldest = message.createdAt;
  const from = oldest;
  if (from === undefined) return recent;
  // An old queued message moves `from` far back, so without this limit each later request stays.
  let completedLeft =
    MAILBOX_CONVERSATION_MESSAGE_LIMIT -
    [...recent, ...active].filter((message) => isMailboxMessage(message) && !hasActiveDelivery(message)).length;
  const sent = older
    .filter((message) => !queued.has(message) && isMailboxMessage(message) && message.createdAt >= from)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const kept = new Set(queued);
  for (const message of sent) {
    if (completedLeft <= 0) break;
    kept.add(message);
    completedLeft -= 1;
  }
  return [...older.filter((message) => kept.has(message)), ...recent];
}

function isMailboxMessage(message: ConversationMessage): boolean {
  return message.delivery !== undefined || message.exchange !== undefined;
}

const ACTIVE_DELIVERY_STATUSES: ReadonlySet<QueueDeliveryStatus> = new Set(["queued", "starting", "running"]);

/** An agent's own message waits for any recipient; a message to it waits for its own delivery. */
function hasActiveDelivery(message: ConversationMessage): boolean {
  if (message.delivery) return ACTIVE_DELIVERY_STATUSES.has(message.delivery.status);
  return (
    message.exchange?.direction === "outgoing" &&
    message.exchange.deliveries.some((delivery) => ACTIVE_DELIVERY_STATUSES.has(delivery.status))
  );
}

function isActiveMessage(message: ConversationMessage, activeTurnId: string | null): boolean {
  return activeTurnId !== null && (message.turnId === activeTurnId || message.status === "streaming");
}

function completedCacheBytes(snapshot: ConversationSnapshot, digests: MessageDigests): number {
  return digests.snapshotBytes(
    snapshot,
    snapshot.messages.filter((message) => !isActiveMessage(message, snapshot.activeTurnId)),
  );
}

/**
 * The length of all message text and the number of messages. Equal content has an equal size, so a
 * different size shows a change without the JSON of the chat; an equal size proves nothing.
 */
function textSize(snapshot: ConversationSnapshot): number {
  let size = snapshot.messages.length;
  for (const message of snapshot.messages) size += message.text.length;
  return size;
}

function pageSnapshot(page: {
  agentId: string;
  threadId: string | null;
  activeTurnId: string | null;
  revision: number;
  messages: ConversationMessage[];
}): ConversationSnapshot {
  return {
    agentId: page.agentId,
    threadId: page.threadId,
    activeTurnId: page.activeTurnId,
    revision: page.revision,
    messages: page.messages,
  };
}

function copySnapshotContents(target: ConversationSnapshot, source: ConversationSnapshot): ConversationSnapshot {
  target.threadId = source.threadId;
  target.activeTurnId = source.activeTurnId;
  target.revision = source.revision;
  target.messages = source.messages;
  return target;
}

/**
 * The oldest messages that free `excessBytes`. The removal is one prefix in display order, so no old
 * request stays without its answer. A message in the prefix that mailbox sync puts back stays (see
 * `withMailboxMessages`): removing it frees no memory and makes the next change write it again.
 */
function oldestMessagesToRemove(
  messages: readonly ConversationMessage[],
  active: readonly ConversationMessage[],
  excessBytes: number,
  digests: MessageDigests,
): Set<ConversationMessage> {
  let removed = new Set<ConversationMessage>();
  for (let count = 1; count <= messages.length; count += 1) {
    const kept = new Set(withMailboxMessages(messages, messages.slice(count), active));
    removed = new Set(messages.slice(0, count).filter((message) => !kept.has(message)));
    let bytes = 0;
    for (const message of removed) bytes += digests.bytes(message);
    if (bytes >= excessBytes) break;
  }
  return removed;
}

/**
 * The JSON of each message, made at most once. A message changes in place, so the digests serve one
 * write and its checks, and are not kept after it.
 */
interface MessageDigests {
  readonly json: (message: ConversationMessage) => string;
  /** What a write must store of a message: it with no queue position (`withoutQueuePositions`). */
  readonly signature: (message: ConversationMessage) => string;
  /** The UTF-8 size of a message, with the comma between messages. */
  readonly bytes: (message: ConversationMessage) => number;
  /** The UTF-8 size of `JSON.stringify` of the snapshot with only these messages. */
  readonly snapshotBytes: (snapshot: ConversationSnapshot, messages: readonly ConversationMessage[]) => number;
}

function messageDigests(): MessageDigests {
  const jsons = new Map<ConversationMessage, string>();
  const signatures = new Map<ConversationMessage, string>();
  const sizes = new Map<ConversationMessage, number>();
  const json = (message: ConversationMessage): string => {
    let text = jsons.get(message);
    if (text === undefined) {
      text = JSON.stringify(message);
      jsons.set(message, text);
    }
    return text;
  };
  const bytes = (message: ConversationMessage): number => {
    let size = sizes.get(message);
    if (size === undefined) {
      size = Buffer.byteLength(json(message), "utf8") + 1;
      sizes.set(message, size);
    }
    return size;
  };
  return {
    json,
    signature: (message) => {
      let signature = signatures.get(message);
      if (signature === undefined) {
        // A message with no queue position stores as it is, so its JSON serves.
        const stored = withoutQueuePositions(message);
        signature = createHash("sha256")
          .update(stored === message ? json(message) : JSON.stringify(stored))
          .digest("hex");
        signatures.set(message, signature);
      }
      return signature;
    },
    bytes,
    snapshotBytes: (snapshot, messages) => {
      // The JSON with no messages, then each message and the commas between them.
      let size = Buffer.byteLength(JSON.stringify({ ...snapshot, messages: [] }), "utf8");
      for (const message of messages) size += bytes(message);
      return messages.length > 0 ? size - 1 : size;
    },
  };
}
