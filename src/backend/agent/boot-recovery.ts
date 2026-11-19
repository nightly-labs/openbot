import {
  CONVERSATION_PLAN_ITEM_TYPE,
  type ConversationMessage,
  PLAN_CONTINUATION_ITEM_TYPE,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Cause, Effect, Schema } from "effect";
import { type AgentProvider, RequestTimeoutError } from "../agent-client";
import type { AgentStore } from "../agent-store";
import { mergeConversationSnapshots } from "../conversation-snapshots";
import { causeHelpers, reportOriginalFailure } from "../effect-boundary";
import { LineTooLongError } from "../jsonl";
import type { DeliveryContext, MailboxStore } from "../mailbox-store";
import { providerSync } from "../provider-client-effects";
import {
  compactImportedProviderHistory,
  importProviderHistory,
  retiredSessionNeedsHistoryRead,
} from "../provider-history-import";
import { compactThreadEvents } from "../thread-event-compaction-run";
import type { ConversationRuntime } from "./conversation-runtime";
import { conversationContentSignature } from "./delivery-content";
import { markIncompleteMediaGeneration } from "./image-generation";
import type { MailboxSync } from "./mailbox-sync";
import type { PlanContinuation } from "./plan-continuation";
import type { ProviderRuntime } from "./provider-runtime";
import { answeredRequestId } from "./routine-quiet-runs";
import { stopRunningSubagents } from "./subagent-updates";
import { isCodexMissingRollout, isCodexRolloutPending, providerForAgent } from "./thread-items";
import type { ThreadLifecycle } from "./thread-lifecycle";

type UnresolvedDelivery = DeliveryContext["delivery"];

const logger = createOpenBotLogger("provider-history");
const eventLogger = createOpenBotLogger("thread-event-compaction");

export interface BootRecoveryHooks {
  executionThreads?(): Array<{ id: string; threadId: string; channelId?: string }>;
  taskThreads?(): Array<{ id: string; threadId: string }>;
  deliveryThreadId?(deliveryId: string): string | null;
  deliverySettled?(deliveryId: string, terminal: "completed" | "failed" | "interrupted"): void;
  taskOpen(taskId: string): boolean;
  quietRoutineDelivery(deliveryId: string): boolean;
  quietRunDelivery(deliveryId: string): boolean;
  isRoutineThread(threadId: string): boolean;
  emitError(code: string, error: unknown, agentId?: string): void;
  turnFailed?(agentId: string, turnId: string): void;
  continuesAfterProviderExit?(agentId: string, turnId: string, deliveryIds: readonly string[]): boolean;
}

export interface BootRecoveryOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  providers: ProviderRuntime;
  conversation: ConversationRuntime;
  mailboxSync: MailboxSync;
  threads: ThreadLifecycle;
  planContinuation: PlanContinuation;
  hooks: BootRecoveryHooks;
}

export class BootRecovery {
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #providers: ProviderRuntime;
  readonly #conversation: ConversationRuntime;
  readonly #mailboxSync: MailboxSync;
  readonly #threads: ThreadLifecycle;
  readonly #planContinuation: PlanContinuation;
  readonly #hooks: BootRecoveryHooks;
  readonly #orphanedDeliveryIds = new Set<string>();
  readonly #unreadableHistory = new Set<string>();
  #historyCompacted = false;
  #threadEventsCompacted = false;

  constructor(options: BootRecoveryOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#providers = options.providers;
    this.#conversation = options.conversation;
    this.#mailboxSync = options.mailboxSync;
    this.#threads = options.threads;
    this.#planContinuation = options.planContinuation;
    this.#hooks = options.hooks;
  }

  private threads() {
    const agents = this.#store.list();
    return [
      ...agents,
      ...(this.#hooks.executionThreads?.() ?? []).flatMap((context) => {
        const agent = agents.find((item) => item.id === context.id);
        if (!agent || agent.threadId === context.threadId) return [];
        if (context.channelId) this.#conversation.registerChannelThread(agent.id, context.threadId, context.channelId);
        else this.#conversation.registerExecutionThread(agent.id, context.threadId);
        return [{ ...agent, threadId: context.threadId }];
      }),
      ...(this.#hooks.taskThreads?.() ?? []).flatMap((context) => {
        const agent = agents.find((item) => item.id === context.id);
        if (!agent || agent.threadId === context.threadId) return [];
        this.#conversation.registerTaskThread(agent.id, context.threadId);
        return [{ ...agent, threadId: context.threadId }];
      }),
    ];
  }

  orphanDeliveriesOf(provider: AgentProvider, runsOnOwnProcess: (agentId: string) => boolean): void {
    const agents = this.#store.list();
    for (const { delivery } of this.#mailbox.unresolvedDeliveries()) {
      const agent = agents.find((candidate) => candidate.id === delivery.recipientAgentId);
      if (agent && providerForAgent(agent) === provider && !runsOnOwnProcess(agent.id)) {
        this.#orphanedDeliveryIds.add(delivery.id);
      }
    }
  }

  orphanDeliveriesOfAgent(agentId: string): void {
    for (const { delivery } of this.#mailbox.unresolvedDeliveries()) {
      if (delivery.recipientAgentId === agentId) this.#orphanedDeliveryIds.add(delivery.id);
    }
  }

  readonly reconcileUnresolvedDeliveries = Effect.fn("BootRecovery.reconcileUnresolvedDeliveries")(function* (
    this: BootRecovery,
  ) {
    const unresolved = yield* recoveryStep(() => this.#mailbox.unresolvedDeliveries());
    const unresolvedIds = new Set(unresolved.map(({ delivery }) => delivery.id));
    for (const id of this.#orphanedDeliveryIds) {
      if (!unresolvedIds.has(id)) this.#orphanedDeliveryIds.delete(id);
    }
    const laneOf = (delivery: { id: string; recipientAgentId: string }) =>
      `${delivery.recipientAgentId}\u0000${this.#mailbox.laneIdForDelivery(delivery.id) ?? ""}`;
    const unconfirmedStarts = new Map<string, Set<string>>();
    for (const { delivery } of unresolved) {
      if (delivery.status !== "starting" || delivery.turnId) continue;
      const ids = unconfirmedStarts.get(laneOf(delivery)) ?? new Set<string>();
      unconfirmedStarts.set(laneOf(delivery), ids.add(delivery.id));
    }
    for (const { delivery } of unresolved) {
      if (!this.#orphanedDeliveryIds.delete(delivery.id)) continue;
      const batchIds = delivery.turnId ? null : (unconfirmedStarts.get(laneOf(delivery)) ?? null);
      yield* this.#reconcileOrphanedDelivery(delivery, batchIds).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : reportOriginalFailure(cause, (failure) => {
                this.#orphanedDeliveryIds.add(delivery.id);
                this.#hooks.emitError("delivery_reconcile_failed", failure, delivery.recipientAgentId);
              }),
        ),
      );
    }
  });

  readonly #reconcileOrphanedDelivery = Effect.fn("BootRecovery.reconcileOrphanedDelivery")(function* (
    this: BootRecovery,
    delivery: UnresolvedDelivery,
    batchIds: ReadonlySet<string> | null,
  ) {
    const interrupted = {
      terminal: "interrupted" as const,
      reason: "OpenBot restarted before this delivery reached a confirmed terminal state.",
    };
    const recovered = yield* Effect.gen({ self: this }, function* () {
      const { agent, client, session } = yield* recoveryStep(() => {
        const agent = this.#store.list().find((candidate) => candidate.id === delivery.recipientAgentId);
        const client = agent ? this.#providers.clientForAgent(agent) : null;
        const threadId = this.#hooks.deliveryThreadId?.(delivery.id) ?? agent?.threadId;
        const session = agent && threadId ? this.#store.database.activeProviderSession(threadId, agent.provider) : null;
        return { agent, client, session };
      });
      if (agent && session && client) {
        const historyKey = `${session.provider}:${session.externalSessionId}`;
        if (this.#unreadableHistory.has(historyKey)) return interrupted;
        if (!client.readHistory) return interrupted;
        let recovered: { turnId: string; status?: string } | undefined;
        yield* client
          .readHistory(
            {
              threadId: session.externalSessionId,
              cwd: agent.workspacePath,
              items: delivery.turnId ? "none" : "full",
            },
            (fragment) =>
              providerSync(() => {
                const matches =
                  fragment.turnId === delivery.turnId ||
                  fragment.items.some(
                    (item) =>
                      item.type === "userMessage" &&
                      !!item.clientId &&
                      (item.clientId === delivery.id || batchIds?.has(item.clientId) === true),
                  );
                if (matches) {
                  recovered =
                    fragment.status === undefined
                      ? { turnId: fragment.turnId }
                      : { turnId: fragment.turnId, status: fragment.status };
                }
                return !matches;
              }),
          )
          .pipe(
            Effect.tapError((failure) =>
              Effect.sync(() => {
                if (unreadableHistory(failure)) this.#unreadableHistory.add(historyKey);
              }),
            ),
            toBootRecoveryFailed,
          );
        const turn = recovered ? { id: recovered.turnId, status: recovered.status } : undefined;
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
    const target = yield* recoveryStep(() => {
      const agent = this.#store.list().find((candidate) => candidate.id === delivery.recipientAgentId);
      const threadId = this.#hooks.deliveryThreadId?.(delivery.id) ?? agent?.threadId;
      if (!agent || !threadId) return null;
      const recoveryTurnId =
        delivery.turnId ?? this.#store.database.readConversationRuntime(agent.id, threadId).activeTurnId;
      const streaming = this.#store.database
        .readConversationRecoveryMessages(agent.id, threadId, recoveryTurnId)
        .filter((message) => message.turnId === recoveryTurnId && message.status === "streaming");
      return { agent, threadId, turnId: recoveryTurnId, streaming };
    });
    const cut =
      recovered.terminal === "interrupted" &&
      target?.streaming.some((message) => message.author === "assistant" && message.text.trim() !== "") === true;
    const ownChat = cut && target !== null && target.threadId === target.agent.threadId ? target : null;
    const deliveryIds = yield* recoveryStep(() => {
      const ids = new Set([delivery.id]);
      if (!cut || !target?.turnId) return [...ids];
      for (const context of this.#mailbox.findDeliveriesByTurn(target.agent.id, target.turnId))
        ids.add(context.delivery.id);
      for (const id of batchIds ?? []) {
        const status = this.#mailbox.getDelivery(id)?.delivery.status;
        if (status === "starting" || status === "running") ids.add(id);
      }
      return [...ids];
    });
    const continuation = yield* recoveryStep(() => {
      if (!ownChat?.turnId || !this.#hooks.continuesAfterProviderExit?.(ownChat.agent.id, ownChat.turnId, deliveryIds))
        return null;
      const { messages } = this.#conversation.ensureSnapshot(ownChat.agent.id, ownChat.threadId);
      return this.#planContinuation.afterProviderExit({
        agentId: ownChat.agent.id,
        taskId: null,
        deliveryIds,
        plan: messages.find((message) => message.id === `${ownChat.turnId}:plan`)?.plan ?? null,
        earlierPlan:
          messages.findLast(
            (message) => message.itemType === CONVERSATION_PLAN_ITEM_TYPE && message.turnId !== ownChat.turnId,
          )?.plan ?? null,
      });
    });
    const { terminal, reason } =
      cut && !continuation
        ? { terminal: "failed" as const, reason: sourceText("error.agent.answerCutOff") }
        : recovered;
    const requeued = new Set<string>();
    for (const id of deliveryIds) {
      if (continuation && ownChat?.turnId)
        yield* this.#mailbox.requeueForPlan(id, ownChat.turnId).pipe(toBootRecoveryFailed);
      else if (
        terminal === "interrupted" &&
        target !== null &&
        (yield* this.#mailbox.requeueResultAfterRestart(id).pipe(toBootRecoveryFailed))
      )
        requeued.add(id);
      else yield* this.#mailbox.markTerminal(id, terminal, reason).pipe(toBootRecoveryFailed);
      if (id !== delivery.id) this.#orphanedDeliveryIds.delete(id);
    }
    if (!continuation) {
      for (const id of deliveryIds) {
        if (requeued.has(id)) continue;
        const requesterId = yield* this.#mailbox
          .answerFailedRequest(
            id,
            (taskId) => this.#hooks.taskOpen(taskId),
            (agentId) => this.#store.list().some((agent) => agent.id === agentId),
            true,
          )
          .pipe(
            Effect.catch((failure) =>
              Effect.sync(() => {
                this.#hooks.emitError("failed_request_answer_failed", failure.cause, delivery.recipientAgentId);
                return null;
              }),
            ),
          );
        if (requesterId) this.#mailboxSync.emitQueue(requesterId);
      }
    }
    if (ownChat && !continuation) {
      this.#hooks.emitError("agent_error", reason, ownChat.agent.id);
      if (ownChat.turnId) this.#hooks.turnFailed?.(ownChat.agent.id, ownChat.turnId);
    }
    yield* recoveryStep(() => {
      if (target) {
        const { agent, threadId } = target;
        const changedMessages = target.streaming.map((message) => {
          const changed = structuredClone(message);
          changed.status = terminal;
          markIncompleteMediaGeneration(changed, terminal);
          return changed;
        });
        const continuationLine: ConversationMessage | null = continuation
          ? {
              id: `${target.turnId}:plan-continuation`,
              author: "system",
              source: "system",
              status: "completed",
              createdAt: new Date().toISOString(),
              itemType: PLAN_CONTINUATION_ITEM_TYPE,
              text: sourceText("status.agent.providerExitContinues"),
            }
          : null;
        if (continuationLine) changedMessages.push(continuationLine);
        const revision = this.#store.database.persistConversationChanges({
          agentId: agent.id,
          threadId,
          activeTurnId: null,
          changedMessages,
          eventType: "turn.reconciled-after-restart",
          detail: { turnId: delivery.turnId, status: terminal },
        });
        const snapshot = structuredClone(this.#conversation.ensureSnapshot(agent.id, threadId));
        const changedById = new Map(changedMessages.map((message) => [message.id, message]));
        snapshot.messages = snapshot.messages.map((message) => changedById.get(message.id) ?? message);
        if (continuationLine) snapshot.messages.push(continuationLine);
        snapshot.activeTurnId = null;
        snapshot.revision = revision;
        this.#conversation.setSnapshot(agent.id, snapshot);
        this.#conversation.publishConversation(snapshot);
      }
      this.#mailboxSync.emitQueue(delivery.recipientAgentId);
      if (!continuation)
        for (const id of deliveryIds) if (!requeued.has(id)) this.#hooks.deliverySettled?.(id, terminal);
    });
  });

  recoverPersistedTurns(): void {
    for (const { delivery } of this.#mailbox.unresolvedDeliveries()) this.#orphanedDeliveryIds.add(delivery.id);
    const runningTurns = this.#store.database.readRunningTurnIds();
    for (const agent of this.threads()) {
      if (!agent.threadId) continue;
      const turnId = this.#store.database.readConversationRuntime(agent.id, agent.threadId).activeTurnId;
      const staleTurns = (runningTurns.get(agent.threadId) ?? []).filter((candidate) => candidate !== turnId);
      const changedMessages = this.#store.database
        .readConversationRecoveryMessages(agent.id, agent.threadId, turnId)
        .flatMap((message) => {
          const changed = structuredClone(message);
          if (changed.questionPrompt?.resolution === null) {
            changed.questionPrompt.resolution = { status: "expired" };
            if (changed.uiBlock?.state.status === "pending") changed.uiBlock.state = { status: "expired" };
          }
          if (turnId && changed.turnId === turnId && changed.status === "streaming") {
            changed.status = "interrupted";
            markIncompleteMediaGeneration(changed, "interrupted");
          }
          const stopped = stopRunningSubagents(changed.subagents, new Date().toISOString(), { background: true });
          return stopped || changed.questionPrompt?.resolution?.status === "expired" || changed.status === "interrupted"
            ? [changed]
            : [];
        });
      const changed = turnId !== null || changedMessages.length > 0 || staleTurns.length > 0;
      if (!changed) continue;
      const revision = this.#store.database.persistConversationChanges({
        agentId: agent.id,
        threadId: agent.threadId,
        activeTurnId: null,
        changedMessages,
        eventType: "turn.interrupted-by-restart",
        detail: { turnId },
      });
      const snapshot = structuredClone(this.#conversation.ensureSnapshot(agent.id, agent.threadId));
      const changedById = new Map(changedMessages.map((message) => [message.id, message]));
      snapshot.messages = snapshot.messages.map((message) => changedById.get(message.id) ?? message);
      snapshot.activeTurnId = null;
      snapshot.revision = revision;
      this.#conversation.setSnapshot(agent.id, snapshot);
    }
  }

  readonly backfillProviderHistory = Effect.fn("BootRecovery.backfillProviderHistory")(function* (this: BootRecovery) {
    for (const agent of yield* recoveryStep(() => this.threads())) {
      const publicThreadId = agent.threadId;
      if (!publicThreadId) continue;
      const active = this.#store.database.activeProviderSession(publicThreadId, agent.provider);
      for (const session of this.#store.database.listProviderSessions(publicThreadId)) {
        if (
          session.state === "inactive" &&
          !retiredSessionNeedsHistoryRead(this.#store.database.providerHistoryImport(session.id), session.updatedAt)
        )
          continue;
        const client =
          session.externalSessionId === active?.externalSessionId
            ? this.#providers.historyClientForAgent(agent)
            : this.#providers.clientFor(session.provider);
        if (!client) continue;
        const historyKey = `${session.provider}:${session.externalSessionId}`;
        if (this.#unreadableHistory.has(historyKey)) continue;
        yield* Effect.gen({ self: this }, function* () {
          const params =
            session.externalSessionId === active?.externalSessionId
              ? yield* this.#threads.threadParams(agent, client, session.externalSessionId).pipe(toBootRecoveryFailed)
              : { threadId: session.externalSessionId };
          if (!client.readHistory) return;
          yield* importProviderHistory({
            database: this.#store.database,
            readHistory: client.readHistory.bind(client),
            sessionId: session.id,
            provider: session.provider,
            externalSessionId: session.externalSessionId,
            agentId: agent.id,
            publicThreadId,
            cwd: typeof params.cwd === "string" ? params.cwd : agent.workspacePath,
            findDelivery: (deliveryId) => this.#mailbox.deliveryForProviderMessage(agent.id, deliveryId),
            findMessageDelivery: (messageId) => this.#mailbox.deliveryForMessage(messageId, agent.id),
            quietRoutineDelivery: (deliveryId) => this.#hooks.quietRoutineDelivery(deliveryId),
            quietTeammateThread:
              !this.#conversation.isExecutionThread(publicThreadId) || this.#hooks.isRoutineThread(publicThreadId),
            continuesQuietRun: (delivery) => {
              const requestId = answeredRequestId(delivery);
              const run = requestId ? this.#mailbox.routineDeliveryOfRequest(agent.id, requestId) : null;
              return run !== null && this.#hooks.quietRunDelivery(run.delivery.id);
            },
            requestAnswered: (deliveryId) =>
              this.#mailbox.hasOwnReplyFrom(deliveryId) || this.#mailbox.hasSentResultFor(deliveryId),
          }).pipe(toBootRecoveryFailed);
          yield* recoveryStep(() => this.#refreshBackfilledConversation(agent.id, publicThreadId));
        }).pipe(
          Effect.catch((failure) =>
            Effect.sync(() => {
              if (unreadableHistory(failure)) this.#unreadableHistory.add(historyKey);
              try {
                this.#refreshBackfilledConversation(agent.id, publicThreadId);
              } catch (refreshFailure) {
                this.#hooks.emitError("provider_history_backfill_pending", refreshFailure, agent.id);
              }
              if (containsCause(failure, (cause) => cause instanceof RequestTimeoutError)) {
                logger.warn("A provider history read timed out.", { provider: session.provider, agentId: agent.id });
                return;
              }
              if (!containsCause(failure, (cause) => isCodexMissingRollout(cause) || isCodexRolloutPending(cause)))
                this.#hooks.emitError("provider_history_backfill_pending", failure.cause, agent.id);
            }),
          ),
        );
      }
    }
    if (this.#historyCompacted) return;
    this.#historyCompacted = true;
    yield* compactImportedProviderHistory(this.#store.database).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          if (result.rows > 0) logger.info("Compacted imported provider history.", toLogValue(result));
        }),
      ),
      Effect.catch((failure) =>
        Effect.sync(() => {
          this.#historyCompacted = false;
          logger.warn("Could not compact imported provider history.", toLogValue(failure.cause));
        }),
      ),
    );
  });

  readonly compactThreadEvents = Effect.fn("BootRecovery.compactThreadEvents")(function* (this: BootRecovery) {
    if (this.#threadEventsCompacted) return;
    this.#threadEventsCompacted = true;
    yield* compactThreadEvents(this.#store.database).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          if (result.rewritten > 0 || Object.keys(result.failedThreads).length > 0)
            eventLogger.info("Compacted old thread events.", toLogValue(result));
        }),
      ),
      Effect.catch((failure) =>
        Effect.sync(() => {
          this.#threadEventsCompacted = false;
          const cause = failure.cause;
          eventLogger.warn("Could not compact old thread events.", {
            name: cause instanceof Error ? cause.name : typeof cause,
          });
        }),
      ),
    );
  });

  #refreshBackfilledConversation(agentId: string, threadId: string): void {
    const page = this.#store.database.readConversationPage(agentId, threadId, { type: "latest" }, 100);
    const persisted = {
      agentId: page.agentId,
      threadId: page.threadId,
      activeTurnId: page.activeTurnId,
      revision: page.revision,
      messages: page.messages,
    };
    const live = this.#conversation.loadedSnapshot(agentId);
    const next = live?.activeTurnId ? mergeConversationSnapshots(persisted, live) : persisted;
    const previousSignature = live ? conversationContentSignature(live) : null;
    this.#conversation.setSnapshot(agentId, next);
    const published = this.#conversation.loadedSnapshot(agentId) ?? next;
    const signature = conversationContentSignature(published);
    if (!live || signature !== previousSignature) this.#conversation.publishConversation(published, signature);
  }
}

class BootRecoveryFailed extends Schema.TaggedError<BootRecoveryFailed>()("BootRecoveryFailed", {
  cause: Schema.Defect(),
}) {}

const { sync: recoveryStep, rewrap: toBootRecoveryFailed } = causeHelpers(BootRecoveryFailed);

function unreadableHistory(failure: unknown): boolean {
  return containsCause(failure, (cause) => cause instanceof LineTooLongError || isCodexMissingRollout(cause));
}

function containsCause(value: unknown, matches: (cause: unknown) => boolean): boolean {
  const seen = new Set<unknown>();
  let current = value;
  while (current && (typeof current === "object" || typeof current === "function") && !seen.has(current)) {
    seen.add(current);
    if (matches(current)) return true;
    current = "cause" in current && typeof current === "object" ? current.cause : undefined;
  }
  return false;
}
