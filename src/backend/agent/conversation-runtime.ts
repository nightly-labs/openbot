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

export const CONVERSATION_CACHE_BYTES_LIMIT = 8 * 1024 * 1024;

export const CONVERSATION_CACHE_TOTAL_BYTES_LIMIT = 64 * 1024 * 1024;

const UNSTORED_SENDS_WARNING_COUNT = 10;
const UNSTORED_SENDS_WARNING_INTERVAL_MS = 60_000;

const logger = createOpenBotLogger("conversation-runtime");

const openTransactions = new WeakMap<OpenBotDatabase, TransactionScope>();

export function withDatabaseTransaction<T>(
  database: OpenBotDatabase,
  work: () => T,
  onRollback?: () => void,
  onCommit?: () => void,
): T {
  const connection = database.connection;
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
  if (nested) {
    onCommit?.();
    return result;
  }
  openTransactions.delete(database);
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

export class ConversationRuntime {
  readonly #store: AgentStore;
  readonly #emit: (event: AgentEvent) => void;
  readonly #listAgents: () => AgentSummary[];
  readonly #snapshots = new Map<string, ConversationSnapshot>();
  readonly #cachedSnapshots = new Map<string, CachedSnapshot>();
  #cachedSnapshotBytes = 0;
  readonly #snapshotUsedAt = new Map<string, number>();
  readonly #evictedSnapshots = new Map<string, EvictedSnapshot>();
  #evictionTimer: NodeJS.Timeout | null = null;
  readonly #conversationSignatures = new Map<string, string>();
  #publishes = 0;
  readonly #deletedMessageIds = new Map<string, Set<string>>();
  readonly #unstoredSends = new Map<string, { since: number; sends: number }>();
  readonly #threadToAgent = new Map<string, string>();
  readonly #loadedThreads = new Map<string, AgentClient>();
  readonly #unloadedThreads = new Map<string, AgentClient>();
  readonly #executionSnapshots = new Map<string, ConversationSnapshot>();
  readonly #cachedExecutionSnapshots = new Map<string, CachedSnapshot>();
  readonly #publicThreads = new Map<string, string>();
  readonly #forgottenExecutionThreads = new Set<string>();
  readonly #taskThreads = new Set<string>();
  readonly #channelThreads = new Map<string, string>();
  readonly #routineSessions = new Map<string, string>();

  constructor(store: AgentStore, emit: (event: AgentEvent) => void, listAgents: () => AgentSummary[]) {
    this.#store = store;
    this.#emit = emit;
    this.#listAgents = listAgents;
  }

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

  loadedSnapshot(agentId: string): ConversationSnapshot | undefined {
    return this.#snapshots.get(agentId);
  }

  snapshotToUpdate(agentId: string): ConversationSnapshot | undefined {
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

  #keepSnapshot(agentId: string, snapshot: ConversationSnapshot, digests = messageDigests(), signature?: string): void {
    this.#evictedSnapshots.delete(agentId);
    this.#dropCachedSnapshot(agentId);
    const cached = boundedConversationSnapshot(snapshot, digests, signature);
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
    const committed = new Map<CachedSnapshot, boolean>();
    const isCommitted = (cached: CachedSnapshot): boolean => {
      let result = committed.get(cached);
      if (result === undefined) {
        result = this.#cacheIsCommitted(cached);
        committed.set(cached, result);
      }
      return result;
    };
    const untrimmable = new Set<CachedSnapshot>();
    const trim = (cached: CachedSnapshot): void => {
      if (!this.#trimCompletedCache(cached)) {
        untrimmable.add(cached);
        return;
      }
      for (const other of committed.keys()) {
        if (other !== cached && other.snapshot.messages === cached.snapshot.messages) committed.delete(other);
      }
    };
    let byAge: Array<{ kind: "agent" | "execution"; id: string; cached: CachedSnapshot }> | undefined;
    while (this.#cachedSnapshotBytes > CONVERSATION_CACHE_TOTAL_BYTES_LIMIT) {
      byAge ??= [
        ...[...this.#cachedSnapshots].map(([id, cached]) => ({ kind: "agent" as const, id, cached })),
        ...[...this.#cachedExecutionSnapshots].map(([id, cached]) => ({ kind: "execution" as const, id, cached })),
      ].sort((left, right) => left.cached.usedAt - right.cached.usedAt);
      const oldest = byAge.find(({ kind, id, cached }) => {
        const current = kind === "agent" ? this.#cachedSnapshots.get(id) : this.#cachedExecutionSnapshots.get(id);
        if (current !== cached || untrimmable.has(cached)) return false;
        if (cached.snapshot.messages.every((message) => isActiveMessage(message, cached.snapshot.activeTurnId)))
          return false;
        if (kind === "agent" && !cached.snapshot.activeTurnId && cached.snapshot.messages.some(hasActiveDelivery))
          return false;
        return isCommitted(cached);
      });
      if (!oldest) return;
      if (oldest.kind === "agent") {
        const cached = this.#cachedSnapshots.get(oldest.id);
        if (cached?.snapshot.activeTurnId) trim(cached);
        else if (cached?.snapshot.messages.some(hasActiveDelivery)) untrimmable.add(cached);
        else {
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
          const snapshot = this.#executionSnapshots.get(oldest.id);
          if (snapshot) snapshot.messages = [];
          this.#dropCachedExecutionSnapshot(oldest.id);
        }
      }
    }
  }

  #cacheIsCommitted(cached: CachedSnapshot): boolean {
    if (cached.textSize !== textSize(cached.snapshot)) return false;
    return cached.signature === conversationContentSignature(cached.snapshot);
  }

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

  evictIdleSnapshots(now = Date.now()): void {
    if (this.#store.database.connection.isTransaction) return;
    for (const [agentId, snapshot] of this.#snapshots) {
      if ((this.#snapshotUsedAt.get(agentId) ?? 0) > now - CONVERSATION_SNAPSHOT_IDLE_MS) continue;
      this.#snapshotUsedAt.set(agentId, now);
      if (!snapshot.threadId || snapshot.activeTurnId) continue;
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
    return [...this.activeSnapshots()].find(
      ([id, snapshot]) =>
        id === agentId &&
        snapshot.activeTurnId &&
        !this.isTaskThread(snapshot.threadId) &&
        this.channelForThread(snapshot.threadId) === null,
    )?.[1];
  }

  anyWorkingSnapshot(agentId: string): ConversationSnapshot | undefined {
    return [...this.activeSnapshots()].find(([id, snapshot]) => id === agentId && snapshot.activeTurnId)?.[1];
  }

  workingTaskSnapshots(agentId: string): ConversationSnapshot[] {
    return [...this.#executionSnapshots.values()].filter(
      (snapshot) => snapshot.agentId === agentId && snapshot.activeTurnId && this.isTaskThread(snapshot.threadId),
    );
  }

  snapshotWithTurn(agentId: string, turnId: string): ConversationSnapshot | undefined {
    return [...this.activeSnapshots()].find(
      ([id, snapshot]) => id === agentId && snapshot.activeTurnId === turnId,
    )?.[1];
  }

  workingChannelSnapshots(agentId: string): ConversationSnapshot[] {
    return [...this.#executionSnapshots.values()].filter(
      (snapshot) =>
        snapshot.agentId === agentId && snapshot.activeTurnId && this.channelForThread(snapshot.threadId) !== null,
    );
  }

  registerChannelThread(agentId: string, threadId: string, channelId: string): void {
    if (this.#forgottenExecutionThreads.has(threadId) || this.#store.ownsThread(threadId)) return;
    this.#channelThreads.set(threadId, channelId);
    this.registerExecutionThread(agentId, threadId);
  }

  channelForThread(threadId: string | null): string | null {
    return threadId === null ? null : (this.#channelThreads.get(threadId) ?? null);
  }

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
    const digests = messageDigests();
    const signature = conversationContentSignature(snapshot, digests.json);
    const unchanged = this.#conversationSignatures.get(snapshot.threadId ?? snapshot.agentId) === signature;
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
    if (!cached) return this.#store.database.changedConversationMessages(threadId, snapshot.messages);
    const changed = new Set<ConversationMessage>();
    const untracked: ConversationMessage[] = [];
    for (const message of snapshot.messages) {
      const signature = cached.messageSignatures.get(message.id);
      if (signature === undefined) untracked.push(message);
      else if (signature !== digests.signature(message)) changed.add(message);
    }
    if (untracked.length === 0) return [...changed];
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

  clientThreads(client: AgentClient): string[] {
    return [...this.#loadedThreads, ...this.#unloadedThreads]
      .filter(([, owner]) => owner === client)
      .map(([externalThreadId]) => externalThreadId);
  }

  unloadClientThreads(client: AgentClient): void {
    for (const threads of [this.#loadedThreads, this.#unloadedThreads]) {
      for (const [externalThreadId, owner] of threads) {
        if (owner === client) threads.delete(externalThreadId);
      }
    }
  }

  unloadAgentThreads(agentId: string): void {
    for (const [externalThreadId, owner] of this.#threadToAgent) {
      const client = owner === agentId ? this.#loadedThreads.get(externalThreadId) : undefined;
      if (!client) continue;
      this.#loadedThreads.delete(externalThreadId);
      this.#unloadedThreads.set(externalThreadId, client);
    }
  }

  openAgentThreads(agentId: string): Array<[externalThreadId: string, client: AgentClient]> {
    const open: Array<[string, AgentClient]> = [];
    for (const [externalThreadId, owner] of this.#threadToAgent) {
      const client = owner === agentId ? this.openClientFor(externalThreadId) : undefined;
      if (client) open.push([externalThreadId, client]);
    }
    return open;
  }

  registerRoutineSession(agentId: string, externalThreadId: string): void {
    this.#routineSessions.set(externalThreadId, agentId);
  }

  forgetRoutineSession(externalThreadId: string): void {
    this.#routineSessions.delete(externalThreadId);
  }

  routineSession(agentId: string, publicThreadId: string): string | undefined {
    let newest: string | undefined;
    for (const [externalThreadId, owner] of this.#routineSessions)
      if (owner === agentId && this.#publicThreads.get(externalThreadId) === publicThreadId) newest = externalThreadId;
    return newest;
  }

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
    this.#executionSnapshots.delete(threadId);
    this.#dropCachedExecutionSnapshot(threadId);
    this.#conversationSignatures.delete(threadId);
    this.#unstoredSends.delete(threadId);
    this.#deletedMessageIds.delete(threadId);
  }

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
    const evicted = this.#evictedSnapshots.get(agentId);
    const retained = evicted?.threadId === threadId ? evicted.snapshot.deref() : undefined;
    if (retained) remove(retained);
    const live = this.#snapshots.get(agentId);
    if (live?.threadId !== threadId) return undefined;
    remove(live);
    this.#keepSnapshot(agentId, live);
    return this.#snapshots.get(agentId);
  }

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

  withConversationTransaction<T>(
    agentId: string,
    work: (transaction: ConversationTransaction) => ConversationTransactionResult<T>,
    onRollback?: () => void,
  ): T {
    const previousAgent = this.requireKnownAgent(agentId);
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

function withMailboxMessages(
  completed: readonly ConversationMessage[],
  recent: ConversationMessage[],
  active: readonly ConversationMessage[],
): ConversationMessage[] {
  const older = completed.slice(0, completed.length - recent.length);
  if (older.length === 0) return recent;
  const queued = new Set(older.filter(hasActiveDelivery));
  let oldest: string | undefined;
  for (const message of [...recent, ...active, ...queued])
    if (oldest === undefined || message.createdAt < oldest) oldest = message.createdAt;
  const from = oldest;
  if (from === undefined) return recent;
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

interface MessageDigests {
  readonly json: (message: ConversationMessage) => string;
  readonly signature: (message: ConversationMessage) => string;
  readonly bytes: (message: ConversationMessage) => number;
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
      let size = Buffer.byteLength(JSON.stringify({ ...snapshot, messages: [] }), "utf8");
      for (const message of messages) size += bytes(message);
      return messages.length > 0 ? size - 1 : size;
    },
  };
}
