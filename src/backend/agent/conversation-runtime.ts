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
 * Runs `work` inside a SQLite transaction, opening one only when the caller is not already inside
 * another. Nesting is load-bearing: `deleteRoutine` drives a routine mutation whose `beforeMutate`
 * hook appends a run transition in the same transaction, and an approval response can append a
 * hosted-site event inside an outer one. This is the only `BEGIN IMMEDIATE` under `src/backend/agent`.
 *
 * `onCommit` exists because a nested caller must not publish in-memory state the owner can still
 * discard: there is no partial rollback here, so effects that make rows visible to the rest of the
 * app are queued on the owner and run once, after `COMMIT`. `onRollback` is queued the same way, so
 * an owner that fails *after* a nested call succeeded still undoes that call's in-memory slice.
 */
export function withDatabaseTransaction<T>(
  database: OpenBotDatabase,
  work: () => T,
  onRollback?: () => void,
  onCommit?: () => void,
): T {
  // `isTransaction`, not the map, decides who opens one: a transaction started anywhere else would
  // otherwise make this call BEGIN IMMEDIATE inside it, which SQLite rejects.
  if (database.connection.isTransaction) {
    const owner = openTransactions.get(database);
    let result: T;
    try {
      result = work();
    } catch (error) {
      // Our own work failed, so undo our in-memory slice now rather than queueing it: the owner's
      // ROLLBACK will undo the rows, and a queued restorer would run a second time.
      onRollback?.();
      throw error;
    }
    if (owner) {
      if (onRollback) owner.rollback.push(onRollback);
      if (onCommit) owner.commit.push(onCommit);
    } else {
      // An ambient transaction this helper did not open has no queue to defer onto, so the
      // effects run as they always did.
      onCommit?.();
    }
    return result;
  }
  database.connection.exec("BEGIN IMMEDIATE");
  const scope: TransactionScope = { rollback: [], commit: [] };
  openTransactions.set(database, scope);
  let result: T;
  try {
    result = work();
    database.connection.exec("COMMIT");
  } catch (error) {
    if (database.connection.isTransaction) database.connection.exec("ROLLBACK");
    openTransactions.delete(database);
    // Innermost first, so each restorer sees the state the one after it has already put back.
    for (const restore of [...scope.rollback].reverse()) restore();
    onRollback?.();
    throw error;
  }
  // Past COMMIT the rows are durable, so the effects run outside the block above: a listener that
  // throws while a conversation is published must not reach the restorers, which would put the
  // in-memory projection back to a state SQLite no longer holds. Only `work` and `COMMIT` roll back.
  //
  // The scope is cleared first because publishing can re-enter this function, which must then open
  // its own transaction instead of joining one that is already committed.
  openTransactions.delete(database);
  // Every effect runs, so a throw from one does not skip the rest. The rows are already durable,
  // and an effect that keeps memory in step with them is the only thing left to put it back.
  const failures: unknown[] = [];
  const runEffect = (effect: (() => void) | undefined): void => {
    try {
      effect?.();
    } catch (error) {
      failures.push(error);
    }
  };
  for (const effect of scope.commit) runEffect(effect);
  runEffect(onCommit);
  // One failure keeps its own message, because a single failing listener already names the cause.
  // Several report together, so no cause is lost.
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
   * The open provider sessions of routine runs, with their agent. A routine run has its own session,
   * which closes when the run ends, so the agent's long chat session does not grow with it.
   */
  readonly #routineSessions = new Map<string, string>();

  constructor(store: AgentStore, emit: (event: AgentEvent) => void, listAgents: () => AgentSummary[]) {
    this.#store = store;
    this.#emit = emit;
    this.#listAgents = listAgents;
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
    if (snapshot.threadId && this.#forgottenExecutionThreads.has(snapshot.threadId)) return;
    const current = this.#snapshots.get(agentId);
    if (current?.activeTurnId && current.activeTurnId === snapshot.activeTurnId) {
      const bounded = boundedConversationSnapshot(snapshot).snapshot;
      copySnapshotContents(current, bounded);
      this.#keepSnapshot(agentId, current);
      this.#rememberRead(agentId);
      return;
    }
    if (snapshot.threadId && snapshot.threadId !== this.#store.list().find((agent) => agent.id === agentId)?.threadId)
      this.#setExecutionSnapshot(snapshot.threadId, snapshot);
    else {
      this.#keepSnapshot(agentId, snapshot);
      this.#rememberRead(agentId);
    }
  }

  #keepSnapshot(agentId: string, snapshot: ConversationSnapshot): void {
    this.#evictedSnapshots.delete(agentId);
    this.#dropCachedSnapshot(agentId);
    const cached = boundedConversationSnapshot(snapshot);
    const current = this.#snapshots.get(agentId);
    const retained = current === snapshot ? copySnapshotContents(snapshot, cached.snapshot) : cached.snapshot;
    this.#snapshots.set(agentId, retained);
    this.#cachedSnapshots.set(agentId, retained === cached.snapshot ? cached : { ...cached, snapshot: retained });
    this.#cachedSnapshotBytes += cached.bytes;
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

  #setExecutionSnapshot(threadId: string, snapshot: ConversationSnapshot): void {
    this.#dropCachedExecutionSnapshot(threadId);
    const cached = boundedConversationSnapshot(snapshot);
    const current = this.#executionSnapshots.get(threadId);
    const retained = current === snapshot ? copySnapshotContents(snapshot, cached.snapshot) : cached.snapshot;
    this.#executionSnapshots.set(threadId, retained);
    this.#cachedExecutionSnapshots.set(
      threadId,
      retained === cached.snapshot ? cached : { ...cached, snapshot: retained },
    );
    this.#cachedSnapshotBytes += cached.bytes;
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
    while (this.#cachedSnapshotBytes > CONVERSATION_CACHE_TOTAL_BYTES_LIMIT) {
      let oldest:
        | { kind: "agent"; id: string; usedAt: number }
        | { kind: "execution"; id: string; usedAt: number }
        | undefined;
      for (const [id, cached] of this.#cachedSnapshots) {
        if (!isCommitted(cached) || untrimmable.has(cached)) continue;
        if (cached.snapshot.messages.every((message) => isActiveMessage(message, cached.snapshot.activeTurnId)))
          continue;
        if (!oldest || cached.usedAt < oldest.usedAt) oldest = { kind: "agent", id, usedAt: cached.usedAt };
      }
      for (const [id, cached] of this.#cachedExecutionSnapshots) {
        if (!isCommitted(cached) || untrimmable.has(cached)) continue;
        if (cached.snapshot.messages.every((message) => isActiveMessage(message, cached.snapshot.activeTurnId)))
          continue;
        if (!oldest || cached.usedAt < oldest.usedAt) oldest = { kind: "execution", id, usedAt: cached.usedAt };
      }
      if (!oldest) return;
      if (oldest.kind === "agent") {
        const cached = this.#cachedSnapshots.get(oldest.id);
        if (cached?.snapshot.activeTurnId) trim(cached);
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
    const removed = oldestMessagesToRemove(
      completed,
      active,
      this.#cachedSnapshotBytes - CONVERSATION_CACHE_TOTAL_BYTES_LIMIT,
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
    cached.bytes = completedCacheBytes(cached.snapshot);
    cached.signature = conversationContentSignature(cached.snapshot);
    cached.activeTurnId = cached.snapshot.activeTurnId;
    this.#cachedSnapshotBytes += cached.bytes - previousBytes;
    return true;
  }

  /**
   * Removes from memory each agent snapshot that is idle and that SQLite can rebuild with the same
   * content. A snapshot stays when it has no thread, has a turn that runs, or is different from
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
   * The running turn of the agent's own chat, or of a channel or messaging thread it serves. A task
   * runs beside these, so its turns are not here: see `anyWorkingSnapshot` and `workingTaskSnapshots`.
   */
  workingSnapshot(agentId: string): ConversationSnapshot | undefined {
    return [...this.activeSnapshots()].find(
      ([id, snapshot]) => id === agentId && snapshot.activeTurnId && !this.isTaskThread(snapshot.threadId),
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
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
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
      (this.#executionSnapshots.has(fallback)
        ? fallback
        : (this.#store.list().find((candidate) => candidate.id === agentId)?.threadId ?? fallback))
    );
  }

  hasPublishedConversation(agentId: string): boolean {
    return this.#conversationSignatures.has(
      this.#store.list().find((agent) => agent.id === agentId)?.threadId ?? agentId,
    );
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
    sortConversationMessages(snapshot.messages);
    const signature = conversationContentSignature(snapshot);
    if (this.#conversationSignatures.get(snapshot.threadId ?? snapshot.agentId) === signature) {
      this.#retainPublishedSnapshot(snapshot);
      return;
    }
    if (snapshot.threadId) {
      const cached = this.#cachedSnapshot(snapshot);
      const changedMessages = this.#changedMessages(snapshot);
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
        cached.activeTurnId !== snapshot.activeTurnId
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
    this.publishConversation(snapshot, signature);
    this.#retainPublishedSnapshot(snapshot);
  }

  #retainPublishedSnapshot(snapshot: ConversationSnapshot): void {
    if (snapshot.threadId && this.#executionSnapshots.has(snapshot.threadId))
      this.#setExecutionSnapshot(snapshot.threadId, snapshot);
    else this.#keepSnapshot(snapshot.agentId, snapshot);
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

  #changedMessages(snapshot: ConversationSnapshot): ConversationMessage[] {
    const cached = this.#cachedSnapshot(snapshot);
    if (!cached) return structuredClone(snapshot.messages);
    const changed = new Set<ConversationMessage>();
    const untracked: ConversationMessage[] = [];
    for (const message of snapshot.messages) {
      const signature = cached.messageSignatures.get(message.id);
      if (signature === undefined) untracked.push(message);
      else if (signature !== messageSignature(message)) changed.add(message);
    }
    if (untracked.length === 0) return [...changed];
    // A message the cache does not hold can be a stored row that a limit dropped and a sync added
    // back. Write it only when it stores differently, so the same row is never written again.
    for (const message of snapshot.threadId
      ? this.#store.database.changedConversationMessages(snapshot.threadId, untracked)
      : untracked)
      changed.add(message);
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

  publishConversation(snapshot: ConversationSnapshot, signature = conversationContentSignature(snapshot)): void {
    if (snapshot.threadId && this.#forgottenExecutionThreads.has(snapshot.threadId)) return;
    this.#conversationSignatures.set(snapshot.threadId ?? snapshot.agentId, signature);
    this.#emit({ type: "conversation", snapshot: structuredClone(snapshot) });
  }

  rememberConversationSignature(snapshot: ConversationSnapshot): void {
    if (snapshot.threadId && this.#forgottenExecutionThreads.has(snapshot.threadId)) return;
    this.#conversationSignatures.set(snapshot.threadId ?? snapshot.agentId, conversationContentSignature(snapshot));
  }

  agentForThread(externalThreadId: string): string | undefined {
    return this.#threadToAgent.get(externalThreadId);
  }

  /** Model retrieval must never fall back to the agent's personal conversation. */
  historyScope(externalThreadId: string, client: AgentClient) {
    const agentId = this.#threadToAgent.get(externalThreadId);
    const threadId = this.#publicThreads.get(externalThreadId);
    return agentId && threadId && this.#loadedThreads.get(externalThreadId) === client ? { agentId, threadId } : null;
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

  /** Marks this provider session as the one routine run of the agent. Its items show in the agent's own chat. */
  registerRoutineSession(agentId: string, externalThreadId: string): void {
    this.#routineSessions.set(externalThreadId, agentId);
  }

  forgetRoutineSession(externalThreadId: string): void {
    this.#routineSessions.delete(externalThreadId);
  }

  /** The newest open routine session of this agent. Its chat runs one turn at a time. */
  routineSession(agentId: string): string | undefined {
    let newest: string | undefined;
    for (const [externalThreadId, owner] of this.#routineSessions) if (owner === agentId) newest = externalThreadId;
    return newest;
  }

  isRoutineSession(externalThreadId: string): boolean {
    return this.#routineSessions.has(externalThreadId);
  }

  forgetExecutionThread(threadId: string): void {
    this.#forgottenExecutionThreads.add(threadId);
    this.#taskThreads.delete(threadId);
    this.#executionSnapshots.delete(threadId);
    this.#dropCachedExecutionSnapshot(threadId);
    this.#conversationSignatures.delete(threadId);
    this.#unstoredSends.delete(threadId);
  }

  clearLoadedThreads(): void {
    this.#loadedThreads.clear();
    this.#unloadedThreads.clear();
  }

  forgetAgent(agentId: string): void {
    for (const [id, snapshot] of this.#executionSnapshots) {
      if (snapshot.agentId !== agentId) continue;
      this.#taskThreads.delete(id);
      this.#executionSnapshots.delete(id);
      this.#dropCachedExecutionSnapshot(id);
      this.#conversationSignatures.delete(id);
      this.#unstoredSends.delete(id);
    }
    const threadId = (this.#snapshots.get(agentId) ?? this.#evictedSnapshots.get(agentId))?.threadId;
    if (threadId) {
      this.#conversationSignatures.delete(threadId);
      this.#unstoredSends.delete(threadId);
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
        this.#keepSnapshot(agentId, published);
        this.publishConversation(published);
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
        this.setSnapshot(agentId, published);
        this.publishConversation(published);
      },
    );
  }

  requireKnownAgent(agentId: string): AgentSummary {
    const agent = this.#listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(sourceText("error.agent.unknown", { id: agentId }));
    return agent;
  }
}

function boundedConversationSnapshot(snapshot: ConversationSnapshot): CachedSnapshot {
  const activeMessages = snapshot.activeTurnId
    ? snapshot.messages.filter((message) => isActiveMessage(message, snapshot.activeTurnId))
    : [];
  const allCompletedMessages = snapshot.messages.filter((message) => !activeMessages.includes(message));
  let completedMessages = withMailboxMessages(
    allCompletedMessages,
    allCompletedMessages.slice(-CONVERSATION_SNAPSHOT_MESSAGE_LIMIT),
    activeMessages,
  );
  let completedBytes = conversationSnapshotBytes({ ...snapshot, messages: completedMessages });
  if (completedBytes > CONVERSATION_CACHE_BYTES_LIMIT) {
    const removed = oldestMessagesToRemove(
      completedMessages,
      activeMessages,
      completedBytes - CONVERSATION_CACHE_BYTES_LIMIT,
    );
    completedMessages = completedMessages.filter((message) => !removed.has(message));
    completedBytes = conversationSnapshotBytes({ ...snapshot, messages: completedMessages });
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
    signature: conversationContentSignature(bounded),
    activeTurnId: bounded.activeTurnId,
    messageSignatures: new Map(messages.map((message) => [message.id, messageSignature(message)])),
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

function completedCacheBytes(snapshot: ConversationSnapshot): number {
  return conversationSnapshotBytes({
    ...snapshot,
    messages: snapshot.messages.filter((message) => !isActiveMessage(message, snapshot.activeTurnId)),
  });
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

function conversationSnapshotBytes(snapshot: ConversationSnapshot): number {
  return Buffer.byteLength(JSON.stringify(snapshot), "utf8");
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
): Set<ConversationMessage> {
  // With the comma between messages.
  const sizes = new Map(messages.map((message) => [message, Buffer.byteLength(JSON.stringify(message), "utf8") + 1]));
  let removed = new Set<ConversationMessage>();
  for (let count = 1; count <= messages.length; count += 1) {
    const kept = new Set(withMailboxMessages(messages, messages.slice(count), active));
    removed = new Set(messages.slice(0, count).filter((message) => !kept.has(message)));
    let bytes = 0;
    for (const message of removed) bytes += sizes.get(message) ?? 0;
    if (bytes >= excessBytes) break;
  }
  return removed;
}

function messageSignature(message: ConversationMessage): string {
  return createHash("sha256").update(JSON.stringify(message)).digest("hex");
}
