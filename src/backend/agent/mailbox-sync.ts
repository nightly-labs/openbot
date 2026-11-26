import { isDeepStrictEqual } from "node:util";
import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import {
  type AgentEvent,
  type AgentSummary,
  type ConversationMessage,
  type ConversationSnapshot,
  modelSwitchReason,
  type QueueDeliveryStatus,
  type QueueHold,
  type QueueSnapshot,
} from "@openbot/contracts/ipc";
import { Effect, type Scope } from "effect";
import { isMailboxMessageCopy } from "../conversation-snapshots";
import type { MailboxStore } from "../mailbox-store";
import type { OpenBotDatabase } from "../openbot-database";
import type { ConversationRuntime } from "./conversation-runtime";
import { conversationContentSignature } from "./delivery-content";
import type { RoutineScheduler } from "./routine-scheduler";

const OPEN_STATUSES: ReadonlySet<QueueDeliveryStatus> = new Set(["queued", "starting", "running"]);

export interface MailboxSyncHooks {
  emit(event: AgentEvent): void;
  emitError(code: string, error: unknown, agentId?: string): void;
  queueHold(agentId: string): QueueHold | null;
  threadRequestsChanged(agentId: string): void;
}

export interface MailboxSyncOptions {
  database: OpenBotDatabase;
  mailbox: MailboxStore;
  conversation: ConversationRuntime;
  routines: RoutineScheduler;
  scope: () => Scope.Scope;
  hooks: MailboxSyncHooks;
}

export class MailboxSync {
  readonly #database: OpenBotDatabase;
  readonly #mailbox: MailboxStore;
  readonly #conversation: ConversationRuntime;
  readonly #routines: RoutineScheduler;
  readonly #scope: () => Scope.Scope;
  readonly #hooks: MailboxSyncHooks;
  #threadRequests = new Map<string, string>();

  constructor(options: MailboxSyncOptions) {
    this.#database = options.database;
    this.#mailbox = options.mailbox;
    this.#conversation = options.conversation;
    this.#routines = options.routines;
    this.#scope = options.scope;
    this.#hooks = options.hooks;
  }

  syncDeliveryMessage(snapshot: ConversationSnapshot, deliveryId: string): void {
    const context = this.#mailbox.getDelivery(deliveryId);
    const message = snapshot.messages.find((candidate) => candidate.id === deliveryId);
    if (!context || !message) return;
    const turnId =
      context.planContinuation?.turnIds[0] ??
      context.resumeAfterUsageLimit?.previousTurnIds[0] ??
      context.delivery.turnId;
    if (turnId === null) delete message.turnId;
    else message.turnId = turnId;
    if (turnId !== null && turnId !== deliveryId)
      for (const note of snapshot.messages)
        if (note.turnId === deliveryId && modelSwitchReason(note) !== null) note.turnId = turnId;
    message.delivery = {
      id: context.delivery.id,
      status: context.delivery.status,
      position: context.delivery.position,
    };
  }

  syncMailboxMessages(snapshot: ConversationSnapshot, mailboxMessages?: readonly ConversationMessage[]): void {
    if (this.#conversation.isExecutionThread(snapshot.threadId)) return;
    const fromCreatedAt = snapshot.messages[0]?.createdAt;
    const mailboxCopies =
      mailboxMessages ??
      this.#mailbox.conversationMessages(snapshot.agentId, fromCreatedAt === undefined ? {} : { fromCreatedAt });
    const deleted = snapshot.threadId
      ? this.#database.deletedConversationMessageIds(snapshot.threadId)
      : new Set<string>();
    const incomingMailboxMessages =
      deleted.size === 0 ? mailboxCopies : mailboxCopies.filter((message) => !deleted.has(message.id));
    const incomingMessages = new Map(
      mailboxCopies.flatMap((message) =>
        message.exchange?.direction === "incoming" ? [[message.exchange.messageId, message] as const] : [],
      ),
    );
    for (let index = snapshot.messages.length - 1; index >= 0; index--) {
      const message = snapshot.messages[index];
      if (message && isMailboxMessageCopy(message, incomingMessages)) snapshot.messages.splice(index, 1);
    }
    const indexes = new Map(snapshot.messages.map((message, index) => [message.id, index]));
    for (const mailboxMessage of incomingMailboxMessages) {
      const index = indexes.get(mailboxMessage.id);
      if (index !== undefined) snapshot.messages[index] = mailboxMessage;
      else {
        indexes.set(mailboxMessage.id, snapshot.messages.length);
        snapshot.messages.push(mailboxMessage);
      }
    }
    const read = new Set(mailboxCopies.map((message) => message.id));
    for (const message of snapshot.messages) if (!read.has(message.id)) this.#refreshOpenRequest(message);
    const reactions = this.#mailbox.reactionsFor(snapshot.agentId);
    for (const message of snapshot.messages) {
      message.reactions = reactions.get(message.id) ?? [];
      message.reaction = message.reactions.find((reaction) => reaction.actor.kind === "user")?.emoji ?? null;
    }
    sortConversationMessages(snapshot.messages);
  }

  #refreshOpenRequest(message: ConversationMessage): void {
    const exchange = message.exchange;
    if (exchange?.direction !== "outgoing" || !exchange.deliveries.some(({ status }) => OPEN_STATUSES.has(status)))
      return;
    message.exchange = {
      ...exchange,
      deliveries: exchange.deliveries.map((delivery) => {
        const current = this.#mailbox.getDelivery(delivery.id)?.delivery;
        if (!current) return delivery;
        return {
          ...delivery,
          status: this.#mailbox.outgoingRequestStatus(current, exchange.expectsReply !== false),
          position: current.position,
          error: current.error,
        };
      }),
    };
  }

  #emitThreadRequests(): void {
    const requests = new Map<string, string>();
    for (const request of this.#mailbox.awaitedThreadRequests()) {
      const key = `${request.deliveryId}:${request.status};`;
      requests.set(request.senderAgentId, (requests.get(request.senderAgentId) ?? "") + key);
    }
    const before = this.#threadRequests;
    this.#threadRequests = requests;
    for (const agentId of new Set([...before.keys(), ...requests.keys()]))
      if (before.get(agentId) !== requests.get(agentId)) this.#hooks.threadRequestsChanged(agentId);
  }

  refreshQueuePositions(messages: readonly ConversationMessage[]): void {
    const queued = (delivery: { status: string } | undefined) => delivery?.status === "queued";
    if (!messages.some((message) => queued(message.delivery) || message.exchange?.deliveries.some(queued))) return;
    const positions = this.#mailbox.queuedPositions();
    for (const message of messages) {
      if (message.delivery && queued(message.delivery))
        message.delivery.position = positions.get(message.delivery.id) ?? message.delivery.position;
      for (const delivery of message.exchange?.deliveries ?? [])
        if (queued(delivery)) delivery.position = positions.get(delivery.id) ?? delivery.position;
    }
  }

  reconcilePersistedMailboxMessages(agent: AgentSummary): void {
    if (!agent.threadId) return;
    const page = this.#database.readConversationPage(agent.id, agent.threadId, { type: "latest" }, 100);
    const persisted: ConversationSnapshot = {
      agentId: page.agentId,
      threadId: page.threadId,
      activeTurnId: page.activeTurnId,
      revision: page.revision,
      messages: page.messages.map((message) => ({ ...message })),
    };
    const oldest = persisted.messages[0]?.createdAt;
    this.syncMailboxMessages(
      persisted,
      this.#mailbox.conversationMessages(agent.id, oldest === undefined ? {} : { fromCreatedAt: oldest }),
    );
    if (isDeepStrictEqual(JSON.parse(JSON.stringify(persisted.messages)), page.messages)) return;
    const stored = new Map(page.messages.map((message) => [message.id, message]));
    const changedMessages = this.#database.changedConversationMessages(agent.threadId, persisted.messages, stored);
    const keptMessageIds = new Set(persisted.messages.map((message) => message.id));
    const removedMessageIds = [...stored.keys()].filter((messageId) => !keptMessageIds.has(messageId));
    if (changedMessages.length > 0 || removedMessageIds.length > 0) {
      this.#database.persistConversationChanges({
        agentId: agent.id,
        threadId: agent.threadId,
        activeTurnId: persisted.activeTurnId,
        changedMessages,
        removedMessageIds,
        eventType: "conversation.mailbox-reconciled",
        detail: {
          messageCount: changedMessages.length,
        },
      });
    }
    const live = this.#conversation.snapshot(agent.id);
    if (live) {
      const liveOldest = live.messages[0]?.createdAt;
      this.syncMailboxMessages(
        live,
        this.#mailbox.conversationMessages(agent.id, liveOldest === undefined ? {} : { fromCreatedAt: liveOldest }),
      );
    }
  }

  queueSnapshot(agentId: string): QueueSnapshot {
    return this.withHold(this.#mailbox.listQueue(agentId));
  }

  withHold(queue: QueueSnapshot): QueueSnapshot {
    if (!queue.deliveries.some((delivery) => delivery.status === "queued")) return queue;
    const hold = this.#hooks.queueHold(queue.agentId);
    return hold ? { ...queue, hold } : queue;
  }

  emitQueue(agentId: string): void {
    const queue = this.queueSnapshot(agentId);
    let routinesChanged = false;
    for (const delivery of [...queue.deliveries, ...this.#mailbox.taskRoutineDeliveries(agentId)]) {
      if (this.#routines.reconcileDelivery(delivery)) routinesChanged = true;
    }
    this.#hooks.emit({ type: "queue-changed", snapshot: queue });
    if (routinesChanged) this.#routines.stateChanged(agentId);
    this.#emitThreadRequests();
    const affectedAgents = new Set([agentId, ...this.#mailbox.senderAgentIdsForRecipient(agentId)]);
    for (const affectedAgentId of affectedAgents) {
      const snapshot = this.#conversation.snapshotToUpdate(affectedAgentId);
      if (!snapshot) continue;
      const previousSignature = conversationContentSignature(snapshot);
      this.syncMailboxMessages(snapshot);
      const signature = conversationContentSignature(snapshot);
      if (signature !== previousSignature) this.#conversation.emitConversation(snapshot);
      else if (!this.#conversation.hasPublishedConversation(affectedAgentId))
        this.#conversation.publishConversation(snapshot, signature);
    }
  }

  retryDeliveryReconciliation(agentId: string, turnId?: string, deliveryIds: readonly string[] = []): void {
    queueMicrotask(() => {
      Effect.runFork(
        Effect.gen({ self: this }, function* () {
          if (turnId && this.#conversation.snapshotWithTurn(agentId, turnId)) {
            const accepted = new Set(deliveryIds);
            for (const deliveryId of accepted) {
              const current = this.#mailbox.getDelivery(deliveryId)?.delivery;
              if (current?.recipientAgentId !== agentId || current.status !== "starting" || current.turnId !== null)
                continue;
              yield* this.#mailbox.markRunning(deliveryId, turnId);
            }
          }
          yield* Effect.sync(() => {
            this.emitQueue(agentId);
            const snapshot = this.#conversation.snapshotToUpdate(agentId);
            if (snapshot) this.#conversation.emitConversation(snapshot);
          });
        })
          .pipe(
            Effect.catch((failure) =>
              Effect.sync(() => {
                this.#hooks.emitError("delivery_reconciliation_pending", failure, agentId);
              }),
            ),
          )
          .pipe(Effect.forkIn(this.#scope(), { startImmediately: true })),
      );
    });
  }
}
