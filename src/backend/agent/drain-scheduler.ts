import { randomUUID } from "node:crypto";
import { AGENT_PROVIDERS, type AgentModelOption, type AgentSummary } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Deferred, Effect, Result, Schema } from "effect";
import { type AgentProvider, ProviderTurnActiveError } from "../agent-client";
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
import type { PlanContinuation } from "./plan-continuation";
import type { ProfileSave } from "./profile-save";
import { isPlanLimitDiagnostic } from "./provider-diagnostics";
import type { ProviderRuntime } from "./provider-runtime";
import type { RoutineScheduler } from "./routine-scheduler";
import { sessionSettingsOverrides } from "./session-settings";
import {
  isCodexCompactionRefusal,
  isMissingProviderSessionError,
  isRequestTimeout,
  providerForAgent,
} from "./thread-items";
import type { ThreadLifecycle } from "./thread-lifecycle";
import { TurnSlots } from "./turn-slots";
import type { UsageLimitGate } from "./usage-limit-gate";
import { checkAgentFolders, codexSandboxPolicy, workspaceWritableRoots } from "./workspace-sandbox";

/** Shown to the user when a message names a model of an endpoint that was taken out. */
export const REMOVED_ENDPOINT_MESSAGE = sourceText("error.agent.endpointRemoved");

const logger = createOpenBotLogger("drain-scheduler");
const CHANNEL_START_FAILED = "The provider could not start this assignment. Resume to try again.";
/** How long messages wait for their turn after the provider did not confirm `turn/start` in time. */
const TURN_START_GRACE_MS = 5 * 60_000;

export interface DrainHooks {
  emitError(code: string, error: unknown, agentId?: string): void;
  isStopping(): boolean;
  /**
   * Whether the catalogue still serves this model. A removed endpoint's models stay in the running
   * OpenCode process until it restarts, and the restart waits for a busy agent, so this is what
   * keeps a delivery off an endpoint the user has taken out.
   */
  servesModel(model: string, provider: AgentProvider): boolean;
  /**
   * One piece of provider text with the MCP credentials taken out of it. The queue keeps a failed
   * delivery's reason in the database and shows it again, and `MailboxStore` can only apply the
   * generic redaction: it does not know which values this machine's MCP servers were given.
   */
  redactMcp(text: string): string;
  /**
   * Gives a channel task back to its channel after a spent plan refused it; false when it cannot go
   * back. `continueWork` keeps the assignment for a ready backup instead.
   */
  requeueChannelDelivery(deliveryId: string, continueWork?: boolean): Effect.Effect<boolean>;
  /** Whether a ready automatic backup can take this agent's work after a usage limit. */
  mayFailOver(agentId: string): boolean;
  /**
   * Starts the move of this agent to another model for a usage limit, if one is due: back to its own
   * model, or to a backup model during a hold. True when a move started; the move schedules the drain
   * again when it ends. Each path that starts a queue comes here, so no message runs on the wrong model.
   */
  followUsageLimit(agentId: string): boolean;
  /** Whether this turn already ended. A provider can end a turn before its `turn/start` answer is read. */
  turnEnded(turnId: string): boolean;
  /** Forgets the end of an earlier turn with this id: a requeued delivery starts again under the same turn id. */
  turnRestarting(turnId: string): void;
  /** Starts the new chat that the agent asked for, if it did. The agent's own chat has nothing to start. */
  startRequestedNewChat(agentId: string): Effect.Effect<void>;
  /** Drops that request: a turn in the agent's own chat starts first, so the agent's notes do not cover it. */
  dropRequestedNewChat(agentId: string): void;
}

/** The tasks of the agents, as the drain reads them. */
export interface TaskLanes {
  /** The thread of an open task, or null when the task is closed or gone. */
  threadId(taskId: string): string | null;
  /** The open tasks of this agent. */
  openTaskIds(agentId: string): readonly string[];
  /** How many tasks of this agent may run a turn at the same time. */
  limit(agentId: string): number;
  /** Whether the agent's provider runs one turn at a time, across its own chat and its tasks. */
  oneTurnAtATime(agentId: string): boolean;
}

/**
 * One queue that runs one turn at a time: the agent's own chat (`taskId` null, with its channel and
 * messaging work), or one of its tasks.
 */
interface Lane {
  readonly agentId: string;
  readonly taskId: string | null;
}

/** The key of a lane. The agent's own chat keeps the agent id, so its maps read as before tasks. */
function laneKey(lane: Lane): string {
  return lane.taskId === null ? lane.agentId : `${lane.agentId}\u0000${lane.taskId}`;
}

function laneOf(key: string): Lane {
  const separator = key.indexOf("\u0000");
  return separator < 0
    ? { agentId: key, taskId: null }
    : { agentId: key.slice(0, separator), taskId: key.slice(separator + 1) };
}

const mainLane = (agentId: string): Lane => ({ agentId, taskId: null });

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
  planContinuation: PlanContinuation;
  tasks: TaskLanes;
  hooks: DrainHooks;
  channels?: ChannelService;
  messaging?: MessagingThreads;
}

/**
 * The queue drain: takes the next queued delivery per lane and starts a
 * provider turn for it. Each agent has one lane for its own chat and one for
 * each task, so a task turn runs while the agent's chat or another task runs.
 * The lanes of one agent share every hold of the agent; a task lane also waits
 * for the task limit, and for the agent's own process when it must restart.
 *
 * Every controller that can hold an agent back owns one `#mayDrain` clause
 * (profile creation, duplication, compaction, routines); this class only composes them, and
 * `#drainLane` repeats the guard because a drain scheduled a microtask ago
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
  readonly #planContinuation: PlanContinuation;
  readonly #tasks: TaskLanes;
  readonly #slots: TurnSlots;
  /** Lanes that a full set of turn slots held back. A drain that may free a slot tries them again. */
  readonly #slotWaiters = new Set<string>();
  #wakingSlotWaiters = false;
  readonly #hooks: DrainHooks;
  readonly #channels: ChannelService | undefined;
  readonly #messaging: MessagingThreads | undefined;
  readonly #drainingLanes = new Set<string>();
  /**
   * Agents whose channel task a spent plan refused and gave back to its channel. Their queue can be
   * empty, so the end of the drain schedules them once: the schedule moves to a backup model.
   */
  readonly #requeuedAtLimit = new Set<string>();
  readonly #settingsHolds = new Map<string, number>();
  /** The last hold `#reportHold` logged per lane, so a waiting queue logs once per reason. */
  readonly #reportedHolds = new Map<string, string>();
  /**
   * The model each lane's running turn was started with, by lane key. The agent record can be moved
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
    this.#planContinuation = options.planContinuation;
    this.#tasks = options.tasks;
    this.#hooks = options.hooks;
    this.#channels = options.channels;
    this.#messaging = options.messaging;
    this.#slots = new TurnSlots({
      limit: () => this.#memory.turnLimit(),
      lanes: () =>
        this.#store
          .list()
          .flatMap((agent) => this.#lanesOf(agent.id))
          .map(laneKey),
      isRunning: (key) => {
        const lane = laneOf(key);
        // A compaction is a provider turn of the lane whose thread it compacts, so it uses that slot.
        return this.#laneRunning(lane) || this.#compactionHolds(lane);
      },
      isWaiting: (key) => {
        const lane = laneOf(key);
        return (
          this.#mayStartNow(lane) &&
          this.#memory.mayDrain(lane.agentId) &&
          this.#mailbox.nextQueued(lane.agentId, lane.taskId) !== null
        );
      },
      head: (key) => {
        const lane = laneOf(key);
        return this.#mailbox.nextQueued(lane.agentId, lane.taskId)?.delivery ?? null;
      },
    });
  }

  /** The clauses of this agent's own state. `#heldByMachine` adds the memory and the turn slots. */
  mayDrain(agentId: string): boolean {
    return this.#heldBy(mainLane(agentId)) === null;
  }

  /** The agent's own chat and its open tasks. */
  #lanesOf(agentId: string): Lane[] {
    return [mainLane(agentId), ...this.#tasks.openTaskIds(agentId).map((taskId) => ({ agentId, taskId }))];
  }

  /**
   * Whether this lane runs a turn or starts one. A start whose `turn/start` timed out stays "starting"
   * with no turn ID, and its turn can still run.
   */
  #laneRunning(lane: Lane): boolean {
    return (
      this.#drainingLanes.has(laneKey(lane)) ||
      this.#laneTurnActive(lane) ||
      this.#mailbox.laneActive(lane.agentId, lane.taskId)
    );
  }

  #laneTurnActive(lane: Lane): boolean {
    if (lane.taskId === null) return Boolean(this.#conversation.workingSnapshot(lane.agentId)?.activeTurnId);
    const threadId = this.#tasks.threadId(lane.taskId);
    return this.#conversation
      .workingTaskSnapshots(lane.agentId)
      .some((snapshot) => snapshot.threadId === threadId && snapshot.activeTurnId);
  }

  /**
   * Whether a compaction holds this lane. A side thread waits for a compaction of its own thread
   * only; the agent's own chat waits for one of any other thread (its chat, channel or messaging
   * thread), so threads that run in parallel do not wait for each other.
   */
  #compactionHolds(lane: Lane): boolean {
    const sideThreadId = lane.taskId === null ? null : this.#tasks.threadId(lane.taskId);
    return this.#compaction.heldThreads(lane.agentId).some((externalThreadId) => {
      const publicThreadId = this.#conversation.publicThreadId(lane.agentId, externalThreadId);
      if (!this.#conversation.isTaskThread(publicThreadId)) return lane.taskId === null;
      return publicThreadId === sideThreadId;
    });
  }

  /** The first clause of `mayDrain` that holds this lane, or null when none does. */
  #heldBy(lane: Lane): string | null {
    const { agentId, taskId } = lane;
    if (this.#settingsHolds.has(agentId)) return "session-settings";
    if (this.#laneTurnActive(lane)) return "active-turn";
    // The provider has one turn of the agent at a time, so each lane waits for the turn of any other.
    if (
      this.#tasks.oneTurnAtATime(agentId) &&
      this.#lanesOf(agentId).some((other) => other.taskId !== taskId && this.#laneRunning(other))
    )
      return "one-turn";
    if (taskId !== null) {
      if (this.#tasks.threadId(taskId) === null) return "task-closed";
      const running = this.#tasks
        .openTaskIds(agentId)
        .filter((other) => other !== taskId && this.#laneRunning({ agentId, taskId: other })).length;
      if (running >= this.#tasks.limit(agentId)) return "task-limit";
    }
    // The agent's own process restarts when its access or account changed. A turn of another lane
    // runs on it, so this lane waits for that turn to end.
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (
      agent &&
      !this.#providers.agentClientCurrent(agent) &&
      this.#lanesOf(agentId).some((other) => other.taskId !== taskId && this.#laneRunning(other))
    )
      return "agent-client-changing";
    // A hidden agent finishes the turn that runs. Its queued messages wait until the user restores it.
    if (agent?.hiddenAt !== undefined) return "hidden";
    // Channel work holds only the agent's own chat. Its tasks run beside a channel turn.
    if (taskId === null && !(this.#channels?.mayDrain(agentId) ?? true)) return "channel";
    if (!this.#profileSave.mayDrain(agentId)) return "profile-save";
    if (!this.#duplication.mayDrain(agentId)) return "duplication";
    if (this.#compactionHolds(lane)) return "compaction";
    if (!this.#routines.mayDrain(agentId)) return "routine";
    if (!this.#usageLimits.mayDrain(agentId) && !this.#usageLimits.mayTry(agentId)) return "usage-limit";
    return null;
  }

  /**
   * Logs once why a queued message of this lane waits, and again only when the reason changes. A
   * queue that never starts again then names the clause that holds it.
   */
  #reportHold(lane: Lane, reason: string): void {
    const key = laneKey(lane);
    if (this.#reportedHolds.get(key) === reason || !this.#mailbox.nextQueued(lane.agentId, lane.taskId)) return;
    this.#reportedHolds.set(key, reason);
    const working =
      reason === "active-turn" && lane.taskId === null ? this.#conversation.workingSnapshot(lane.agentId) : undefined;
    logger.info("A queued message waits.", {
      agentId: lane.agentId,
      ...(lane.taskId === null ? {} : { taskId: lane.taskId }),
      reason,
      ...(working ? { threadId: working.threadId, turnId: working.activeTurnId } : {}),
    });
  }

  /** Why the next message of this task waits, or null when it can start or nothing waits. */
  taskHold(agentId: string, taskId: string): string | null {
    const lane = { agentId, taskId };
    if (!this.#mailbox.nextQueued(agentId, taskId)) return null;
    return this.#heldBy(lane) ?? (this.#slotWaiters.has(laneKey(lane)) ? "machine" : null);
  }

  /** `followUsageLimit` is false after a move that failed, so that the drain does not try it again. */
  scheduleDrain(agentId: string, followUsageLimit = true): void {
    this.#scheduleDrain(agentId, followUsageLimit);
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
      for (const key of waiters) this.#scheduleLane(laneOf(key));
    } finally {
      this.#wakingSlotWaiters = false;
    }
  }

  /** Schedules the agent's own chat, then each task with a message that can start. */
  #scheduleDrain(agentId: string, followUsageLimit = true): void {
    if (this.#scheduleLane(mainLane(agentId), followUsageLimit)) return;
    this.#scheduleTasks(agentId);
  }

  /**
   * Schedules each task whose next message can start. A task with a start that is still "starting"
   * has none, so its drain would find nothing and schedule the task again with no end.
   */
  #scheduleTasks(agentId: string): void {
    for (const taskId of this.#mailbox.queuedTaskIds(agentId))
      if (this.#mailbox.nextQueued(agentId, taskId)) this.#scheduleLane({ agentId, taskId }, false);
  }

  /** True when a move for a usage limit started: the move schedules the agent again when it ends. */
  #scheduleLane(lane: Lane, followUsageLimit = true): boolean {
    const key = laneKey(lane);
    if (this.#hooks.isStopping() || this.#scheduledDrains.has(key)) return false;
    const hold =
      (!this.#providers.isReady() && "providers-not-ready") ||
      (this.#drainingLanes.has(key) && "drain-running") ||
      this.#heldBy(lane) ||
      (this.#heldByMachine(lane) && "machine");
    if (hold) this.#reportHold(lane, hold);
    if (followUsageLimit && (!hold || hold === "usage-limit") && this.#hooks.followUsageLimit(lane.agentId))
      return true;
    if (hold) return false;
    this.#scheduledDrains.add(key);
    const completion = Deferred.makeUnsafe<void, DeliveryStartFailed>();
    // Publish the scheduled work before its microtask, so deletion must wait for the attempt.
    this.#drainTasks.set(key, completion);
    queueMicrotask(() => {
      Effect.runFork(
        Effect.gen({ self: this }, function* () {
          this.#scheduledDrains.delete(key);
          const exit = yield* Effect.exit(this.#hooks.isStopping() ? Effect.void : this.#drainLane(lane));
          yield* Deferred.done(completion, exit);
          if (this.#drainTasks.get(key) === completion) this.#drainTasks.delete(key);
        }),
      );
    });
    return false;
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

  /** The drains of every lane of this agent that are scheduled or run, or undefined when none is. */
  taskFor(agentId: string): Effect.Effect<void, DeliveryStartFailed> | undefined {
    const completions = [...this.#drainTasks].flatMap(([key, completion]) =>
      laneOf(key).agentId === agentId ? [Deferred.await(completion)] : [],
    );
    return completions.length > 0 ? Effect.all(completions, { discard: true }) : undefined;
  }

  forgetAgent(agentId: string): void {
    const ofAgent = (key: string) => laneOf(key).agentId === agentId;
    for (const keys of [this.#drainingLanes, this.#scheduledDrains, this.#slotWaiters])
      for (const key of [...keys]) if (ofAgent(key)) keys.delete(key);
    for (const key of [...this.#reportedHolds.keys()]) if (ofAgent(key)) this.#reportedHolds.delete(key);
    for (const key of [...this.#turnModels.keys()]) if (ofAgent(key)) this.#turnModels.delete(key);
    this.#requeuedAtLimit.delete(agentId);
    this.retrySlotWaiters();
  }

  dispose(): void {
    this.#drainingLanes.clear();
    this.#scheduledDrains.clear();
    this.#slotWaiters.clear();
    this.#reportedHolds.clear();
    this.#requeuedAtLimit.clear();
  }

  /**
   * Whether the memory or the turn slots of the machine hold this lane back. A held agent is told
   * about the memory, and a lane held by the slots waits for the next free slot.
   */
  #heldByMachine(lane: Lane): boolean {
    if (!this.#memory.mayDrain(lane.agentId)) {
      if (this.#mailbox.nextQueued(lane.agentId, lane.taskId)) this.#memory.held(lane.agentId);
      return true;
    }
    const key = laneKey(lane);
    if (this.#slots.mayStart(key)) return false;
    this.#slotWaiters.add(key);
    return true;
  }

  /** The checks of `drainAgent` other than the clauses: the service runs and the provider can start. */
  #mayStartNow(lane: Lane): boolean {
    return (
      !this.#hooks.isStopping() &&
      !this.#drainingLanes.has(laneKey(lane)) &&
      this.#providers.isReady() &&
      !this.#deliveryProviders(lane.agentId).some((provider) => this.#providers.isReplacingCli(provider)) &&
      this.#heldBy(lane) === null
    );
  }

  /** Drains the agent's own chat. */
  drainAgent(agentId: string) {
    return this.#drainLane(mainLane(agentId));
  }

  readonly #drainLane = Effect.fn("DrainScheduler.drainLane")(function* (this: DrainScheduler, lane: Lane) {
    if (this.#hooks.isStopping()) return;
    const { agentId, taskId } = lane;
    const key = laneKey(lane);
    const hold =
      (this.#drainingLanes.has(key) && "drain-running") ||
      this.#heldBy(lane) ||
      (!this.#providers.isReady() && "providers-not-ready") ||
      // Before the try, so the delivery is not rescheduled in a loop while the CLI is replaced.
      // ProviderRuntime schedules this agent again once the new client is ready.
      (this.#deliveryProviders(agentId).some((provider) => this.#providers.isReplacingCli(provider)) &&
        "provider-cli-replaced") ||
      // Last, because it records the lane as waiting. Another drain can take the last slot
      // between the schedule and this start.
      (this.#heldByMachine(lane) && "machine");
    if (hold) {
      this.#reportHold(lane, hold);
      return;
    }
    this.#reportedHolds.delete(key);
    this.#drainingLanes.add(key);
    yield* Effect.gen({ self: this }, function* () {
      if (this.#laneTurnActive(lane)) return;
      const context = this.#mailbox.nextQueued(agentId, taskId);
      if (!context) {
        // Here, so that a message that arrives during the new chat waits for this drain to end.
        if (taskId === null) yield* this.#hooks.startRequestedNewChat(agentId);
        return;
      }
      // An automatic plan continuation runs only when nothing else waits in the lane and its chain
      // is still in memory. Otherwise its deliveries end as their last turn did, and the drain runs again.
      const planNote = context.planContinuation?.queued
        ? this.#planContinuation.claim(
            agentId,
            taskId,
            context.delivery.id,
            this.#mailbox.laneQueuedIds(agentId, taskId).length > 0,
          )
        : null;
      if (context.planContinuation?.queued && planNote === null) {
        yield* this.endPlanContinuation(agentId, taskId);
        return;
      }
      // A side thread compacts at the end of its own turns (`TurnLifecycle`), and that compaction
      // holds its own lane only. Here the agent's own chat compacts its chat, or the thread of the
      // channel or messaging work it serves.
      if (taskId === null) {
        const agent = this.#store.list().find((candidate) => candidate.id === agentId);
        const assignment = this.#channels?.store.assignmentForDelivery(context.delivery.id);
        const publicThreadId = assignment
          ? this.#channels?.store.context(assignment.channelId, assignment.agentId).threadId
          : (this.#messaging?.threadForDelivery(context.delivery.id) ?? agent?.threadId);
        if (agent && publicThreadId === agent.threadId) this.#hooks.dropRequestedNewChat(agentId);
        // A routine run in its own session leaves the chat session as it is.
        const session =
          agent && publicThreadId && !this.#runsInOwnSession(context)
            ? this.#store.database.activeProviderSession(publicThreadId, agent.provider)
            : null;
        if (session && this.#compaction.reserve(agentId, session.externalSessionId)) {
          yield* this.#compaction.request(agentId, session.externalSessionId);
          return;
        }
      }
      // One message from the user lets one turn try a limit, so the other lanes stay held.
      this.#usageLimits.tryStarted(agentId);
      yield* this.startDelivery(context, planNote ?? undefined);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#drainingLanes.delete(key);
          if (this.#requeuedAtLimit.delete(agentId) || this.#mailbox.nextQueued(agentId))
            this.#scheduleLane(mainLane(agentId));
          // Every task too: this lane can have held another one for the task limit or the process.
          this.#scheduleTasks(agentId);
          this.retrySlotWaiters();
        }),
      ),
    );
  }, Effect.uninterruptible);

  /**
   * Ends the automatic plan continuation of one lane, the agent's own chat when `taskId` is null:
   * after a Stop, a new chat, a new message, or a restart. The waiting deliveries end as
   * completed, as their last turn did.
   */
  readonly endPlanContinuation = Effect.fn("DrainScheduler.endPlanContinuation")(
    function* (this: DrainScheduler, agentId: string, taskId: string | null) {
      this.#planContinuation.cancel(agentId, taskId);
      const settled = yield* this.#mailbox.settlePlanContinuations(agentId, taskId);
      if (settled.length === 0) return;
      for (const deliveryId of settled) {
        const deliveryTaskId = this.#mailbox.taskIdForDelivery(deliveryId);
        const taskThreadId = deliveryTaskId === null ? null : this.#tasks.threadId(deliveryTaskId);
        const snapshot =
          deliveryTaskId === null
            ? this.#conversation.loadedSnapshot(agentId)
            : taskThreadId
              ? this.#conversation.loadedExecutionSnapshot(taskThreadId)
              : undefined;
        if (!snapshot) continue;
        this.#mailboxSync.syncDeliveryMessage(snapshot, deliveryId);
        this.#conversation.emitConversation(snapshot);
      }
      this.#mailboxSync.emitQueue(agentId);
    },
    (settle, agentId) =>
      settle.pipe(
        Effect.catch((failure) =>
          Effect.sync(() => this.#hooks.emitError("delivery_reconciliation_pending", failure, agentId)),
        ),
      ),
  );

  readonly startDelivery = Effect.fn("DrainScheduler.startDelivery")(function* (
    this: DrainScheduler,
    context: DeliveryContext,
    planNote?: string,
  ) {
    const { delivery } = context;
    const channelDelivery = this.#channels ? this.#channels.store.assignmentForDelivery(delivery.id) !== null : false;
    const messagingDelivery = this.#messaging?.ownsDelivery(delivery.id) ?? false;
    const taskId = this.#mailbox.taskIdForDelivery(delivery.id);
    const ownSession = this.#runsInOwnSession(context);
    // The teammate answers that start in this turn too. A channel task, an external message and a
    // routine run in its own session always run alone; a teammate's answer in an external
    // conversation takes the other answers to the same request. The person's message goes last, so
    // the turn answers it with the answers already read, and the person's later queued messages
    // follow it in queue order.
    // A plan continuation runs again the deliveries of the turn it continues, and no others.
    const replies =
      planNote !== undefined || channelDelivery || ownSession || (messagingDelivery && delivery.sender.kind !== "agent")
        ? []
        : this.#mailbox.repliesToStartWith(delivery.id);
    const laterMessages =
      planNote !== undefined
        ? this.#mailbox.planContinuationsToStartWith(delivery.id)
        : channelDelivery || ownSession || messagingDelivery
          ? []
          : this.#mailbox.userMessagesToStartWith(delivery.id);
    const companions = [...replies, ...laterMessages];
    let batch =
      planNote !== undefined || delivery.sender.kind === "user"
        ? [...replies, context, ...laterMessages]
        : [context, ...replies];
    let confirmedTurnId: string | null = null;
    // The session of a routine run in its own session. Closed here when no turn starts on it.
    let routineThreadId: string | null = null;
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
      // Once for the turn: its process, its session and its sandbox roots read the result.
      yield* checkAgentFolders(agent);
      requestedModel = agent.model;
      // The endpoint was removed while this agent was busy, so no other model could be given to it
      // then. The old process would still answer on the removed endpoint, with the credentials it
      // started with, until it restarts. Thrown rather than failed here: the catch below also ends
      // the channel assignment, and an assignment left active holds back every other agent.
      const requireServedModel = () => {
        if (!this.#hooks.servesModel(agent.model, providerForAgent(agent))) throw new Error(REMOVED_ENDPOINT_MESSAGE);
      };
      yield* drainStep(requireServedModel);
      yield* this.#threads.applyPendingRuntimeRefresh(agent, new Set(batch.map((item) => item.delivery.id)));
      releaseRuntimeRefresh = this.#threads.holdRuntimeRefresh(agent.id, taskId !== null);
      const client = yield* this.#providers.ensureAgentClient(agent).pipe(toDeliveryStartFailed);
      const messaging = this.#messaging;
      const channels = this.#channels;
      const taskThreadId = taskId === null ? null : this.#tasks.threadId(taskId);
      const execution: { threadId: string; text?: string } | null | undefined =
        taskId !== null
          ? taskThreadId
            ? { threadId: taskThreadId }
            : null
          : messagingDelivery
            ? messaging
              ? yield* messaging.prepare(context).pipe(toDeliveryStartFailed)
              : undefined
            : channels
              ? yield* channels.prepare(context).pipe(toDeliveryStartFailed)
              : null;
      if ((channelDelivery || messagingDelivery || taskId !== null) && !execution) {
        // Every delivery of the batch, so no later message stays `starting` in a removed lane.
        for (const item of batch) {
          const current = this.#mailbox.getDelivery(item.delivery.id)?.delivery;
          if (current?.status === "starting")
            yield* this.#mailbox
              .markTerminal(
                item.delivery.id,
                "interrupted",
                taskId !== null
                  ? sourceText("error.backend.threadArchived")
                  : channelDelivery
                    ? "The channel was deleted before starting."
                    : "The messaging thread was removed before starting.",
              )
              .pipe(toDeliveryStartFailed);
        }
        this.#mailboxSync.emitQueue(agent.id);
        return;
      }
      if (taskThreadId) this.#conversation.registerTaskThread(agent.id, taskThreadId);
      if (ownSession) {
        const publicThreadId = yield* this.#store.ensureThreadId(agent.id).pipe(toDeliveryStartFailed);
        // Checked again below. Here, so a busy chat does not start a session for nothing.
        if (this.#conversation.ensureSnapshot(agent.id, publicThreadId).activeTurnId) {
          for (const item of batch) yield* this.#mailbox.restoreQueued(item.delivery.id).pipe(toDeliveryStartFailed);
          this.#mailboxSync.emitQueue(agent.id);
          return;
        }
        routineThreadId = yield* this.#threads.startRoutineThread(agent, client).pipe(toDeliveryStartFailed);
      }
      let threadId =
        routineThreadId ??
        (yield* this.#threads.ensureThread(agent, client, execution?.threadId).pipe(toDeliveryStartFailed));
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
      const promptInput = (executionText: string | undefined) => {
        // The deliveries of one interrupted turn share its continuation, so the prompt states it once.
        const continued = new Set<string>();
        return combinedPromptInput(
          batch.map((item) => {
            const { resumeAfterUsageLimit, ...rest } = item;
            const repeated = resumeAfterUsageLimit !== undefined && continued.has(resumeAfterUsageLimit.turnId);
            if (resumeAfterUsageLimit) continued.add(resumeAfterUsageLimit.turnId);
            return deliveryPromptInput(repeated ? rest : item, {
              agentNames,
              snapshot,
              routineRun:
                item.delivery.sender.kind === "routine" ? this.#routines.runForDelivery(item.delivery.id) : null,
              wokenWaits: item.delivery.sender.kind === "routine" ? this.#routines.wokenWaits(item.delivery.id) : [],
              ...(executionText === undefined ? {} : { executionText }),
            });
          }),
          [...requestIds].flatMap((requestId) => this.#mailbox.unansweredRecipients(requestId)),
          agentNames,
        );
      };
      // The request is already in the session, so a plan continuation sends only its note.
      const completeInput =
        planNote === undefined ? promptInput(execution?.text) : [{ type: "text" as const, text: planNote }];
      // A channel packet with only unread messages, or an external message without the guidance, goes
      // only to the session that read the rest. The session can change from here to the retry below,
      // as when the provider cannot resume it.
      const shortened = channelDelivery ? channels : messagingDelivery ? messaging : undefined;
      const delta = shortened?.delta(delivery.id);
      const deltaInput = delta ? promptInput(delta.text) : null;
      const inputForThread = (providerThreadId: string) => {
        const input = deltaInput && shortened?.sendsDelta(delivery.id, providerThreadId) ? deltaInput : completeInput;
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
          ...(item.sender.kind === "agent" ? { senderAgentId: item.sender.agentId } : {}),
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
                // The delivery stays the same; a continuation must not overwrite the first turn's items.
                ...((context.resumeAfterUsageLimit || planNote !== undefined) && client.provider !== "codex"
                  ? { clientTurnId: randomUUID() }
                  : {}),
                // A teammate message that wants no answer tells the model to write nothing, so an empty
                // turn is the expected result and not a provider that swallowed its error.
                answerOptional:
                  delivery.sender.kind === "agent" && delivery.expectsReply === false && !delivery.replyToMessageId,
                input: inputForThread(providerThreadId),
                cwd: agent.workspacePath,
                runtimeWorkspaceRoots: workspaceWritableRoots(agent, this.#store.sharedRoot),
                approvalPolicy: "on-request",
                sandboxPolicy: codexSandboxPolicy(agent, this.#store.sharedRoot),
                ...(client.provider === "codex"
                  ? codexServiceTier(
                      this.#store.list().find((current) => current.id === agent.id) ?? agent,
                      this.#providers.listModels(),
                    )
                  : {}),
              },
              decodeTurnResponse,
            )
            .pipe(toDeliveryStartFailed);
        });
      // Claude, ACP and Pi take the delivery id as the turn id. A delivery that a refused turn put back
      // in the queue keeps its id, and the end of that turn must not end this new run (#2468).
      this.#hooks.turnRestarting(delivery.id);
      const firstStart = yield* Effect.result(startTurn(threadId));
      let response: Effect.Success<ReturnType<typeof startTurn>>;
      if (Result.isSuccess(firstStart)) response = firstStart.success;
      else {
        // Codex compacts this thread, so the input did not reach it. The messages keep their place
        // and wait for the compaction turn to end.
        if (!routineThreadId && isCodexCompactionRefusal(firstStart.failure.cause)) {
          for (const item of batch) yield* this.#mailbox.restoreQueued(item.delivery.id).pipe(toDeliveryStartFailed);
          this.#compaction.holdForRefusal(agent.id, threadId, client);
          this.#mailboxSync.emitQueue(agent.id);
          return;
        }
        // A routine session started just now. When it is gone, the provider failed, and the run fails.
        if (routineThreadId || !isMissingProviderSessionError(firstStart.failure.cause, client.provider))
          return yield* firstStart.failure;
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
      // A provider can end the turn before this answer is read, as when an ACP process exits during
      // `turn/start`. Its end already cleared the turn, so it is not marked active again: no later
      // event would end it, and it would hold every message of this agent.
      if (!this.#hooks.turnEnded(response.turn.id)) snapshot.activeTurnId = response.turn.id;
      confirmedTurnId = response.turn.id;
      this.#turnModels.set(laneKey({ agentId: agent.id, taskId }), { turnId: response.turn.id, model: agent.model });
      for (const item of batch)
        yield* this.#mailbox.markRunning(item.delivery.id, response.turn.id).pipe(toDeliveryStartFailed);
      if (this.#channels)
        yield* this.#channels.accepted(delivery.id, threadId, response.turn.id).pipe(toDeliveryStartFailed);
      if (messagingDelivery) this.#messaging?.accepted(delivery.id, threadId);
      if (this.#hooks.turnEnded(response.turn.id)) {
        // The end found these messages before they ran, or while the writes above waited, so it
        // left them running. Nothing else settles them.
        for (const item of batch) {
          const current = this.#mailbox.getDelivery(item.delivery.id)?.delivery;
          if (current?.status !== "running" || current.turnId !== response.turn.id) continue;
          yield* this.#mailbox.markTerminal(item.delivery.id, "interrupted", null).pipe(toDeliveryStartFailed);
          if (channelDelivery && this.#channels)
            yield* this.#channels.deliveryFailed(item.delivery.id, CHANNEL_START_FAILED).pipe(toDeliveryStartFailed);
          this.#messaging?.deliverySettled(item.delivery.id, "interrupted");
        }
        const live = this.#conversation.ensureSnapshot(agent.id, threadId);
        for (const held of new Set([snapshot, live])) {
          if (held.activeTurnId === response.turn.id) held.activeTurnId = null;
        }
        for (const item of batch) this.#mailboxSync.syncDeliveryMessage(live, item.delivery.id);
        this.#mailboxSync.emitQueue(agent.id);
        this.#conversation.emitConversation(live);
      } else {
        const currentDelivery = this.#mailbox.getDelivery(delivery.id)?.delivery;
        if (currentDelivery?.status === "running" && currentDelivery.turnId === response.turn.id) {
          for (const item of batch) this.#mailboxSync.syncDeliveryMessage(snapshot, item.delivery.id);
          this.#mailboxSync.emitQueue(agent.id);
          this.#conversation.emitConversation(snapshot);
        }
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
          // The provider started a turn of its own after the check above. Nothing ran, and `mayDrain`
          // holds the messages until that turn ends.
          if (error instanceof ProviderTurnActiveError) {
            for (const item of batch) yield* this.#mailbox.restoreQueued(item.delivery.id).pipe(toDeliveryStartFailed);
            this.#mailboxSync.emitQueue(delivery.recipientAgentId);
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
            // The wait has a limit: a turn that never starts would keep these messages starting, and
            // the agent's queue would stop with no notice.
            const ids = batch.map(({ delivery: item }) => item.id);
            yield* Effect.forkDetach(
              this.#settleUnstarted(delivery.recipientAgentId, ids, releaseReservation, routineThreadId).pipe(
                Effect.delay(TURN_START_GRACE_MS),
              ),
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
            // A ready backup continues earlier work in the same assignment, so the work is not lost.
            if (
              context.resumeAfterUsageLimit &&
              this.#hooks.mayFailOver(delivery.recipientAgentId) &&
              (yield* this.#hooks.requeueChannelDelivery(delivery.id, true))
            ) {
              yield* this.#mailbox.restoreQueued(delivery.id).pipe(toDeliveryStartFailed);
              this.#mailboxSync.emitQueue(delivery.recipientAgentId);
              this.#requeuedAtLimit.add(delivery.recipientAgentId);
              return;
            }
            if (yield* this.#hooks.requeueChannelDelivery(delivery.id)) {
              yield* this.#mailbox.markTerminal(delivery.id, "interrupted", null).pipe(toDeliveryStartFailed);
              this.#mailboxSync.emitQueue(delivery.recipientAgentId);
              this.#requeuedAtLimit.add(delivery.recipientAgentId);
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
            yield* this.#channels.deliveryFailed(delivery.id, CHANNEL_START_FAILED).pipe(toDeliveryStartFailed);
          this.#messaging?.deliveryFailed(delivery.id);
          // The provider refused the session or the turn, so no turn line records the failure.
          logger.warn("A message did not start.", {
            agentId: delivery.recipientAgentId,
            model: requestedModel,
            reason,
          });
          this.#hooks.emitError("delivery_start_failed", error, delivery.recipientAgentId);
          this.scheduleDrain(delivery.recipientAgentId);
          // The requester may hold the other answers until this request ends.
          if (delivery.sender.kind === "agent") this.scheduleDrain(delivery.sender.agentId);
        }),
      ),
      Effect.ensuring(
        Effect.gen({ self: this }, function* () {
          // A turn that started, or that may still start, closes the session when it ends.
          if (routineThreadId && !confirmedTurnId && !turnMayRun)
            yield* this.#threads.closeRoutineThread(routineThreadId);
          releaseRuntimeRefresh();
          if (!confirmedTurnId && !turnMayRun) releaseReservation();
          for (const provider of claimed) this.#startingDeliveries.set(provider, this.#starting(provider) - 1);
        }),
      ),
    );
  }, Effect.uninterruptible);

  /**
   * Whether this delivery is a routine run in the agent's own chat. It runs in a provider session
   * of its own, which closes when the run ends: the chat session does not grow with each run, and a
   * run does not read that whole session again. A routine run for a channel, an external
   * conversation or a task runs in that thread's session.
   */
  #runsInOwnSession(context: DeliveryContext): boolean {
    const id = context.delivery.id;
    return (
      context.delivery.sender.kind === "routine" &&
      this.#mailbox.taskIdForDelivery(id) === null &&
      !this.#channels?.store.assignmentForDelivery(id) &&
      !this.#messaging?.ownsDelivery(id)
    );
  }

  /**
   * Ends the messages of an unconfirmed `turn/start` that no turn took by the deadline. A turn that
   * started late took them already, and holds its reservation like any turn.
   */
  readonly #settleUnstarted = Effect.fn("DrainScheduler.settleUnstarted")(
    function* (
      this: DrainScheduler,
      agentId: string,
      deliveryIds: readonly string[],
      releaseReservation: () => void,
      routineThreadId: string | null,
    ) {
      if (this.#hooks.isStopping()) return;
      let settled = false;
      for (const id of deliveryIds) {
        const current = this.#mailbox.getDelivery(id)?.delivery;
        if (current?.status !== "starting" || current.turnId) continue;
        yield* this.#mailbox
          .markTerminal(id, "interrupted", sourceText("error.backend.turnNotStarted"))
          .pipe(toDeliveryStartFailed);
        if (this.#channels?.store.assignmentForDelivery(id))
          yield* this.#channels.deliveryFailed(id, CHANNEL_START_FAILED).pipe(toDeliveryStartFailed);
        this.#messaging?.deliverySettled(id, "interrupted");
        settled = true;
      }
      if (!settled) return;
      // No turn took the routine run, so its session ends here.
      if (routineThreadId) yield* this.#threads.closeRoutineThread(routineThreadId);
      releaseReservation();
      this.#mailboxSync.emitQueue(agentId);
      this.scheduleDrain(agentId);
    },
    Effect.catch((failure) => Effect.sync(() => this.#hooks.emitError("delivery_start_unconfirmed", failure.cause))),
  );

  /** The model this turn runs on, or `null` when no running turn of this agent is the one asked for. */
  modelForTurn(agentId: string, turnId: string): string | null {
    for (const [key, running] of this.#turnModels)
      if (running.turnId === turnId && laneOf(key).agentId === agentId) return running.model;
    return null;
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

/**
 * The Codex service tier of a turn. Codex keeps the tier for the next turns of the thread. An agent
 * that never set fast mode sends nothing, so Codex keeps its own tier; `null` returns the thread to
 * the standard tier, also for a model with no fast tier. While the catalog does not know the model,
 * such as before Codex lists its models, the turn sends nothing and keeps the tier of the thread.
 */
function codexServiceTier(
  agent: Pick<AgentSummary, "fastMode" | "model">,
  models: readonly AgentModelOption[],
): { serviceTier?: string | null } {
  if (agent.fastMode === undefined) return {};
  if (!agent.fastMode) return { serviceTier: null };
  const model = models.find((candidate) => candidate.provider === "codex" && candidate.id === agent.model);
  if (!model) return {};
  return { serviceTier: model.fastServiceTier ?? null };
}
