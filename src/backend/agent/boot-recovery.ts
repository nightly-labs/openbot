import { Effect, Schema } from "effect";
import type { AgentProvider } from "../agent-client";
import type { AgentStore } from "../agent-store";
import { mergeProviderHistory, snapshotFromThread } from "../conversation-snapshots";
import { causeHelpers } from "../effect-boundary";
import type { MailboxStore } from "../mailbox-store";
import { decodeThreadResponse } from "../protocol";
import type { ConversationRuntime } from "./conversation-runtime";
import { conversationContentSignature } from "./delivery-content";
import { markIncompleteImageGeneration } from "./image-generation";
import type { MailboxSync } from "./mailbox-sync";
import type { ProviderRuntime } from "./provider-runtime";
import { providerForAgent } from "./thread-items";
import type { ThreadLifecycle } from "./thread-lifecycle";

export interface BootRecoveryHooks {
  executionThreads?(): Array<{ id: string; threadId: string }>;
  deliveryThreadId?(deliveryId: string): string | null;
  emitError(code: string, error: unknown, agentId?: string): void;
}

export interface BootRecoveryOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  providers: ProviderRuntime;
  conversation: ConversationRuntime;
  mailboxSync: MailboxSync;
  threads: ThreadLifecycle;
  hooks: BootRecoveryHooks;
}

/**
 * Restart recovery: settles what the previous process left mid-flight.
 *
 * - `recoverPersistedTurns` runs at startup before providers start: clears
 *   stale active turns, expires unanswered prompts, marks streaming messages
 *   interrupted.
 * - `reconcileUnresolvedDeliveries` runs once providers are ready: asks the
 *   provider what really happened to each orphaned delivery instead of
 *   assuming, and conservatively keeps `interrupted` on any doubt — never
 *   repeats uncertain side effects. A delivery is orphaned when the process
 *   that ran it is gone: the previous OpenBot run, or a provider CLI that
 *   exited. Any other unsettled delivery is a live turn of this run.
 * - `backfillProviderHistory` merges provider-side turns that happened while
 *   OpenBot was down into the persisted conversation.
 *
 * Reads the store/mailbox/provider and writes the database plus in-memory
 * snapshots; delivery to the renderer goes through `mailboxSync` and
 * `emitError`. Never imports the facade.
 */
export class BootRecovery {
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #providers: ProviderRuntime;
  readonly #conversation: ConversationRuntime;
  readonly #mailboxSync: MailboxSync;
  readonly #threads: ThreadLifecycle;
  readonly #hooks: BootRecoveryHooks;
  /**
   * Readiness also follows a provider restart, and startup readiness can come after the user's
   * first message has started on a provider that was ready sooner. Settling every unresolved
   * delivery then read a live turn as finished: its reply arrived in a chat that already showed
   * no active turn, and `markTerminal` cannot correct a terminal status.
   */
  readonly #orphanedDeliveryIds = new Set<string>();

  constructor(options: BootRecoveryOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#providers = options.providers;
    this.#conversation = options.conversation;
    this.#mailboxSync = options.mailboxSync;
    this.#threads = options.threads;
    this.#hooks = options.hooks;
  }

  private threads() {
    const agents = this.#store.list();
    return [
      ...agents,
      ...(this.#hooks.executionThreads?.() ?? []).flatMap((context) => {
        const agent = agents.find((item) => item.id === context.id);
        if (!agent) return [];
        this.#conversation.registerExecutionThread(agent.id, context.threadId);
        return [{ ...agent, threadId: context.threadId }];
      }),
    ];
  }

  /**
   * The provider's shared CLI exited, so the deliveries it was running have no turn left to finish.
   * An agent that runs on a process of its own (`runsOnOwnProcess`) keeps its turn.
   */
  orphanDeliveriesOf(provider: AgentProvider, runsOnOwnProcess: (agentId: string) => boolean): void {
    const agents = this.#store.list();
    for (const { delivery } of this.#mailbox.unresolvedDeliveries()) {
      const agent = agents.find((candidate) => candidate.id === delivery.recipientAgentId);
      if (agent && providerForAgent(agent) === provider && !runsOnOwnProcess(agent.id)) {
        this.#orphanedDeliveryIds.add(delivery.id);
      }
    }
  }

  /** Like `orphanDeliveriesOf`, for one agent whose own provider process exited. */
  orphanDeliveriesOfAgent(agentId: string): void {
    for (const { delivery } of this.#mailbox.unresolvedDeliveries()) {
      if (delivery.recipientAgentId === agentId) this.#orphanedDeliveryIds.add(delivery.id);
    }
  }

  readonly reconcileUnresolvedDeliveries = Effect.fn("BootRecovery.reconcileUnresolvedDeliveries")(function* (
    this: BootRecovery,
  ) {
    const unresolved = yield* recoveryStep(() => this.#mailbox.unresolvedDeliveries());
    // A delivery settled by another path never becomes unresolved again, so its mark goes too.
    const unresolvedIds = new Set(unresolved.map(({ delivery }) => delivery.id));
    for (const id of this.#orphanedDeliveryIds) {
      if (!unresolvedIds.has(id)) this.#orphanedDeliveryIds.delete(id);
    }
    // An agent starts one turn at a time, so its unconfirmed deliveries are one batch. The turn names
    // only the first of them as its client id, and the others ran in that same turn.
    const unconfirmedStarts = new Map<string, Set<string>>();
    for (const { delivery } of unresolved) {
      if (delivery.status !== "starting" || delivery.turnId) continue;
      const ids = unconfirmedStarts.get(delivery.recipientAgentId) ?? new Set<string>();
      unconfirmedStarts.set(delivery.recipientAgentId, ids.add(delivery.id));
    }
    for (const context of unresolved) {
      const { delivery } = context;
      if (!this.#orphanedDeliveryIds.delete(delivery.id)) continue;
      const interrupted = {
        terminal: "interrupted" as const,
        reason: "OpenBot restarted before this delivery reached a confirmed terminal state.",
      };
      const { terminal, reason } = yield* Effect.gen({ self: this }, function* () {
        const { agent, client, session } = yield* recoveryStep(() => {
          const agent = this.#store.list().find((candidate) => candidate.id === delivery.recipientAgentId);
          const client = agent ? this.#providers.clientForAgent(agent) : null;
          const threadId = this.#hooks.deliveryThreadId?.(delivery.id) ?? agent?.threadId;
          const session =
            agent && threadId ? this.#store.database.activeProviderSession(threadId, agent.provider) : null;
          return { agent, client, session };
        });
        if (agent && session && client) {
          const params = yield* this.#threads
            .threadParams(agent, client, session.externalSessionId)
            .pipe(toBootRecoveryFailed);
          const response = yield* client
            .request("thread/read", { ...params, includeTurns: true }, decodeThreadResponse)
            .pipe(toBootRecoveryFailed);
          const batchIds = delivery.turnId ? null : unconfirmedStarts.get(delivery.recipientAgentId);
          const turn = response.thread.turns?.find(
            (candidate) =>
              candidate.id === delivery.turnId ||
              candidate.items?.some(
                (item) =>
                  item.type === "userMessage" &&
                  !!item.clientId &&
                  (item.clientId === delivery.id || batchIds?.has(item.clientId) === true),
              ),
          );
          if (turn && !delivery.turnId) {
            yield* this.#mailbox.markRunning(delivery.id, turn.id).pipe(toBootRecoveryFailed);
          }
          if (turn?.status === "completed") {
            return { terminal: "completed" as const, reason: null };
          } else if (turn?.status === "failed") {
            return { terminal: "failed" as const, reason: "The recovered Codex turn failed." };
          }
        }
        return interrupted;
      }).pipe(Effect.catch(() => Effect.succeed(interrupted)));
      // A failed provider read keeps the conservative interrupted result; never replay side effects.
      yield* this.#mailbox.markTerminal(delivery.id, terminal, reason).pipe(toBootRecoveryFailed);
      yield* recoveryStep(() => {
        const agent = this.#store.list().find((candidate) => candidate.id === delivery.recipientAgentId);
        const threadId = this.#hooks.deliveryThreadId?.(delivery.id) ?? agent?.threadId;
        if (agent && threadId) {
          const snapshot = this.#store.database.readConversation(agent.id, threadId);
          snapshot.activeTurnId = null;
          for (const message of snapshot.messages) {
            if (message.turnId === delivery.turnId && message.status === "streaming") {
              message.status = terminal;
              markIncompleteImageGeneration(message, terminal);
            }
          }
          this.#store.database.persistConversation(snapshot, "turn.reconciled-after-restart", {
            turnId: delivery.turnId,
            status: terminal,
          });
        }
        this.#mailboxSync.emitQueue(delivery.recipientAgentId);
      });
    }
  }, Effect.uninterruptible);

  recoverPersistedTurns(): void {
    for (const { delivery } of this.#mailbox.unresolvedDeliveries()) this.#orphanedDeliveryIds.add(delivery.id);
    for (const agent of this.threads()) {
      if (!agent.threadId) continue;
      const snapshot = this.#store.database.readConversation(agent.id, agent.threadId);
      const turnId = snapshot.activeTurnId;
      let changed = false;
      if (turnId) {
        snapshot.activeTurnId = null;
        changed = true;
      }
      for (const message of snapshot.messages) {
        if (message.questionPrompt?.resolution === null) {
          message.questionPrompt.resolution = { status: "expired" };
          changed = true;
        }
        if (turnId && message.turnId === turnId && message.status === "streaming") {
          message.status = "interrupted";
          markIncompleteImageGeneration(message, "interrupted");
          changed = true;
        }
      }
      if (!changed) continue;
      const persisted = this.#store.database.persistConversation(snapshot, "turn.interrupted-by-restart", { turnId });
      this.#conversation.setSnapshot(agent.id, persisted);
    }
  }

  readonly backfillProviderHistory = Effect.fn("BootRecovery.backfillProviderHistory")(function* (this: BootRecovery) {
    for (const agent of yield* recoveryStep(() => this.threads())) {
      const publicThreadId = agent.threadId;
      if (!publicThreadId) continue;
      // Inactive sessions still own history after an upgrade or provider switch.
      const active = this.#store.database.activeProviderSession(publicThreadId, agent.provider);
      for (const session of this.#store.database.listProviderSessions(publicThreadId)) {
        const client = this.#providers.clientFor(session.provider);
        if (!client) continue;
        yield* Effect.gen({ self: this }, function* () {
          // The full parameters for the session the agent still runs on, and the id alone for the
          // retired ones: a client that loads a session to read it must not reopen a session that
          // was deliberately replaced.
          const params =
            session.externalSessionId === active?.externalSessionId
              ? yield* this.#threads.threadParams(agent, client, session.externalSessionId).pipe(toBootRecoveryFailed)
              : { threadId: session.externalSessionId };
          const response = yield* client
            .request("thread/read", { ...params, includeTurns: true }, decodeThreadResponse)
            .pipe(toBootRecoveryFailed);
          yield* recoveryStep(() => {
            const imported = snapshotFromThread(
              agent.id,
              response.thread,
              (deliveryId) => this.#mailbox.getDelivery(deliveryId),
              (messageId) => this.#mailbox.deliveryForMessage(messageId, agent.id),
            );
            imported.threadId = publicThreadId;
            const current = this.#store.database.readConversation(agent.id, publicThreadId);
            const merged = mergeProviderHistory(current, imported, session.provider);
            this.#mailboxSync.syncMailboxMessages(merged);
            if (conversationContentSignature(merged) === conversationContentSignature(current)) {
              const live = this.#conversation.ensureSnapshot(agent.id, publicThreadId);
              if (!live?.activeTurnId) this.#conversation.setSnapshot(agent.id, current);
              return;
            }
            const persisted = this.#store.database.persistConversation(merged, "provider-history.backfilled", {
              provider: session.provider,
              externalSessionId: session.externalSessionId,
            });
            const live = this.#conversation.ensureSnapshot(agent.id, publicThreadId);
            if (!live?.activeTurnId) {
              this.#conversation.setSnapshot(agent.id, persisted);
              if (this.#conversation.isExecutionThread(publicThreadId))
                this.#conversation.publishConversation(persisted);
            }
          });
        }).pipe(
          Effect.catch((failure) =>
            Effect.sync(() => this.#hooks.emitError("provider_history_backfill_pending", failure.cause, agent.id)),
          ),
        );
      }
    }
  });
}

class BootRecoveryFailed extends Schema.TaggedError<BootRecoveryFailed>()("BootRecoveryFailed", {
  cause: Schema.Defect(),
}) {}

const { sync: recoveryStep, rewrap: toBootRecoveryFailed } = causeHelpers(BootRecoveryFailed);
