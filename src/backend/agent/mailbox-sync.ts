import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import type {
  AgentEvent,
  AgentSummary,
  ConversationMessage,
  ConversationSnapshot,
  QueueHold,
  QueueSnapshot,
} from "@openbot/contracts/ipc";
import { Effect, type Scope } from "effect";
import { isMailboxMessageCopy } from "../conversation-snapshots";
import type { MailboxStore } from "../mailbox-store";
import type { OpenBotDatabase } from "../openbot-database";
import type { ConversationRuntime } from "./conversation-runtime";
import { conversationContentSignature } from "./delivery-content";
import type { RoutineScheduler } from "./routine-scheduler";

export interface MailboxSyncHooks {
  emit(event: AgentEvent): void;
  emitError(code: string, error: unknown, agentId?: string): void;
  /** What holds the queue back, when the reason is not this agent's own running turn. */
  queueHold(agentId: string): QueueHold | null;
}

export interface MailboxSyncOptions {
  database: OpenBotDatabase;
  mailbox: MailboxStore;
  conversation: ConversationRuntime;
  routines: RoutineScheduler;
  scope: () => Scope.Scope;
  hooks: MailboxSyncHooks;
}

/**
 * Keeps conversation snapshots merged with mailbox rows, and fans queue
 * state out to the renderer.
 *
 * Owns no durable state — every method reads the mailbox/database and writes
 * the in-memory snapshot. The facade keeps no wrappers: call sites use this
 * directly, and later extractions (drain, turn lifecycle) take it as a dep
 * instead of reaching into the mailbox themselves.
 */
export class MailboxSync {
  readonly #database: OpenBotDatabase;
  readonly #mailbox: MailboxStore;
  readonly #conversation: ConversationRuntime;
  readonly #routines: RoutineScheduler;
  readonly #scope: () => Scope.Scope;
  readonly #hooks: MailboxSyncHooks;

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
    if (context.delivery.turnId === null) delete message.turnId;
    else message.turnId = context.delivery.turnId;
    message.delivery = {
      id: context.delivery.id,
      status: context.delivery.status,
      position: context.delivery.position,
    };
  }

  syncMailboxMessages(snapshot: ConversationSnapshot, mailboxMessages?: readonly ConversationMessage[]): void {
    if (this.#conversation.isExecutionThread(snapshot.threadId)) return;
    const fromCreatedAt = snapshot.messages[0]?.createdAt;
    const incomingMailboxMessages =
      mailboxMessages ??
      this.#mailbox.conversationMessages(snapshot.agentId, fromCreatedAt === undefined ? {} : { fromCreatedAt });
    const incomingMessages = new Map(
      incomingMailboxMessages.flatMap((message) =>
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
    const reactions = this.#mailbox.reactionsFor(snapshot.agentId);
    for (const message of snapshot.messages) {
      message.reactions = reactions.get(message.id) ?? [];
      message.reaction = message.reactions.find((reaction) => reaction.actor.kind === "user")?.emoji ?? null;
    }
    sortConversationMessages(snapshot.messages);
  }

  reconcilePersistedMailboxMessages(agent: AgentSummary): void {
    if (!agent.threadId) return;
    const page = this.#database.readConversationPage(agent.id, agent.threadId, { type: "latest" }, 100);
    const persisted: ConversationSnapshot = {
      agentId: page.agentId,
      threadId: page.threadId,
      activeTurnId: page.activeTurnId,
      revision: page.revision,
      messages: page.messages,
    };
    const previousMessageIds = new Set(persisted.messages.map((message) => message.id));
    const previousSignature = conversationContentSignature(persisted);
    const oldest = persisted.messages[0]?.createdAt;
    this.syncMailboxMessages(
      persisted,
      this.#mailbox.conversationMessages(agent.id, oldest === undefined ? {} : { fromCreatedAt: oldest }),
    );
    if (conversationContentSignature(persisted) === previousSignature) return;
    this.#database.persistConversationChanges({
      agentId: agent.id,
      threadId: agent.threadId,
      activeTurnId: persisted.activeTurnId,
      changedMessages: persisted.messages,
      removedMessageIds: [...previousMessageIds].filter(
        (messageId) => !persisted.messages.some((message) => message.id === messageId),
      ),
      eventType: "conversation.mailbox-reconciled",
      detail: {
        messageCount: persisted.messages.length,
      },
    });
    const live = this.#conversation.snapshot(agent.id);
    if (live) {
      const liveOldest = live.messages[0]?.createdAt;
      this.syncMailboxMessages(
        live,
        this.#mailbox.conversationMessages(agent.id, liveOldest === undefined ? {} : { fromCreatedAt: liveOldest }),
      );
    }
  }

  /**
   * The queue the user reads, carrying the reason it waits when something outside this agent holds
   * it. `AgentService.listQueue` returns this as well, so a reload and a reconnect report the same
   * wait as the event below.
   */
  queueSnapshot(agentId: string): QueueSnapshot {
    const queue = this.#mailbox.listQueue(agentId);
    if (!queue.deliveries.some((delivery) => delivery.status === "queued")) return queue;
    const hold = this.#hooks.queueHold(agentId);
    return hold ? { ...queue, hold } : queue;
  }

  emitQueue(agentId: string): void {
    const queue = this.queueSnapshot(agentId);
    let routinesChanged = false;
    for (const delivery of queue.deliveries) {
      if (this.#routines.reconcileDelivery(delivery)) routinesChanged = true;
    }
    this.#hooks.emit({ type: "queue-changed", snapshot: queue });
    if (routinesChanged) this.#routines.stateChanged(agentId);
    const affectedAgents = new Set([agentId, ...this.#mailbox.senderAgentIdsForRecipient(agentId)]);
    for (const affectedAgentId of affectedAgents) {
      const snapshot = this.#conversation.snapshotToUpdate(affectedAgentId);
      if (!snapshot) continue;
      const previousSignature = conversationContentSignature(snapshot);
      this.syncMailboxMessages(snapshot);
      if (conversationContentSignature(snapshot) !== previousSignature) this.#conversation.emitConversation(snapshot);
      else if (!this.#conversation.hasPublishedConversation(affectedAgentId))
        this.#conversation.publishConversation(snapshot);
    }
  }

  retryDeliveryReconciliation(
    agentId: string,
    turnId?: string,
    deliveryIds: readonly string[] = [],
    confirmedSteer = false,
  ): void {
    queueMicrotask(() => {
      Effect.runFork(
        Effect.gen({ self: this }, function* () {
          // A provider response can arrive before the mailbox writes complete. Associate every
          // still-starting row with the confirmed turn before publishing the retry. This is safe:
          // the turn id came from the provider, and it prevents a second drain from replaying it.
          // Check the active marker again so a delayed retry cannot claim a new turn's rows.
          const activeTurn = this.#conversation.workingSnapshot(agentId)?.activeTurnId;
          if (turnId && (activeTurn === turnId || confirmedSteer)) {
            const accepted = new Set(deliveryIds);
            for (const deliveryId of accepted) {
              const current = this.#mailbox.getDelivery(deliveryId)?.delivery;
              if (
                current?.recipientAgentId !== agentId ||
                current.status !== "starting" ||
                (current.turnId !== null && current.turnId !== turnId)
              )
                continue;
              if (current.turnId === turnId) yield* this.#mailbox.confirmSteered(deliveryId, turnId);
              else if (activeTurn === turnId) yield* this.#mailbox.markRunning(deliveryId, turnId);
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
