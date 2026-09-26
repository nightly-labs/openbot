import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import type { AgentProvider } from "../agent-client";
import type { AgentStore } from "../agent-store";
import type { ChannelService } from "../channel-service";
import type { DeliveryContext, MailboxStore } from "../mailbox-store";
import { decodeTurnResponse } from "../protocol";
import type { ContextCompaction } from "./context-compaction";
import type { ConversationRuntime } from "./conversation-runtime";
import { agentNamesById, deliveryPromptInput } from "./delivery-content";
import type { DuplicationGate } from "./duplication-gate";
import type { MailboxSync } from "./mailbox-sync";
import type { ProfileSave } from "./profile-save";
import type { ProviderRuntime } from "./provider-runtime";
import type { RoutineScheduler } from "./routine-scheduler";
import { isMissingProviderSessionError, isRequestTimeout, providerForAgent } from "./thread-items";
import type { ThreadLifecycle } from "./thread-lifecycle";
import { codexSandboxPolicy } from "./workspace-sandbox";

/** Shown to the user when a message names a model of an endpoint that was taken out. */
export const REMOVED_ENDPOINT_MESSAGE = "The endpoint this agent used was removed. Choose another model for it.";

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
  hooks: DrainHooks;
  channels?: ChannelService;
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
  readonly #hooks: DrainHooks;
  readonly #channels: ChannelService | undefined;
  readonly #drainingAgents = new Set<string>();
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
  readonly #drainTasks = new Map<string, Promise<void>>();

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
    this.#hooks = options.hooks;
    this.#channels = options.channels;
  }

  mayDrain(agentId: string): boolean {
    return (
      !this.#conversation.workingSnapshot(agentId)?.activeTurnId &&
      (this.#channels?.mayDrain(agentId) ?? true) &&
      this.#profileSave.mayDrain(agentId) &&
      this.#duplication.mayDrain(agentId) &&
      this.#compaction.mayDrain(agentId) &&
      this.#routines.mayDrain(agentId)
    );
  }

  scheduleDrain(agentId: string): void {
    if (
      this.#hooks.isStopping() ||
      !this.#providers.isReady() ||
      this.#drainingAgents.has(agentId) ||
      this.#scheduledDrains.has(agentId) ||
      !this.mayDrain(agentId)
    ) {
      return;
    }
    this.#scheduledDrains.add(agentId);
    const task = Promise.resolve()
      .then(() => {
        this.#scheduledDrains.delete(agentId);
        if (this.#hooks.isStopping()) return;
        return this.drainAgent(agentId);
      })
      .finally(() => {
        if (this.#drainTasks.get(agentId) === task) this.#drainTasks.delete(agentId);
      });
    // Track the microtask as soon as it is scheduled. A channel can be deleted in the same
    // turn that queues its delivery, before the microtask has entered drainAgent. Deletion must
    // still wait for that start attempt so a provider turn cannot outlive the channel records.
    this.#drainTasks.set(agentId, task);
  }

  pendingTasks(): Promise<void>[] {
    return [...this.#drainTasks.values()];
  }

  taskFor(agentId: string): Promise<void> | undefined {
    return this.#drainTasks.get(agentId);
  }

  forgetAgent(agentId: string): void {
    this.#drainingAgents.delete(agentId);
    this.#scheduledDrains.delete(agentId);
  }

  dispose(): void {
    this.#drainingAgents.clear();
    this.#scheduledDrains.clear();
  }

  async drainAgent(agentId: string): Promise<void> {
    if (
      this.#hooks.isStopping() ||
      this.#drainingAgents.has(agentId) ||
      !this.mayDrain(agentId) ||
      !this.#providers.isReady() ||
      // Before the try, so the delivery is not rescheduled in a loop while the CLI is replaced.
      // ProviderRuntime schedules this agent again once the new client is ready.
      this.#deliveryProviders(agentId).some((provider) => this.#providers.isReplacingCli(provider))
    )
      return;
    this.#drainingAgents.add(agentId);
    try {
      const snapshot = this.#conversation.workingSnapshot(agentId);
      if (snapshot?.activeTurnId) return;
      const context = this.#mailbox.nextQueued(agentId);
      if (!context) return;
      const agent = this.#store.list().find((candidate) => candidate.id === agentId);
      const assignment = this.#channels?.store.assignmentForDelivery(context.delivery.id);
      const publicThreadId = assignment
        ? this.#channels?.store.context(assignment.channelId, assignment.agentId).threadId
        : agent?.threadId;
      const session =
        agent && publicThreadId ? this.#store.database.activeProviderSession(publicThreadId, agent.provider) : null;
      if (session && this.#compaction.reserve(agentId, session.externalSessionId)) {
        await this.#compaction.request(agentId, session.externalSessionId);
        return;
      }
      await this.startDelivery(context);
    } finally {
      this.#drainingAgents.delete(agentId);
      if (this.#mailbox.nextQueued(agentId)) this.scheduleDrain(agentId);
    }
  }

  async startDelivery(context: DeliveryContext): Promise<void> {
    const { delivery } = context;
    const channelDelivery = this.#channels ? this.#channels.store.assignmentForDelivery(delivery.id) !== null : false;
    let confirmedTurnId: string | null = null;
    const claimed = this.#deliveryProviders(delivery.recipientAgentId);
    for (const provider of claimed) this.#startingDeliveries.set(provider, this.#starting(provider) + 1);
    // Held from the refresh below until this start ends, because everything between them awaits the
    // provider: the session is resumed or started, and then the turn is sent on it. A refresh that
    // lands in that wait closes the session and drops the routing to it, and the turn that arrives
    // afterwards runs where no completion can be delivered, holding the queue of this agent.
    let releaseRuntimeRefresh: () => void = () => {};
    try {
      await this.#mailbox.markStarting(delivery.id);
      this.#mailboxSync.emitQueue(delivery.recipientAgentId);
      await this.#mailbox.verifyDeliveryAttachments(delivery.id);
      const agent = await this.#store.getOrCreate(delivery.recipientAgentId);
      // The endpoint was removed while this agent was busy, so no other model could be given to it
      // then. The old process would still answer on the removed endpoint, with the credentials it
      // started with, until it restarts. Thrown rather than failed here: the catch below also ends
      // the channel assignment, and an assignment left active holds back every other agent.
      const requireServedModel = () => {
        if (!this.#hooks.servesModel(agent.model)) throw new Error(REMOVED_ENDPOINT_MESSAGE);
      };
      requireServedModel();
      this.#threads.applyPendingRuntimeRefresh(agent, delivery.id);
      releaseRuntimeRefresh = this.#threads.holdRuntimeRefresh(agent.id);
      const client = await this.#providers.ensureAgentClient(agent);
      const execution = this.#channels ? await this.#channels.prepare(context) : null;
      if (channelDelivery && !execution) {
        const current = this.#mailbox.getDelivery(delivery.id)?.delivery;
        if (current?.status === "starting")
          await this.#mailbox.markTerminal(delivery.id, "interrupted", "The channel was deleted before starting.");
        return;
      }
      let threadId = await this.#threads.ensureThread(agent, client, execution?.threadId);
      const snapshot = this.#conversation.ensureSnapshot(agent.id, threadId);
      // A turn started on this thread while the provider and the thread were prepared. The user
      // cannot see that race, so the delivery goes back to the head of the queue rather than
      // failing: a message to a busy agent always waits. `drainAgent` reschedules it in its
      // `finally`, and `mayDrain` holds it there until the turn ends.
      if (snapshot.activeTurnId) {
        await this.#mailbox.restoreQueued(delivery.id);
        this.#mailboxSync.emitQueue(agent.id);
        return;
      }

      const input = deliveryPromptInput(context, {
        agentNames: agentNamesById(this.#store.list()),
        snapshot,
        routineRun: delivery.sender.kind === "routine" ? this.#routines.runForDelivery(delivery.id) : null,
        channelText: execution?.text,
      });
      const inputForThread = (providerThreadId: string): typeof input => {
        const handoff = this.#threads.consumePendingHandoff(providerThreadId);
        if (!handoff) return input;
        return input.map((item, index) =>
          index === 0 && item.type === "text"
            ? { ...item, text: `${handoff}\n\n--- current message ---\n${item.text}` }
            : item,
        );
      };

      if (!snapshot.messages.some((message) => message.id === delivery.id)) {
        snapshot.messages.push({
          id: delivery.id,
          author: delivery.sender.kind === "agent" ? "agent" : "user",
          source: delivery.sender.kind === "agent" ? "agent" : "user",
          senderAgentId: delivery.sender.kind === "agent" ? delivery.sender.agentId : undefined,
          replyToMessageId: delivery.replyToMessageId,
          attachments: delivery.attachments,
          delivery: { id: delivery.id, status: "starting", position: null },
          text: delivery.text,
          createdAt: delivery.createdAt,
          status: "completed",
        });
      }
      this.#conversation.emitConversation(snapshot);

      const startTurn = (providerThreadId: string) => {
        // Read again here, not only above: the provider, the thread and the channel are prepared in
        // between, and an endpoint removed during that wait finds the process still running. The
        // retry below calls this as well, so the recovered thread is checked too.
        requireServedModel();
        return this.#threads.requestWithArchivedThreadRecovery(
          agent,
          client,
          "turn/start",
          {
            threadId: providerThreadId,
            model: agent.model,
            effort: agent.reasoningEffort,
            clientUserMessageId: delivery.id,
            input: inputForThread(providerThreadId),
            cwd: agent.workspacePath,
            runtimeWorkspaceRoots: [agent.workspacePath, this.#store.sharedRoot],
            approvalPolicy: "on-request",
            sandboxPolicy: codexSandboxPolicy(agent, this.#store.sharedRoot),
          },
          decodeTurnResponse,
        );
      };
      let response: Awaited<ReturnType<typeof startTurn>>;
      try {
        response = await startTurn(threadId);
      } catch (error) {
        if (!isMissingProviderSessionError(error, client.provider)) throw error;
        const unavailableThreadId = threadId;
        if (this.#conversation.loadedClientFor(unavailableThreadId) === client) {
          this.#conversation.unloadThread(unavailableThreadId);
        }
        threadId = await this.#threads.ensureThread(agent, client, execution?.threadId);
        response = await startTurn(threadId);
        if (threadId === unavailableThreadId) {
          this.#threads.logRecovery(agent.id, client.provider, "resumed");
        }
      }
      await this.#mailbox.markRunning(delivery.id, response.turn.id);
      confirmedTurnId = response.turn.id;
      this.#turnModels.set(agent.id, { turnId: response.turn.id, model: agent.model });
      this.#channels?.accepted(delivery.id, threadId, response.turn.id);
      const currentDelivery = this.#mailbox.getDelivery(delivery.id)?.delivery;
      if (currentDelivery?.status === "running" && currentDelivery.turnId === response.turn.id) {
        snapshot.activeTurnId = response.turn.id;
        this.#mailboxSync.syncDeliveryMessage(snapshot, delivery.id);
        this.#mailboxSync.emitQueue(agent.id);
        this.#conversation.emitConversation(snapshot);
      }
      await this.#threads.deletePendingHandoff(threadId).catch((error) => {
        this.#hooks.emitError("history_handoff_cleanup_failed", error, agent.id);
      });
    } catch (error) {
      const currentDelivery = this.#mailbox.getDelivery(delivery.id)?.delivery;
      if (confirmedTurnId && currentDelivery?.status === "running" && currentDelivery.turnId === confirmedTurnId) {
        this.#hooks.emitError("delivery_reconciliation_pending", error, delivery.recipientAgentId);
        this.#mailboxSync.retryDeliveryReconciliation(delivery.recipientAgentId);
        return;
      }
      if (isRequestTimeout(error, "turn/start")) {
        this.#channels?.deliveryUncertain(delivery.id);
        this.#hooks.emitError(
          "delivery_start_unconfirmed",
          `${error.providerName} did not confirm the turn start in time. OpenBot will wait for lifecycle events instead of retrying potentially duplicated work.`,
          delivery.recipientAgentId,
        );
        return;
      }
      await this.#mailbox.markTerminal(
        delivery.id,
        "failed",
        this.#hooks.redactMcp(error instanceof Error ? error.message : String(error)),
      );
      this.#mailboxSync.emitQueue(delivery.recipientAgentId);
      this.#channels?.deliveryFailed(delivery.id, "The provider could not start this assignment. Resume to try again.");
      this.#hooks.emitError("delivery_start_failed", error, delivery.recipientAgentId);
      this.scheduleDrain(delivery.recipientAgentId);
    } finally {
      releaseRuntimeRefresh();
      for (const provider of claimed) this.#startingDeliveries.set(provider, this.#starting(provider) - 1);
    }
  }

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
