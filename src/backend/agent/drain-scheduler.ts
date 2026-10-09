import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Result, Schema } from "effect";
import type { AgentProvider } from "../agent-client";
import type { AgentStore } from "../agent-store";
import type { ChannelService } from "../channel-service";
import { causeHelpers } from "../effect-boundary";
import type { DeliveryContext, MailboxStore } from "../mailbox-store";
import type { MessagingThreads } from "../messaging/messaging-threads";
import { decodeTurnResponse } from "../protocol";
import type { ContextCompaction } from "./context-compaction";
import type { ConversationRuntime } from "./conversation-runtime";
import {
  agentNamesById,
  CURRENT_MESSAGE_SEPARATOR,
  combinedPromptInput,
  deliveryPromptInput,
} from "./delivery-content";
import type { DuplicationGate } from "./duplication-gate";
import type { MailboxSync } from "./mailbox-sync";
import type { MemoryHold } from "./memory-hold";
import type { ProfileSave } from "./profile-save";
import { isPlanLimitDiagnostic } from "./provider-diagnostics";
import type { ProviderRuntime } from "./provider-runtime";
import type { RoutineScheduler } from "./routine-scheduler";
import { sessionSettingsOverrides } from "./session-settings";
import { isMissingProviderSessionError, isRequestTimeout, providerForAgent } from "./thread-items";
import type { ThreadLifecycle } from "./thread-lifecycle";
import { TurnSlots } from "./turn-slots";
import type { UsageLimitGate } from "./usage-limit-gate";
import { codexSandboxPolicy, workspaceWritableRoots } from "./workspace-sandbox";

/** Shown to the user when a message names a model of an endpoint that was taken out. */
export const REMOVED_ENDPOINT_MESSAGE = sourceText("error.agent.endpointRemoved");

export interface DrainHooks {
  emitError(code: string, error: unknown, agentId?: string): void;
  isStopping(): boolean;
  /**
   * Whether the catalogue still serves this model. A removed endpoint's models stay in the running
   * OpenCode process until it restarts, and the restart waits for a busy agent, so this is what
   * keeps a delivery off an endpoint the user has taken out.
   */
  servesModel(model: string): boolean;
  /**
   * One piece of provider text with the MCP credentials taken out of it. The queue keeps a failed
   * delivery's reason in the database and shows it again, and `MailboxStore` can only apply the
   * generic redaction: it does not know which values this machine's MCP servers were given.
   */
  redactMcp(text: string): string;
  /** Gives a channel task back to its channel after a spent plan refused it; false when it cannot go back. */
  requeueChannelDelivery(deliveryId: string): Effect.Effect<boolean>;
}

export interface DrainSchedulerOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  mailboxSync: MailboxSync;
  conversation: ConversationRuntime;
  providers: ProviderRuntime;
  duplication: DuplicationGate;
  profileSave: ProfileSave;
  compaction: ContextCompaction;
  routines: RoutineScheduler;
  threads: ThreadLifecycle;
  memory: MemoryHold;
  usageLimits: UsageLimitGate;
  hooks: DrainHooks;
  channels?: ChannelService;
  messaging?: MessagingThreads;
}

/**
 * The queue drain: takes the next queued delivery per agent and starts a
 * provider turn for it.
 *
 * Every controller that can hold an agent back owns one `#mayDrain` clause
 * (profile creation, duplication, compaction, routines); this class only composes them, and
 * `#drainAgent` repeats the guard because a drain scheduled a microtask ago
 * may have been muted since. Owns the draining/scheduled/task maps. Takes
 * `ThreadLifecycle` directly — thread recovery is a dependency, not a hook.
 */
export class DrainScheduler {
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #mailboxSync: MailboxSync;
  readonly #conversation: ConversationRuntime;
  readonly #providers: ProviderRuntime;
  readonly #duplication: DuplicationGate;
  readonly #profileSave: ProfileSave;
  readonly #compaction: ContextCompaction;
  readonly #routines: RoutineScheduler;
  readonly #threads: ThreadLifecycle;
  readonly #memory: MemoryHold;
  readonly #usageLimits: UsageLimitGate;
  readonly #slots: TurnSlots;
  /** Agents that a full set of turn slots held back. A drain that may free a slot tries them again. */
  readonly #slotWaiters = new Set<string>();
  #wakingSlotWaiters = false;
  readonly #hooks: DrainHooks;
  readonly #channels: ChannelService | undefined;
  readonly #messaging: MessagingThreads | undefined;
  readonly #drainingAgents = new Set<string>();
  readonly #settingsHolds = new Map<string, number>();
  /**
   * The model each agent's running turn was started with, by turn id. The agent record can be moved
   * to another model while that turn runs, but the CLI keeps the session it opened, so this is the
   * endpoint a message steered into the turn would reach.
   */
  readonly #turnModels = new Map<string, { turnId: string; model: string }>();
  /**
   * How many deliveries are on their way to a turn, per provider.
   *
   * A delivery is claimed before its first await and released when it has an active turn or has
   * failed. Between the two it holds no turn id, and only this count stops a CLI update from
   * replacing the client it is about to prompt.
   */
  readonly #startingDeliveries = new Map<AgentProvider, number>();
  readonly #scheduledDrains = new Set<string>();
  readonly #drainTasks = new Map<string, Deferred.Deferred<void, DeliveryStartFailed>>();

  constructor(options: DrainSchedulerOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#mailboxSync = options.mailboxSync;
    this.#conversation = options.conversation;
    this.#providers = options.providers;
    this.#duplication = options.duplication;
    this.#profileSave = options.profileSave;
    this.#compaction = options.compaction;
    this.#routines = options.routines;
    this.#threads = options.threads;
    this.#memory = options.memory;
    this.#usageLimits = options.usageLimits;
    this.#hooks = options.hooks;
    this.#channels = options.channels;
    this.#messaging = options.messaging;
    this.#slots = new TurnSlots({
      limit: () => this.#memory.turnLimit(),
      agentIds: () => this.#store.list().map((agent) => agent.id),
      // A start whose `turn/start` timed out stays "starting" with no turn ID, and its turn can still run.
      isRunning: (agentId) =>
        this.#drainingAgents.has(agentId) ||
        Boolean(this.#conversation.workingSnapshot(agentId)?.activeTurnId) ||
        this.#mailbox.startingDeliveryForAgent(agentId) !== null ||
        !this.#compaction.mayDrain(agentId),
      isWaiting: (agentId) =>
        this.#mayStartNow(agentId) && this.#memory.mayDrain(agentId) && this.#mailbox.nextQueued(agentId) !== null,
      head: (agentId) => this.#mailbox.nextQueued(agentId)?.delivery ?? null,
    });
  }

  /** The clauses of this agent's own state. `#heldByMachine` adds the memory and the turn slots. */
  mayDrain(agentId: string): boolean {
    return (
      !this.#settingsHolds.has(agentId) &&
      !this.#conversation.workingSnapshot(agentId)?.activeTurnId &&
      (this.#channels?.mayDrain(agentId) ?? true) &&
      this.#profileSave.mayDrain(agentId) &&
      this.#duplication.mayDrain(agentId) &&
      this.#compaction.mayDrain(agentId) &&
      this.#routines.mayDrain(agentId) &&
      this.#usageLimits.mayDrain(agentId)
    );
  }

  scheduleDrain(agentId: string): void {
    this.#scheduleDrain(agentId);
    this.retrySlotWaiters();
  }

  /**
   * Tries the agents that wait for a turn slot again. Each drain that ends can free a slot, and the
   * memory sample calls this too, for a turn that ended on a path that schedules no drain.
   */
  retrySlotWaiters(): void {
    if (this.#wakingSlotWaiters || this.#slotWaiters.size === 0) return;
    this.#wakingSlotWaiters = true;
    try {
      const waiters = [...this.#slotWaiters];
      this.#slotWaiters.clear();
      for (const agentId of waiters) this.#scheduleDrain(agentId);
    } finally {
      this.#wakingSlotWaiters = false;
    }
  }

  #scheduleDrain(agentId: string): void {
    if (
      this.#hooks.isStopping() ||
      !this.#providers.isReady() ||
      this.#drainingAgents.has(agentId) ||
      this.#scheduledDrains.has(agentId) ||
      !this.mayDrain(agentId) ||
      this.#heldByMachine(agentId)
    ) {
      return;
    }
    this.#scheduledDrains.add(agentId);
    const completion = Deferred.makeUnsafe<void, DeliveryStartFailed>();
    // Publish the scheduled work before its microtask, so deletion must wait for the attempt.
    this.#drainTasks.set(agentId, completion);
    queueMicrotask(() => {
      Effect.runFork(
        Effect.gen({ self: this }, function* () {
          this.#scheduledDrains.delete(agentId);
          const exit = yield* Effect.exit(this.#hooks.isStopping() ? Effect.void : this.drainAgent(agentId));
          yield* Deferred.done(completion, exit);
          if (this.#drainTasks.get(agentId) === completion) this.#drainTasks.delete(agentId);
        }),
      );
    });
  }

  holdSessionSettings(agentId: string): () => void {
    this.#settingsHolds.set(agentId, (this.#settingsHolds.get(agentId) ?? 0) + 1);
    return () => {
      const remaining = (this.#settingsHolds.get(agentId) ?? 1) - 1;
      if (remaining > 0) this.#settingsHolds.set(agentId, remaining);
      else this.#settingsHolds.delete(agentId);
      this.scheduleDrain(agentId);
    };
  }

  pendingTasks(): Effect.Effect<void, DeliveryStartFailed>[] {
    return [...this.#drainTasks.values()].map(Deferred.await);
  }

  taskFor(agentId: string): Effect.Effect<void, DeliveryStartFailed> | undefined {
    const completion = this.#drainTasks.get(agentId);
    return completion ? Deferred.await(completion) : undefined;
  }

  forgetAgent(agentId: string): void {
    this.#drainingAgents.delete(agentId);
    this.#scheduledDrains.delete(agentId);
    this.#slotWaiters.delete(agentId);
    this.retrySlotWaiters();
  }

  dispose(): void {
    this.#drainingAgents.clear();
    this.#scheduledDrains.clear();
    this.#slotWaiters.clear();
  }

  /**
   * Whether the memory or the turn slots of the machine hold this agent back. A held agent is told
   * about the memory, and one held by the slots waits for the next free slot.
   */
  #heldByMachine(agentId: string): boolean {
    if (!this.#memory.mayDrain(agentId)) {
      if (this.#mailbox.nextQueued(agentId)) this.#memory.held(agentId);
      return true;
    }
    if (this.#slots.mayStart(agentId)) return false;
    this.#slotWaiters.add(agentId);
    return true;
  }

  /** The checks of `drainAgent` other than the clauses: the service runs and the provider can start. */
  #mayStartNow(agentId: string): boolean {
    return (
      !this.#hooks.isStopping() &&
      !this.#drainingAgents.has(agentId) &&
      this.#providers.isReady() &&
      !this.#deliveryProviders(agentId).some((provider) => this.#providers.isReplacingCli(provider)) &&
      this.mayDrain(agentId)
    );
  }

  drainAgent(agentId: string) {
    return this.#drainAgent(agentId);
  }

  readonly #drainAgent = Effect.fn("DrainScheduler.drainAgent")(function* (this: DrainScheduler, agentId: string) {
    if (
      this.#hooks.isStopping() ||
      this.#drainingAgents.has(agentId) ||
      !this.mayDrain(agentId) ||
      !this.#providers.isReady() ||
      // Before the try, so the delivery is not rescheduled in a loop while the CLI is replaced.
      // ProviderRuntime schedules this agent again once the new client is ready.
      this.#deliveryProviders(agentId).some((provider) => this.#providers.isReplacingCli(provider)) ||
      // Last, because it records the agent as waiting. Another drain can take the last slot
      // between the schedule and this start.
      this.#heldByMachine(agentId)
    )
      return;
    this.#drainingAgents.add(agentId);
    yield* Effect.gen({ self: this }, function* () {
      const snapshot = this.#conversation.workingSnapshot(agentId);
      if (snapshot?.activeTurnId) return;
      const context = this.#mailbox.nextQueued(agentId);
      if (!context) return;
      const agent = this.#store.list().find((candidate) => candidate.id === agentId);
      const assignment = this.#channels?.store.assignmentForDelivery(context.delivery.id);
      const publicThreadId = assignment
        ? this.#channels?.store.context(assignment.channelId, assignment.agentId).threadId
        : (this.#messaging?.threadForDelivery(context.delivery.id) ?? agent?.threadId);
      const session =
        agent && publicThreadId ? this.#store.database.activeProviderSession(publicThreadId, agent.provider) : null;
      if (session && this.#compaction.reserve(agentId, session.externalSessionId)) {
        yield* this.#compaction.request(agentId, session.externalSessionId);
        return;
      }
      yield* this.startDelivery(context);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#drainingAgents.delete(agentId);
          if (this.#mailbox.nextQueued(agentId)) this.#scheduleDrain(agentId);
          this.retrySlotWaiters();
        }),
      ),
    );
  }, Effect.uninterruptible);

  readonly startDelivery = Effect.fn("DrainScheduler.startDelivery")(function* (
    this: DrainScheduler,
    context: DeliveryContext,
  ) {
    const { delivery } = context;
    const channelDelivery = this.#channels ? this.#channels.store.assignmentForDelivery(delivery.id) !== null : false;
    const messagingDelivery = this.#messaging?.ownsDelivery(delivery.id) ?? false;
    // The teammate answers that start in this turn too. A channel task and an external message
    // always run alone; a teammate's answer in an external conversation takes the other answers to
    // the same request. The person's message goes last, so the turn answers it with the answers
    // already read.
    const companions =
      channelDelivery || (messagingDelivery && delivery.sender.kind !== "agent")
        ? []
        : this.#mailbox.repliesToStartWith(delivery.id);
    let batch = delivery.sender.kind === "user" ? [...companions, context] : [context, ...companions];
    let confirmedTurnId: string | null = null;
    const claimed = this.#deliveryProviders(delivery.recipientAgentId);
    for (const provider of claimed) this.#startingDeliveries.set(provider, this.#starting(provider) + 1);
    // Held from the refresh below until this start ends, because everything between them awaits the
    // provider: the session is resumed or started, and then the turn is sent on it. A refresh that
    // lands in that wait closes the session and drops the routing to it, and the turn that arrives
    // afterwards runs where no completion can be delivered, holding the queue of this agent.
    let releaseRuntimeRefresh: () => void = () => {};
    // Synchronously, before the first await, so the next drain already counts this turn's memory.
    // Released in the `finally` when no turn starts: a start that fails uses no provider memory.
    const releaseReservation = this.#memory.reserveTurn();
    let turnMayRun = false;
    // The model this start asks for. The agent can move to another one while `turn/start` waits, and
    // a plan limit belongs to the model the provider refused.
    let requestedModel: string | null = null;
    yield* Effect.gen({ self: this }, function* () {
      for (const item of batch) yield* this.#mailbox.markStarting(item.delivery.id).pipe(toDeliveryStartFailed);
      this.#mailboxSync.emitQueue(delivery.recipientAgentId);
      yield* this.#mailbox.verifyDeliveryAttachments(delivery.id).pipe(toDeliveryStartFailed);
      // An answer whose attachment changed fails alone. The message that starts the turn still runs.
      const failedCompanions = new Set<string>();
      for (const { delivery: companion } of companions) {
        const verified = yield* Effect.result(
          this.#mailbox.verifyDeliveryAttachments(companion.id).pipe(toDeliveryStartFailed),
        );
        if (Result.isFailure(verified)) {
          const error = verified.failure.cause;
          const reason = this.#hooks.redactMcp(error instanceof Error ? error.message : String(error));
          yield* this.#mailbox.markTerminal(companion.id, "failed", reason).pipe(toDeliveryStartFailed);
          failedCompanions.add(companion.id);
        }
      }
      if (failedCompanions.size > 0) {
        batch = batch.filter((item) => !failedCompanions.has(item.delivery.id));
        this.#mailboxSync.emitQueue(delivery.recipientAgentId);
      }
      const agent = yield* this.#store.getOrCreate(delivery.recipientAgentId).pipe(toDeliveryStartFailed);
      requestedModel = agent.model;
      // The endpoint was removed while this agent was busy, so no other model could be given to it
      // then. The old process would still answer on the removed endpoint, with the credentials it
      // started with, until it restarts. Thrown rather than failed here: the catch below also ends
      // the channel assignment, and an assignment left active holds back every other agent.
      const requireServedModel = () => {
        if (!this.#hooks.servesModel(agent.model)) throw new Error(REMOVED_ENDPOINT_MESSAGE);
      };
      yield* drainStep(requireServedModel);
      yield* this.#threads.applyPendingRuntimeRefresh(agent, new Set(batch.map((item) => item.delivery.id)));
      releaseRuntimeRefresh = this.#threads.holdRuntimeRefresh(agent.id);
      const client = yield* this.#providers.ensureAgentClient(agent).pipe(toDeliveryStartFailed);
      const messaging = this.#messaging;
      const channels = this.#channels;
      const execution = messagingDelivery
        ? messaging
          ? yield* messaging.prepare(context).pipe(toDeliveryStartFailed)
          : undefined
        : channels
          ? yield* channels.prepare(context).pipe(toDeliveryStartFailed)
          : null;
      if ((channelDelivery || messagingDelivery) && !execution) {
        const current = this.#mailbox.getDelivery(delivery.id)?.delivery;
        if (current?.status === "starting")
          yield* this.#mailbox
            .markTerminal(
              delivery.id,
              "interrupted",
              channelDelivery
                ? "The channel was deleted before starting."
                : "The messaging thread was removed before starting.",
            )
            .pipe(toDeliveryStartFailed);
        return;
      }
      let threadId = yield* this.#threads.ensureThread(agent, client, execution?.threadId).pipe(toDeliveryStartFailed);
      const snapshot = this.#conversation.ensureSnapshot(agent.id, threadId);
      // A turn started on this thread while the provider and the thread were prepared. The user
      // cannot see that race, so the delivery goes back to the head of the queue rather than
      // failing: a message to a busy agent always waits. `drainAgent` reschedules it in its
      // `finally`, and `mayDrain` holds it there until the turn ends.
      if (snapshot.activeTurnId) {
        for (const item of batch) yield* this.#mailbox.restoreQueued(item.delivery.id).pipe(toDeliveryStartFailed);
        this.#mailboxSync.emitQueue(agent.id);
        return;
      }

      const agentNames = agentNamesById(this.#store.list());
      const requestIds = new Set(
        batch.flatMap(({ delivery: item }) =>
          item.sender.kind === "agent" && item.replyToMessageId ? [item.replyToMessageId] : [],
        ),
      );
      const input = combinedPromptInput(
        batch.map((item) =>
          deliveryPromptInput(item, {
            agentNames,
            snapshot,
            routineRun:
              item.delivery.sender.kind === "routine" ? this.#routines.runForDelivery(item.delivery.id) : null,
            executionText: execution?.text,
          }),
        ),
        [...requestIds].flatMap((requestId) => this.#mailbox.unansweredRecipients(requestId)),
        agentNames,
      );
      const inputForThread = (providerThreadId: string): typeof input => {
        const handoff = this.#threads.consumePendingHandoff(providerThreadId);
        if (!handoff) return input;
        return input.map((item, index) =>
          index === 0 && item.type === "text"
            ? { ...item, text: `${handoff}${CURRENT_MESSAGE_SEPARATOR}${item.text}` }
            : item,
        );
      };

      for (const { delivery: item } of batch) {
        if (snapshot.messages.some((message) => message.id === item.id)) continue;
        snapshot.messages.push({
          id: item.id,
          author: item.sender.kind === "agent" ? "agent" : "user",
          source: item.sender.kind === "agent" ? "agent" : "user",
          senderAgentId: item.sender.kind === "agent" ? item.sender.agentId : undefined,
          replyToMessageId: item.replyToMessageId,
          attachments: item.attachments,
          delivery: { id: item.id, status: "starting", position: null },
          text: item.text,
          createdAt: item.createdAt,
          status: "completed",
        });
      }
      this.#conversation.emitConversation(snapshot);

      const startTurn = (providerThreadId: string) =>
        Effect.gen({ self: this }, function* () {
          // Read again here, not only above: the provider, the thread and the channel are prepared in
          // between, and an endpoint removed during that wait finds the process still running. The
          // retry below calls this as well, so the recovered thread is checked too.
          yield* drainStep(requireServedModel);
          return yield* this.#threads
            .requestWithArchivedThreadRecovery(
              agent,
              client,
              "turn/start",
              {
                threadId: providerThreadId,
                model: agent.model,
                effort: agent.reasoningEffort,
                sessionSettings: sessionSettingsOverrides(
                  this.#store.list().find((current) => current.id === agent.id) ?? agent,
                ),
                clientUserMessageId: delivery.id,
                // A teammate message that wants no answer tells the model to write nothing, so an empty
                // turn is the expected result and not a provider that swallowed its error.
                answerOptional:
                  delivery.sender.kind === "agent" && delivery.expectsReply === false && !delivery.replyToMessageId,
                input: inputForThread(providerThreadId),
                cwd: agent.workspacePath,
                runtimeWorkspaceRoots: workspaceWritableRoots(agent, this.#store.sharedRoot),
                approvalPolicy: "on-request",
                sandboxPolicy: codexSandboxPolicy(agent, this.#store.sharedRoot),
              },
              decodeTurnResponse,
            )
            .pipe(toDeliveryStartFailed);
        });
      const firstStart = yield* Effect.result(startTurn(threadId));
      let response: Effect.Success<ReturnType<typeof startTurn>>;
      if (Result.isSuccess(firstStart)) response = firstStart.success;
      else {
        if (!isMissingProviderSessionError(firstStart.failure.cause, client.provider)) return yield* firstStart.failure;
        const unavailableThreadId = threadId;
        if (this.#conversation.loadedClientFor(unavailableThreadId) === client) {
          this.#conversation.unloadThread(unavailableThreadId);
        }
        threadId = yield* this.#threads.ensureThread(agent, client, execution?.threadId).pipe(toDeliveryStartFailed);
        response = yield* startTurn(threadId);
        if (threadId === unavailableThreadId) {
          this.#threads.logRecovery(agent.id, client.provider, "resumed");
        }
      }
      // The provider has accepted the turn. Publish the active turn before the first mailbox write
      // can yield: queue reconciliation may run while delivery rows change, and an idle cached
      // snapshot with a running delivery is a stale state for clients.
      snapshot.activeTurnId = response.turn.id;
      confirmedTurnId = response.turn.id;
      this.#turnModels.set(agent.id, { turnId: response.turn.id, model: agent.model });
      for (const item of batch)
        yield* this.#mailbox.markRunning(item.delivery.id, response.turn.id).pipe(toDeliveryStartFailed);
      if (this.#channels)
        yield* this.#channels.accepted(delivery.id, threadId, response.turn.id).pipe(toDeliveryStartFailed);
      const currentDelivery = this.#mailbox.getDelivery(delivery.id)?.delivery;
      if (currentDelivery?.status === "running" && currentDelivery.turnId === response.turn.id) {
        for (const item of batch) this.#mailboxSync.syncDeliveryMessage(snapshot, item.delivery.id);
        this.#mailboxSync.emitQueue(agent.id);
        this.#conversation.emitConversation(snapshot);
      }
      yield* this.#threads.deletePendingHandoff(threadId).pipe(
        Effect.catch((failure) =>
          Effect.sync(() => {
            this.#hooks.emitError("history_handoff_cleanup_failed", failure.cause, agent.id);
          }),
        ),
      );
    }).pipe(
      // Synchronous store/event failures used the same reconciliation path before migration.
      Effect.catchDefect((cause) => Effect.fail(new DeliveryStartFailed({ cause }))),
      Effect.catch((failure) =>
        Effect.gen({ self: this }, function* () {
          const error = failure.cause;
          // The provider accepted the turn. Keep its active reservation even when a mailbox write
          // failed: restoring or replaying any delivery could submit the same provider turn twice.
          // The lifecycle association and the targeted mailbox retry finish rows left in starting.
          if (confirmedTurnId) {
            this.#hooks.emitError("delivery_reconciliation_pending", error, delivery.recipientAgentId);
            this.#mailboxSync.retryDeliveryReconciliation(
              delivery.recipientAgentId,
              confirmedTurnId,
              batch.map(({ delivery: item }) => item.id),
            );
            return;
          }
          if (isRequestTimeout(error, "turn/start")) {
            turnMayRun = true;
            this.#channels?.deliveryUncertain(delivery.id);
            this.#hooks.emitError(
              "delivery_start_unconfirmed",
              `${error.providerName} did not confirm the turn start in time. OpenBot will wait for lifecycle events instead of retrying potentially duplicated work.`,
              delivery.recipientAgentId,
            );
            return;
          }
          const reason = this.#hooks.redactMcp(error instanceof Error ? error.message : String(error));
          // A spent plan window refused the start, so nothing ran. The messages wait for the reset, and
          // a channel task goes back to its channel, so that its assignment does not reserve the host.
          if (!messagingDelivery && isPlanLimitDiagnostic(reason)) {
            if (!channelDelivery) {
              for (const item of batch)
                yield* this.#mailbox.restoreQueued(item.delivery.id).pipe(toDeliveryStartFailed);
              this.#mailboxSync.emitQueue(delivery.recipientAgentId);
              // After the restore, so a routine set to skip finds its run back in the queue.
              yield* this.#usageLimits.reached(delivery.recipientAgentId, null, requestedModel);
              return;
            }
            // Before the requeue, so the channel does not assign the task to this agent again at once.
            yield* this.#usageLimits.reached(delivery.recipientAgentId, null, requestedModel);
            if (yield* this.#hooks.requeueChannelDelivery(delivery.id)) {
              yield* this.#mailbox.markTerminal(delivery.id, "interrupted", null).pipe(toDeliveryStartFailed);
              this.#mailboxSync.emitQueue(delivery.recipientAgentId);
              return;
            }
          }
          yield* this.#mailbox.markTerminal(delivery.id, "failed", reason).pipe(toDeliveryStartFailed);
          // The provider did not read the answers that were to start with it, so they wait for the next turn.
          for (const { delivery: companion } of batch) {
            if (companion.id !== delivery.id)
              yield* this.#mailbox.restoreQueued(companion.id).pipe(toDeliveryStartFailed);
          }
          this.#mailboxSync.emitQueue(delivery.recipientAgentId);
          if (this.#channels)
            yield* this.#channels
              .deliveryFailed(delivery.id, "The provider could not start this assignment. Resume to try again.")
              .pipe(toDeliveryStartFailed);
          this.#messaging?.deliveryFailed(delivery.id);
          this.#hooks.emitError("delivery_start_failed", error, delivery.recipientAgentId);
          this.scheduleDrain(delivery.recipientAgentId);
          // The requester may hold the other answers until this request ends.
          if (delivery.sender.kind === "agent") this.scheduleDrain(delivery.sender.agentId);
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          releaseRuntimeRefresh();
          if (!confirmedTurnId && !turnMayRun) releaseReservation();
          for (const provider of claimed) this.#startingDeliveries.set(provider, this.#starting(provider) - 1);
        }),
      ),
    );
  }, Effect.uninterruptible);

  /** The model this turn runs on, or `null` when this agent's running turn is not the one asked for. */
  modelForTurn(agentId: string, turnId: string): string | null {
    const running = this.#turnModels.get(agentId);
    return running?.turnId === turnId ? running.model : null;
  }

  /** True while a delivery for this provider is between its first await and its turn. */
  hasStartingDeliveries(provider: AgentProvider): boolean {
    return this.#starting(provider) > 0;
  }

  #starting(provider: AgentProvider): number {
    return this.#startingDeliveries.get(provider) ?? 0;
  }

  /**
   * The providers a delivery to this agent can reach. One for an agent that exists; an agent
   * startDelivery has still to create can land on any of them, so all of them are claimed.
   */
  #deliveryProviders(agentId: string): AgentProvider[] {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    return agent ? [providerForAgent(agent)] : [...AGENT_PROVIDERS];
  }
}

export class DeliveryStartFailed extends Schema.TaggedError<DeliveryStartFailed>()("DeliveryStartFailed", {
  cause: Schema.Defect(),
}) {}

const { sync: drainStep, rewrap: toDeliveryStartFailed } = causeHelpers(DeliveryStartFailed);
