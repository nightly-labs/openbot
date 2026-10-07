import { createHash } from "node:crypto";
import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import type { AgentEvent, AgentSummary, ConversationMessage, ConversationSnapshot } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { AgentClient } from "../agent-client";
import type { AgentStore } from "../agent-store";
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
/** The most recent completed messages retained in the process for one conversation. */
export const CONVERSATION_CACHE_MESSAGE_LIMIT = 100;

/** The maximum serialized size retained for one completed conversation. */
export const CONVERSATION_CACHE_BYTES_LIMIT = 8 * 1024 * 1024;

/** The maximum serialized size retained by all completed conversation caches. */
export const CONVERSATION_CACHE_TOTAL_BYTES_LIMIT = 64 * 1024 * 1024;

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
export const CONVERSATION_SNAPSHOT_IDLE_MS = 10 * 60_000;

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
  readonly #threadToAgent = new Map<string, string>();
  readonly #loadedThreads = new Map<string, AgentClient>();
  readonly #executionSnapshots = new Map<string, ConversationSnapshot>();
  readonly #cachedExecutionSnapshots = new Map<string, CachedSnapshot>();
  readonly #publicThreads = new Map<string, string>();
  readonly #forgottenExecutionThreads = new Set<string>();

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
    while (this.#cachedSnapshotBytes > CONVERSATION_CACHE_TOTAL_BYTES_LIMIT) {
      let oldest:
        | { kind: "agent"; id: string; usedAt: number }
        | { kind: "execution"; id: string; usedAt: number }
        | undefined;
      for (const [id, cached] of this.#cachedSnapshots) {
        if (!this.#cacheIsCommitted(cached)) continue;
        if (cached.snapshot.messages.every((message) => isActiveMessage(message, cached.snapshot.activeTurnId)))
          continue;
        if (!oldest || cached.usedAt < oldest.usedAt) oldest = { kind: "agent", id, usedAt: cached.usedAt };
      }
      for (const [id, cached] of this.#cachedExecutionSnapshots) {
        if (!this.#cacheIsCommitted(cached)) continue;
        if (cached.snapshot.messages.every((message) => isActiveMessage(message, cached.snapshot.activeTurnId)))
          continue;
        if (!oldest || cached.usedAt < oldest.usedAt) oldest = { kind: "execution", id, usedAt: cached.usedAt };
      }
      if (!oldest) return;
      if (oldest.kind === "agent") {
        const cached = this.#cachedSnapshots.get(oldest.id);
        if (cached?.snapshot.activeTurnId) {
          if (!this.#trimCompletedCache(cached)) return;
        } else {
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
        if (cached?.snapshot.activeTurnId) {
          if (!this.#trimCompletedCache(cached)) return;
        } else {
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

  #trimCompletedCache(cached: CachedSnapshot): boolean {
    const activeTurnId = cached.snapshot.activeTurnId;
    const index = cached.snapshot.messages.findIndex((message) => !isActiveMessage(message, activeTurnId));
    if (index < 0) return false;
    const [removed] = cached.snapshot.messages.splice(index, 1);
    if (!removed) return false;
    const previousBytes = cached.bytes;
    cached.omittedMessageIds.add(removed.id);
    cached.messageSignatures.delete(removed.id);
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

  workingSnapshot(agentId: string): ConversationSnapshot | undefined {
    return [...this.activeSnapshots()].find(([id, snapshot]) => id === agentId && snapshot.activeTurnId)?.[1];
  }

  registerExecutionThread(agentId: string, threadId: string): void {
    if (this.#forgottenExecutionThreads.has(threadId)) return;
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
      }
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
    return snapshot.messages.filter(
      (message) => cached.messageSignatures.get(message.id) !== messageSignature(message),
    );
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

  markThreadLoaded(externalThreadId: string, client: AgentClient): void {
    this.#loadedThreads.set(externalThreadId, client);
  }

  unloadThread(externalThreadId: string): void {
    this.#loadedThreads.delete(externalThreadId);
  }

  /** Forgets the sessions one stopped process held, and leaves those of every other provider loaded. */
  unloadClientThreads(client: AgentClient): void {
    for (const [externalThreadId, owner] of this.#loadedThreads) {
      if (owner === client) this.#loadedThreads.delete(externalThreadId);
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
      if (owner === agentId) this.#loadedThreads.delete(externalThreadId);
    }
  }

  /** Every loaded provider session of this agent, its channel threads included, with its client. */
  loadedAgentThreads(agentId: string): Array<[externalThreadId: string, client: AgentClient]> {
    const loaded: Array<[string, AgentClient]> = [];
    for (const [externalThreadId, owner] of this.#threadToAgent) {
      const client = owner === agentId ? this.#loadedThreads.get(externalThreadId) : undefined;
      if (client) loaded.push([externalThreadId, client]);
    }
    return loaded;
  }

  forgetExecutionThread(threadId: string): void {
    this.#forgottenExecutionThreads.add(threadId);
    this.#executionSnapshots.delete(threadId);
    this.#dropCachedExecutionSnapshot(threadId);
    this.#conversationSignatures.delete(threadId);
  }

  clearLoadedThreads(): void {
    this.#loadedThreads.clear();
  }

  forgetAgent(agentId: string): void {
    for (const [id, snapshot] of this.#executionSnapshots) {
      if (snapshot.agentId !== agentId) continue;
      this.#executionSnapshots.delete(id);
      this.#dropCachedExecutionSnapshot(id);
      this.#conversationSignatures.delete(id);
    }
    const threadId = (this.#snapshots.get(agentId) ?? this.#evictedSnapshots.get(agentId))?.threadId;
    if (threadId) this.#conversationSignatures.delete(threadId);
    this.#snapshots.delete(agentId);
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
  const completedMessages = allCompletedMessages.slice(-CONVERSATION_CACHE_MESSAGE_LIMIT);
  const completedSnapshot = { ...snapshot, messages: completedMessages };
  let completedBytes = conversationSnapshotBytes(completedSnapshot);
  while (completedMessages.length > 0 && completedBytes > CONVERSATION_CACHE_BYTES_LIMIT) {
    completedMessages.shift();
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

function messageSignature(message: ConversationMessage): string {
  return createHash("sha256").update(JSON.stringify(message)).digest("hex");
}
